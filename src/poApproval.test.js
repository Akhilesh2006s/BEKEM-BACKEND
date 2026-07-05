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
      });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.data.isMsme, false);
    assert.ok(!res.body.data.msmeNumber);
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

  it('coordinator override approval records remark and dispatches once', async () => {
    const po = await PurchaseOrder.findOne({ status: 'CHAIRMAN_PENDING' });
    assert.ok(po);
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
    const draftPo = await PurchaseOrder.findOne({ status: 'DRAFT' });
    assert.ok(draftPo);
    draftPo.status = 'CHAIRMAN_PENDING';
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
