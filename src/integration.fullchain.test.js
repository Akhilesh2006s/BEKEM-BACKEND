const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const {
  setupTestDb,
  teardownTestDb,
  loginAs,
  getSeedContext,
  getApp,
} = require('./test/helpers');
const mongoose = require('mongoose');
const { MaterialRequest, StatusHistory, Notification, PurchaseRequest, Material } = require('./models');
const { ensureFinalizedRfqForPo } = require('./test/ensureFinalizedRfqForPo');

describe('Full chain integration', () => {
  before(async () => {
    await setupTestDb();
  });

  after(async () => {
    await teardownTestDb();
  });

  it('walks material request through all 6 roles end-to-end', async () => {
    const app = getApp();
    const { site, indentCategory } = await getSeedContext();
    const cement = await Material.findOne({ code: 'MAT-CEMENT-OPC53' });
    assert.ok(cement, 'seed cement material required');

    const siteToken = await loginAs('request@bekem.com');
    const storeToken = await loginAs('storeincharge@bekem.com');
    const pmToken = await loginAs('pm@bekem.com');
    const execToken = await loginAs('executive@bekem.com');
    const coordToken = await loginAs('coordinator@bekem.com');

    const createRes = await request(app)
      .post('/api/material-requests')
      .set('Authorization', `Bearer ${siteToken}`)
      .send({
        indentRequestType: 'ABOVE_5000',
        requestedByName: 'Test Requester',
        indentCategoryId: indentCategory._id.toString(),
        items: [{ materialId: cement._id.toString(), quantityRequested: 1 }],
        purpose: 'Integration test pour',
        requiredByDate: new Date(Date.now() + 7 * 86400000).toISOString(),
      });

    assert.strictEqual(createRes.status, 201);
    const mrId = createRes.body.data.id;

    const forwardRes = await request(app)
      .post(`/api/material-requests/${mrId}/allocate`)
      .set('Authorization', `Bearer ${storeToken}`)
      .send({ decision: 'forward', remark: 'Stock confirmed, forwarding entire indent to PM' });

    assert.strictEqual(forwardRes.status, 200);

    const pmApproveRes = await request(app)
      .post(`/api/material-requests/${mrId}/approve`)
      .set('Authorization', `Bearer ${pmToken}`);

    assert.strictEqual(pmApproveRes.status, 200);
    assert.strictEqual(pmApproveRes.body.data.status, 'PURCHASE_REQUESTED');

    const pr = await PurchaseRequest.findOne({ materialRequestId: mrId });
    assert.ok(pr, 'PR should be auto-created on PM approval');
    const prId = pr._id.toString();

    const setup = await ensureFinalizedRfqForPo(app, execToken, prId, {
      rates: [1000, 1100, 1200],
      whyWeChoseThisVendor: 'Best rate and delivery for integration test procurement',
    });

    const poRes = await request(app)
      .post('/api/purchase-orders/wizard')
      .set('Authorization', `Bearer ${execToken}`)
      .send({
        purchaseRequestId: prId,
        vendorId: setup.selectedVendorId,
        paymentTerms: 'Net 30 days',
        whyWeChoseThisVendor: 'Best rate and delivery for integration test procurement',
        vendorSelectionReason:
          setup.selectedVendorId === setup.l1VendorId
            ? undefined
            : 'Integration test non-L1 fallback',
      });

    assert.strictEqual(poRes.status, 201, JSON.stringify(poRes.body));
    const poId = poRes.body.data.id;
    assert.ok(poRes.body.quotations?.length >= 1, 'RFQ/quotations should be present after finalize');

    const verifyRes = await request(app)
      .post(`/api/purchase-orders/${poId}/verify`)
      .set('Authorization', `Bearer ${coordToken}`)
      .send({ action: 'APPROVE', note: 'Verified' });

    assert.strictEqual(verifyRes.status, 200);
    let poStatus = verifyRes.body.data.status;
    if (poStatus === 'PM_PENDING') {
      const pmPoRes = await request(app)
        .post(`/api/purchase-orders/${poId}/pm-approve`)
        .set('Authorization', `Bearer ${pmToken}`)
        .send({ note: 'PM final approval — under ₹5,000 band' });
      assert.strictEqual(pmPoRes.status, 200);
      poStatus = pmPoRes.body.data.status;
      assert.ok(pmPoRes.body.data.poNumber, 'official PO number assigned on PM approval');
    } else if (poStatus === 'CHAIRMAN_PENDING') {
      const chairmanToken = await loginAs('chairman@bekem.com');
      const chairRes = await request(app)
        .post(`/api/purchase-orders/${poId}/approve`)
        .set('Authorization', `Bearer ${chairmanToken}`)
        .send({ note: 'Chairman approved' });
      assert.strictEqual(chairRes.status, 200);
      poStatus = chairRes.body.data.status;
      assert.ok(chairRes.body.data.poNumber, 'official PO number assigned on chairman approval');
    } else {
      assert.strictEqual(poStatus, 'APPROVED');
      assert.ok(verifyRes.body.data.poNumber, 'official PO number assigned on coordinator approval');
    }
    assert.strictEqual(poStatus, 'APPROVED');

    const finalMr = await MaterialRequest.findById(mrId);
    assert.strictEqual(finalMr.status, 'CHAIRMAN_APPROVED');

    const history = await StatusHistory.find({
      entityType: 'MaterialRequest',
      entityId: new mongoose.Types.ObjectId(mrId),
    }).sort({ timestamp: 1 });

    const statuses = history.map((h) => h.toStatus);
    assert.ok(statuses.includes('PENDING_STORE'));
    assert.ok(statuses.includes('FORWARDED_TO_PM'));
    assert.ok(statuses.includes('PM_APPROVED'));
    assert.ok(statuses.includes('PURCHASE_REQUESTED'));
    assert.ok(statuses.includes('CHAIRMAN_APPROVED'));

    const notifications = await Notification.find({
      relatedEntityId: new mongoose.Types.ObjectId(mrId),
    });
    assert.ok(notifications.length >= 1, 'Notifications should fire during chain');
  });
});
