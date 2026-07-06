/**
 * Multi partial GRN on one PO — price and quantity variance legs.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestDb, teardownTestDb, loginAs, getApp } = require('./test/helpers');
const { PurchaseOrder, GoodsReceiptNote } = require('./models');

const mandatoryAttachments = [
  { name: 'invoice.pdf', fileType: 'application/pdf', category: 'INVOICE' },
  { name: 'challan.pdf', fileType: 'application/pdf', category: 'CHALLAN' },
];

describe('GRN partial & multi receipt integration', () => {
  let app;
  let storeToken;
  let coordToken;

  before(async () => {
    await setupTestDb();
    app = getApp();
    storeToken = await loginAs('storeincharge@bekem.com');
    coordToken = await loginAs('coordinator@bekem.com');
  });

  after(async () => {
    await teardownTestDb();
  });

  it('records two partial GRNs then closes PO cumulatively', async () => {
    const pending = await request(app)
      .get('/api/goods-receipts/pending-purchase-orders')
      .set('Authorization', `Bearer ${storeToken}`);
    assert.strictEqual(pending.status, 200);

    let po = pending.body.data.find((p) => (p.lineItems?.[0]?.quantity || 0) >= 4);
    if (!po) {
      po = pending.body.data[0];
    }
    if (!po?.lineItems?.length) return;

    const line = po.lineItems[0];
    const half = Math.floor(line.quantity / 2) || 1;

    const first = await request(app)
      .post('/api/goods-receipts')
      .set('Authorization', `Bearer ${storeToken}`)
      .set('Idempotency-Key', `grn-multi-1-${po.id}`)
      .send({
        purchaseOrderId: po.id,
        items: [
          {
            materialId: line.materialId,
            quantityOrdered: line.quantity,
            quantityReceived: half,
            invoiceUnitPrice: line.rate,
            lineIndex: 0,
          },
        ],
        receiveType: 'PARTIAL',
        remarks: 'First partial — quantity variance',
        invoiceDate: new Date().toISOString(),
        attachments: mandatoryAttachments,
      });
    assert.strictEqual(first.status, 201);
    assert.ok(first.body.data.isPartialGrn || first.body.data.status === 'PARTIALLY_RECEIVED');

    const dbPo = await PurchaseOrder.findById(po.id);
    assert.strictEqual(dbPo.fulfillmentStatus, 'open_partial');

    const remainder = line.quantity - half;
    const second = await request(app)
      .post('/api/goods-receipts')
      .set('Authorization', `Bearer ${storeToken}`)
      .set('Idempotency-Key', `grn-multi-2-${po.id}`)
      .send({
        purchaseOrderId: po.id,
        items: [
          {
            materialId: line.materialId,
            quantityOrdered: line.quantity,
            quantityReceived: remainder,
            invoiceUnitPrice: line.rate + 5,
            lineIndex: 0,
          },
        ],
        receiveType: 'PARTIAL',
        remarks: 'Second partial — price variance',
        invoiceDate: new Date().toISOString(),
        attachments: mandatoryAttachments,
      });
    assert.strictEqual(second.status, 201);
    assert.equal(second.body.data.status, 'ON_HOLD');

    const holdGrnId = second.body.data.id;
    const approve = await request(app)
      .post(`/api/goods-receipts/${holdGrnId}/approve`)
      .set('Authorization', `Bearer ${coordToken}`)
      .send({});
    assert.strictEqual(approve.status, 200);

    const grnCount = await GoodsReceiptNote.countDocuments({ purchaseOrderId: po.id });
    assert.strictEqual(grnCount, 2);

    const closed = await PurchaseOrder.findById(po.id);
    if (half + remainder >= line.quantity) {
      assert.strictEqual(closed.fulfillmentStatus, 'closed_complete');
    }
  });
});
