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

async function approveHoldIfNeeded(app, grnPayload, coordToken, chairToken) {
  if (grnPayload.status !== 'ON_HOLD') return grnPayload;
  const id = grnPayload.id;
  let res = await request(app)
    .post(`/api/goods-receipts/${id}/approve`)
    .set('Authorization', `Bearer ${coordToken}`)
    .send({});
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  if (res.body.data?.approvalStage === 'CHAIRMAN_PENDING') {
    res = await request(app)
      .post(`/api/goods-receipts/${id}/approve`)
      .set('Authorization', `Bearer ${chairToken}`)
      .send({});
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  }
  return res.body.data;
}

describe('GRN partial & multi receipt integration', () => {
  let app;
  let storeToken;
  let coordToken;
  let chairToken;

  before(async () => {
    await setupTestDb();
    app = getApp();
    storeToken = await loginAs('storeincharge@bekem.com');
    coordToken = await loginAs('coordinator@bekem.com');
    chairToken = await loginAs('chairman@bekem.com');
  });

  after(async () => {
    await teardownTestDb();
  });

  it('records two partial GRNs then closes PO cumulatively', async () => {
    const pending = await request(app)
      .get('/api/goods-receipts/pending-purchase-orders')
      .set('Authorization', `Bearer ${storeToken}`);
    assert.strictEqual(pending.status, 200);

    let po = (pending.body.data || []).find(
      (p) =>
        (p.lineItems?.length || 0) === 1 &&
        (p.lineItems?.[0]?.quantity || 0) >= 4
    );
    if (!po) {
      po = (pending.body.data || []).find((p) => (p.lineItems?.[0]?.quantity || 0) >= 4);
    }
    if (!po) po = pending.body.data?.[0];
    if (!po?.lineItems?.length) return;

    await GoodsReceiptNote.deleteMany({ purchaseOrderId: po.id });
    await PurchaseOrder.findByIdAndUpdate(po.id, { fulfillmentStatus: 'open' });

    const line = po.lineItems[0];
    const half = Math.floor(line.quantity / 2) || 1;
    // Keep invoice under e-way threshold so under-receipt alone does not hold (unless price delta).
    const safeRate = Math.min(Number(line.rate) || 100, 100);

    const first = await request(app)
      .post('/api/goods-receipts')
      .set('Authorization', `Bearer ${storeToken}`)
      .set('Idempotency-Key', `grn-multi-1-${po.id}-${Date.now()}`)
      .send({
        purchaseOrderId: po.id,
        items: [
          {
            materialId: line.materialId,
            quantityOrdered: line.quantity,
            quantityReceived: half,
            invoiceUnitPrice: safeRate,
            lineIndex: 0,
          },
        ],
        receiveType: 'PARTIAL',
        remarks: 'First partial',
        invoiceDate: new Date().toISOString(),
        ewayBillNumber: 'EWAY-TEST-001',
        attachments: mandatoryAttachments,
      });
    assert.strictEqual(first.status, 201, JSON.stringify(first.body));
    await approveHoldIfNeeded(app, first.body.data, coordToken, chairToken);

    const dbPo = await PurchaseOrder.findById(po.id);
    assert.ok(
      ['open_partial', 'closed_complete'].includes(dbPo.fulfillmentStatus),
      `unexpected fulfillment after first GRN: ${dbPo.fulfillmentStatus}`
    );

    const remainder = line.quantity - half;
    const second = await request(app)
      .post('/api/goods-receipts')
      .set('Authorization', `Bearer ${storeToken}`)
      .set('Idempotency-Key', `grn-multi-2-${po.id}-${Date.now()}`)
      .send({
        purchaseOrderId: po.id,
        items: [
          {
            materialId: line.materialId,
            quantityOrdered: line.quantity,
            quantityReceived: remainder,
            invoiceUnitPrice: safeRate + 5,
            lineIndex: 0,
          },
        ],
        receiveType: 'PARTIAL',
        remarks: 'Second partial — price variance',
        invoiceDate: new Date().toISOString(),
        ewayBillNumber: 'EWAY-TEST-002',
        attachments: mandatoryAttachments,
      });
    assert.strictEqual(second.status, 201, JSON.stringify(second.body));
    assert.equal(second.body.data.status, 'ON_HOLD');
    await approveHoldIfNeeded(app, second.body.data, coordToken, chairToken);

    const grnCount = await GoodsReceiptNote.countDocuments({ purchaseOrderId: po.id });
    assert.strictEqual(grnCount, 2);

    const closed = await PurchaseOrder.findById(po.id);
    if (half + remainder >= line.quantity) {
      assert.strictEqual(closed.fulfillmentStatus, 'closed_complete');
    }
  });
});
