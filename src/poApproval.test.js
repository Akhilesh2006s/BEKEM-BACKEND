const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const {
  setupTestDb,
  teardownTestDb,
  loginAs,
  getApp,
} = require('./test/helpers');
const { PurchaseOrder } = require('./models');

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

  it('coordinator can emergency-approve >₹10k PO directly from verify queue', async () => {
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
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.status, 'APPROVED');
    assert.strictEqual(res.body.data.approvedAsChairmanOverride, true);
    assert.strictEqual(res.body.data.overrideRemark, remark);
  });

  it('coordinator override approval records remark and dispatches once', async () => {
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
    if (first.status !== 200) {
      assert.fail(`override failed: ${first.status} ${first.body?.message}`);
    }
    assert.strictEqual(first.body.data.approvedAsChairmanOverride, true);
    assert.strictEqual(first.body.data.overrideRemark, remark);

    const second = await request(app)
      .post(`/api/purchase-orders/${po._id}/approve-override`)
      .set('Authorization', `Bearer ${coordToken}`)
      .send({ remark });
    assert.strictEqual(second.status, 200);

    const updated = await PurchaseOrder.findById(po._id);
    assert.strictEqual(updated.status, 'APPROVED');
    assert.ok(updated.approvalDispatchedAt);
  });

  it('chairman approval is idempotent on double-click', async () => {
    const draftPo = await PurchaseOrder.findOne({ poNumber: 'PO-PRJ-002-2025-003' });
    assert.ok(draftPo);
    draftPo.status = 'CHAIRMAN_PENDING';
    draftPo.approvalDispatchedAt = null;
    await draftPo.save();

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

  it('GET approval-history exposes override metadata', async () => {
    const po = await PurchaseOrder.findOne({
      status: 'APPROVED',
      approvedAsChairmanOverride: true,
    });
    assert.ok(po);
    const res = await request(app)
      .get(`/api/purchase-orders/${po._id}/approval-history`)
      .set('Authorization', `Bearer ${execToken}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.meta.approvedAsChairmanOverride, true);
    assert.ok(res.body.meta.overrideRemark);
  });
});
