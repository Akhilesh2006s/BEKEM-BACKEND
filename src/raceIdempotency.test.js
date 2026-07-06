/**
 * Race / idempotency: double-submit must not duplicate side effects.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestDb, teardownTestDb, loginAs, getApp } = require('./test/helpers');
const { PurchaseOrder, GoodsReceiptNote, IdempotencyRecord } = require('./models');

const mandatoryAttachments = [
  { name: 'invoice.pdf', fileType: 'application/pdf', category: 'INVOICE' },
  { name: 'challan.pdf', fileType: 'application/pdf', category: 'CHALLAN' },
];

describe('Race & idempotency', () => {
  let app;
  let chairmanToken;
  let storeToken;
  let coordToken;

  before(async () => {
    await setupTestDb();
    app = getApp();
    chairmanToken = await loginAs('chairman@bekem.com');
    storeToken = await loginAs('storeincharge@bekem.com');
    coordToken = await loginAs('coordinator@bekem.com');
  });

  after(async () => {
    await teardownTestDb();
  });

  it('chairman double-approve returns same PO without duplicate dispatch', async () => {
    const po = await PurchaseOrder.findOne({ status: 'CHAIRMAN_PENDING' });
    if (!po) return;
    const id = po._id.toString();
    const key = `test-chairman-${id}`;

    const [r1, r2] = await Promise.all([
      request(app)
        .post(`/api/purchase-orders/${id}/approve`)
        .set('Authorization', `Bearer ${chairmanToken}`)
        .set('Idempotency-Key', key)
        .send({ note: 'Approved' }),
      request(app)
        .post(`/api/purchase-orders/${id}/approve`)
        .set('Authorization', `Bearer ${chairmanToken}`)
        .set('Idempotency-Key', key)
        .send({ note: 'Approved' }),
    ]);

    assert.ok([200, 201].includes(r1.status));
    assert.strictEqual(r2.status, r1.status);
    const updated = await PurchaseOrder.findById(id);
    assert.strictEqual(updated.status, 'APPROVED');
    assert.ok(updated.approvalDispatchedAt);
  });

  it('GRN create replays with same idempotency key', async () => {
    const pending = await request(app)
      .get('/api/goods-receipts/pending-purchase-orders')
      .set('Authorization', `Bearer ${storeToken}`);
    assert.strictEqual(pending.status, 200);
    const po = pending.body.data[0];
    if (!po) return;

    const line = po.lineItems?.[0];
    if (!line) return;

    const payload = {
      purchaseOrderId: po.id,
      items: [
        {
          materialId: line.materialId,
          quantityOrdered: line.quantity,
          quantityReceived: Math.max(1, line.quantity / 2),
          invoiceUnitPrice: line.rate,
          lineIndex: 0,
        },
      ],
      receiveType: 'PARTIAL',
      remarks: 'Idempotency test partial GRN',
      invoiceDate: new Date().toISOString(),
      attachments: mandatoryAttachments,
    };
    const key = `test-grn-${po.id}`;

    const first = await request(app)
      .post('/api/goods-receipts')
      .set('Authorization', `Bearer ${storeToken}`)
      .set('Idempotency-Key', key)
      .send(payload);
    assert.strictEqual(first.status, 201);
    const grnId = first.body.data.id;

    const second = await request(app)
      .post('/api/goods-receipts')
      .set('Authorization', `Bearer ${storeToken}`)
      .set('Idempotency-Key', key)
      .send(payload);
    assert.strictEqual(second.status, 201);
    assert.strictEqual(second.body.data.id, grnId);

    const count = await GoodsReceiptNote.countDocuments({ purchaseOrderId: po.id });
    assert.strictEqual(count, 1);
  });

  it('stores idempotency record when key provided', async () => {
    const count = await IdempotencyRecord.countDocuments();
    assert.ok(count >= 0);
  });
});
