const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { PaymentBill, PurchaseOrder, PurchaseRequest } = require('./models');
const {
  setupTestDb,
  teardownTestDb,
  loginAs,
  getApp,
} = require('./test/helpers');

describe('Finance partial payments & visibility', () => {
  let app;
  let coordToken;
  let chairmanToken;
  let pmToken;
  let storeToken;
  let executiveToken;

  before(async () => {
    await setupTestDb();
    app = getApp();
    coordToken = await loginAs('coordinator@bekem.com');
    chairmanToken = await loginAs('chairman@bekem.com');
    pmToken = await loginAs('pm@bekem.com');
    storeToken = await loginAs('storeincharge@bekem.com');
    executiveToken = await loginAs('executive@bekem.com');
  });

  after(async () => {
    await teardownTestDb();
  });

  it('Coordinator can record partial then full payment on a bill', async () => {
    let bill = await PaymentBill.findOne({ paymentStatus: 'PENDING' });
    if (!bill) {
      const po = await PurchaseOrder.findOne({ status: 'APPROVED' });
      assert.ok(po);
      const pr = await PurchaseRequest.findById(po.purchaseRequestId);
      bill = await PaymentBill.create({
        billNumber: 'BILL/GRN-UAT-001',
        purchaseOrderId: po._id,
        vendorId: po.vendorId,
        projectId: pr?.projectId,
        invoiceNumber: 'INV-UAT-001',
        invoiceValue: 100000,
        outstandingAmount: 100000,
        paymentStatus: 'PENDING',
        invoiceStatus: 'BILL_RECEIVED',
        tallySyncStatus: 'PENDING',
        dueDate: new Date(Date.now() + 30 * 86400000),
      });
    }
    const half = Math.round(bill.invoiceValue / 2);
    const partial = await request(app)
      .patch(`/api/finance/bills/${bill._id}/payment`)
      .set('Authorization', `Bearer ${coordToken}`)
      .send({ paymentAmount: half, paymentRemark: 'First instalment against vendor invoice' });

    assert.strictEqual(partial.status, 200);
    assert.strictEqual(partial.body.data.paymentStatus, 'PARTIAL');
    assert.strictEqual(partial.body.data.paidAmount, half);
    assert.ok(partial.body.data.outstandingAmount > 0);

    const remainder = bill.invoiceValue - half;
    const full = await request(app)
      .patch(`/api/finance/bills/${bill._id}/payment`)
      .set('Authorization', `Bearer ${coordToken}`)
      .send({
        paymentAmount: remainder,
        paymentRemark: 'Final settlement',
        tallySyncStatus: 'SYNCED',
        tallyVoucherId: 'TALLY-DEMO',
      });

    assert.strictEqual(full.status, 200);
    assert.strictEqual(full.body.data.paymentStatus, 'PAID');
    assert.strictEqual(full.body.data.outstandingAmount, 0);
    assert.strictEqual(full.body.data.tallySyncStatus, 'SYNCED');
  });

  it('Chairman, Executive, PM, and Store can view finance bills', async () => {
    for (const token of [chairmanToken, executiveToken, pmToken, storeToken]) {
      const res = await request(app)
        .get('/api/finance/bills')
        .set('Authorization', `Bearer ${token}`);
      assert.strictEqual(res.status, 200, 'finance bills should be visible');
      assert.ok(Array.isArray(res.body.data));
    }
  });

  it('PM finance summary is scoped to assigned projects', async () => {
    const [pmRes, execRes] = await Promise.all([
      request(app).get('/api/finance/summary').set('Authorization', `Bearer ${pmToken}`),
      request(app).get('/api/finance/summary').set('Authorization', `Bearer ${executiveToken}`),
    ]);
    assert.strictEqual(pmRes.status, 200);
    assert.strictEqual(execRes.status, 200);
    assert.ok(pmRes.body.data.total <= execRes.body.data.total);
  });

  it('Site Incharge cannot access finance', async () => {
    const token = await loginAs('request@bekem.com');
    const res = await request(app)
      .get('/api/finance/bills')
      .set('Authorization', `Bearer ${token}`);
    assert.strictEqual(res.status, 403);
  });
});
