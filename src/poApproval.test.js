const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const {
  setupTestDb,
  teardownTestDb,
  loginAs,
  getApp,
} = require('./test/helpers');
const { PurchaseOrder, PurchaseRequest, MaterialRequest, GoodsReceiptNote, Site, User, StockLedger } = require('./models');

describe('PO approval & vendor MSME', () => {
  let app;
  let coordToken;
  let chairmanToken;
  let execToken;

  before(async () => {
    await setupTestDb();
    app = getApp();
    coordToken = await loginAs('coordinator@bekem.com');
    chairmanToken = await loginAs('chairman@bekem.com');
    execToken = await loginAs('executive@bekem.com');
  });

  after(async () => {
    await teardownTestDb();
  });

  it('rejects MSME vendor without certificate', async () => {
    const res = await request(app)
      .post('/api/vendors')
      .set('Authorization', `Bearer ${coordToken}`)
      .send({
        name: 'MSME Test Vendor',
        isMsme: true,
        msmeNumber: 'UDYAM-KA-01-0001234',
        gstNumber: '29AAAAA0000A1Z5',
      });
    assert.strictEqual(res.status, 400);
  });

  it('creates non-MSME vendor without MSME fields', async () => {
    const res = await request(app)
      .post('/api/vendors')
      .set('Authorization', `Bearer ${coordToken}`)
      .send({
        name: 'Plain Vendor Pvt Ltd',
        isMsme: false,
        gstNumber: '29BBBBB0000B1Z5',
        code: 'PLN',
        panNumber: 'AABCP1234A',
        contactPerson: 'Raj',
        phone: '9876543210',
        bankName: 'HDFC Bank',
        bankAccountNumber: '123456789012',
        ifscCode: 'HDFC0001234',
      });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.data.isMsme, false);
    assert.ok(!res.body.data.msmeNumber);
  });

  it('rejects override remark under 30 characters', async () => {
    const po = await PurchaseOrder.findOne({ status: 'COORDINATOR_PENDING', amount: { $gt: 10000 } });
    assert.ok(po);

    const res = await request(app)
      .post(`/api/purchase-orders/${po._id}/approve-override`)
      .set('Authorization', `Bearer ${coordToken}`)
      .send({ remark: 'Too short remark' });
    assert.strictEqual(res.status, 400);
  });

  it('rejects override remark over 300 characters', async () => {
    const po = await PurchaseOrder.findOne({ status: 'COORDINATOR_PENDING' });
    assert.ok(po);
    const verifyRes = await request(app)
      .post(`/api/purchase-orders/${po._id}/verify`)
      .set('Authorization', `Bearer ${coordToken}`)
      .send({ action: 'APPROVE', note: 'Verified for chairman queue' });
    assert.strictEqual(verifyRes.status, 200);
    assert.strictEqual(verifyRes.body.data.status, 'CHAIRMAN_PENDING');

    const res = await request(app)
      .post(`/api/purchase-orders/${po._id}/approve-override`)
      .set('Authorization', `Bearer ${coordToken}`)
      .send({ remark: 'x'.repeat(301) });
    assert.strictEqual(res.status, 400);
  });

  it('coordinator cannot bypass Chairman approval from the verify queue', async () => {
    const po = await PurchaseOrder.findOne({ poNumber: 'PO-PRJ-001-2025-008' });
    assert.ok(po);
    po.status = 'COORDINATOR_PENDING';
    po.amount = 216329.4;
    await po.save();
    const remark =
      'Chairman is not on premises today — site pour cannot wait for final sign-off.';

    const res = await request(app)
      .post(`/api/purchase-orders/${po._id}/approve-override`)
      .set('Authorization', `Bearer ${coordToken}`)
      .send({ remark });
    assert.strictEqual(res.status, 403);
    assert.strictEqual((await PurchaseOrder.findById(po._id)).status, 'COORDINATOR_PENDING');
  });

  it('coordinator cannot bypass Chairman approval from Chairman queue', async () => {
    const po = await PurchaseOrder.findOne({ draftRef: 'DRAFT-PO-2025-014' });
    assert.ok(po);
    po.status = 'CHAIRMAN_PENDING';
    po.amount = 1850000;
    await po.save();
    const remark = 'Chairman travelling — emergency procurement required for site pour.';

    const first = await request(app)
      .post(`/api/purchase-orders/${po._id}/approve-override`)
      .set('Authorization', `Bearer ${coordToken}`)
      .send({ remark });
    assert.strictEqual(first.status, 403);

    const second = await request(app)
      .post(`/api/purchase-orders/${po._id}/approve-override`)
      .set('Authorization', `Bearer ${coordToken}`)
      .send({ remark });
    assert.strictEqual(second.status, 403);

    const updated = await PurchaseOrder.findById(po._id);
    assert.strictEqual(updated.status, 'CHAIRMAN_PENDING');
  });

  it('chairman approval is idempotent on double-click', async () => {
    const draftPo = await PurchaseOrder.findOne({ poNumber: 'PO-PRJ-002-2025-003' });
    assert.ok(draftPo);
    draftPo.status = 'COORDINATOR_PENDING';
    draftPo.amount = 20000;
    draftPo.approvalDispatchedAt = null;
    await draftPo.save();

    const verified = await request(app).post(`/api/purchase-orders/${draftPo._id}/verify`)
      .set('Authorization', `Bearer ${coordToken}`).send({ action: 'APPROVE', note: 'Coordinator verified' });
    assert.strictEqual(verified.status, 200);
    assert.strictEqual(verified.body.data.status, 'CHAIRMAN_PENDING');

    const first = await request(app)
      .post(`/api/purchase-orders/${draftPo._id}/approve`)
      .set('Authorization', `Bearer ${chairmanToken}`)
      .send({ note: 'Approved' });
    assert.strictEqual(first.status, 200);

    const second = await request(app)
      .post(`/api/purchase-orders/${draftPo._id}/approve`)
      .set('Authorization', `Bearer ${chairmanToken}`)
      .send({ note: 'Approved again' });
    assert.strictEqual(second.status, 200);

    const updated = await PurchaseOrder.findById(draftPo._id);
    assert.strictEqual(updated.status, 'APPROVED');
    assert.ok(updated.approvalDispatchedAt);
  });

  it('requires Coordinator then Chairman approval for a low-value purchase order', async () => {
    const po = await PurchaseOrder.findOne({ poNumber: 'PO-PRJ-001-2025-008' });
    po.status = 'COORDINATOR_PENDING';
    po.amount = 1000;
    po.coordinatorVerifiedByUserId = undefined;
    po.coordinatorVerifiedAt = undefined;
    await po.save();
    const premature = await request(app).post(`/api/purchase-orders/${po._id}/approve`)
      .set('Authorization', `Bearer ${chairmanToken}`).send({ note: 'Too early' });
    assert.equal(premature.status, 400);
    const verified = await request(app).post(`/api/purchase-orders/${po._id}/verify`)
      .set('Authorization', `Bearer ${coordToken}`).send({ action: 'APPROVE' });
    assert.equal(verified.status, 200, JSON.stringify(verified.body));
    assert.equal(verified.body.data.status, 'CHAIRMAN_PENDING');
    const approved = await request(app).post(`/api/purchase-orders/${po._id}/approve`)
      .set('Authorization', `Bearer ${chairmanToken}`).send({ note: 'Final approval' });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.data.status, 'APPROVED');
    const saved = await PurchaseOrder.findById(po._id);
    assert.ok(saved.coordinatorVerifiedByUserId && saved.coordinatorVerifiedAt && saved.approvedByUserId);
  });

  it('blocks a legacy Chairman queue entry with no Coordinator verification evidence', async () => {
    const po = await PurchaseOrder.findOne({ draftRef: 'DRAFT-PO-2025-014' });
    po.status = 'CHAIRMAN_PENDING';
    po.coordinatorVerifiedByUserId = undefined;
    po.coordinatorVerifiedAt = undefined;
    await po.save();
    const response = await request(app).post(`/api/purchase-orders/${po._id}/approve`)
      .set('Authorization', `Bearer ${chairmanToken}`).send({ note: 'Approve' });
    assert.equal(response.status, 409);
    assert.match(response.body.message, /Coordinator verification/i);
    assert.equal((await PurchaseOrder.findById(po._id)).status, 'CHAIRMAN_PENDING');
  });

  it('returns an edited Chairman-pending PO for fresh Coordinator verification', async () => {
    const po = await PurchaseOrder.findOne({ draftRef: 'DRAFT-PO-2025-014' });
    po.status = 'COORDINATOR_PENDING';
    await po.save();
    const verify = await request(app).post(`/api/purchase-orders/${po._id}/verify`)
      .set('Authorization', `Bearer ${coordToken}`).send({ action: 'APPROVE', note: 'First review' });
    assert.equal(verify.status, 200);
    const edit = await request(app).patch(`/api/purchase-orders/${po._id}`)
      .set('Authorization', `Bearer ${chairmanToken}`).send({ referenceNote: 'Synthetic correction' });
    assert.equal(edit.status, 200, JSON.stringify(edit.body));
    assert.equal(edit.body.data.status, 'COORDINATOR_PENDING');
    const saved = await PurchaseOrder.findById(po._id);
    assert.ok(!saved.coordinatorVerifiedByUserId && !saved.coordinatorVerifiedAt);
    const chair = await request(app).post(`/api/purchase-orders/${po._id}/approve`)
      .set('Authorization', `Bearer ${chairmanToken}`).send({ note: 'Premature approval' });
    assert.equal(chair.status, 400);
  });

  it('rejects a stale final approval after a purchase-order edit', async () => {
    const po = await PurchaseOrder.findOne({ draftRef: 'DRAFT-PO-2025-014' });
    po.status = 'COORDINATOR_PENDING';
    await po.save();
    const verified = await request(app).post(`/api/purchase-orders/${po._id}/verify`)
      .set('Authorization', `Bearer ${coordToken}`).send({ action: 'APPROVE' });
    assert.equal(verified.status, 200);
    const staleApproval = await PurchaseOrder.findById(po._id);
    const edit = await request(app).patch(`/api/purchase-orders/${po._id}`)
      .set('Authorization', `Bearer ${chairmanToken}`).send({ referenceNote: 'Concurrent synthetic correction' });
    assert.equal(edit.status, 200);
    staleApproval.status = 'APPROVED';
    await assert.rejects(staleApproval.save(), { name: 'VersionError' });
    const saved = await PurchaseOrder.findById(po._id);
    assert.equal(saved.status, 'COORDINATOR_PENDING');
    assert.equal(saved.referenceNote, 'Concurrent synthetic correction');
  });

  it('requires both approvals again when an approved PO with a receipt is amended', async () => {
    const po = await PurchaseOrder.findOne({ status: 'APPROVED', coordinatorVerifiedByUserId: { $exists: true } });
    assert.ok(po);
    const site = await Site.findOne();
    const store = await User.findOne({ role: 'STORE_INCHARGE' });
    const grn = await GoodsReceiptNote.create({ grnNumber: 'TEST-AMENDMENT-GRN', purchaseOrderId: po._id,
      siteId: site._id, receivedByUserId: store._id, status: 'RECEIVED', items: [] });
    const pr = await PurchaseRequest.findById(po.purchaseRequestId);
    await MaterialRequest.findByIdAndUpdate(pr.materialRequestId, { status: 'COMPLETED' });
    const beforeLedgers = await StockLedger.find({ siteId: site._id }).lean();
    const previousNote = po.referenceNote || '';
    const edit = await request(app).patch(`/api/purchase-orders/${po._id}`)
      .set('Authorization', `Bearer ${chairmanToken}`).send({ referenceNote: 'Synthetic amended terms' });
    assert.equal(edit.status, 200, JSON.stringify(edit.body));
    assert.equal(edit.body.data.status, 'COORDINATOR_PENDING');
    let saved = await PurchaseOrder.findById(po._id);
    assert.equal(saved.amendmentHistory.length, 1);
    assert.equal(saved.amendmentHistory[0].previousOrder.referenceNote || '', previousNote);
    assert.ok(!saved.approvedByUserId && !saved.coordinatorVerifiedByUserId);
    assert.ok(await GoodsReceiptNote.exists({ _id: grn._id, purchaseOrderId: po._id, status: 'RECEIVED' }));
    assert.deepEqual(await StockLedger.find({ siteId: site._id }).lean(), beforeLedgers);
    const verify = await request(app).post(`/api/purchase-orders/${po._id}/verify`)
      .set('Authorization', `Bearer ${coordToken}`).send({ action: 'APPROVE' });
    assert.equal(verify.status, 200);
    assert.equal(verify.body.data.status, 'CHAIRMAN_PENDING');
    const approve = await request(app).post(`/api/purchase-orders/${po._id}/approve`)
      .set('Authorization', `Bearer ${chairmanToken}`).send({ note: 'Approve amended order' });
    assert.equal(approve.status, 200, JSON.stringify(approve.body));
    saved = await PurchaseOrder.findById(po._id);
    assert.equal(saved.status, 'APPROVED');
    assert.equal(saved.referenceNote, 'Synthetic amended terms');
    assert.ok(await GoodsReceiptNote.exists({ _id: grn._id, purchaseOrderId: po._id, status: 'RECEIVED' }));
    assert.equal((await MaterialRequest.findById(pr.materialRequestId)).status, 'COMPLETED');
  });

  it('GET approval-history exposes override metadata', async () => {
    const po = await PurchaseOrder.findOne({ status: 'APPROVED' });
    assert.ok(po);
    po.approvedAsChairmanOverride = true;
    po.overrideRemark = 'Historical synthetic override record';
    await po.save();
    const res = await request(app)
      .get(`/api/purchase-orders/${po._id}/approval-history`)
      .set('Authorization', `Bearer ${execToken}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.meta.approvedAsChairmanOverride, true);
    assert.ok(res.body.meta.overrideRemark);
  });
});
