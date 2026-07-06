/**
 * GRN hold workflow: variance → ON_HOLD, mandatory uploads, coordinator/chairman approval.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestDb, teardownTestDb, loginAs, getApp } = require('./test/helpers');
const {
  User,
  PurchaseOrder,
  PurchaseRequest,
  Project,
  Vendor,
  Material,
  Site,
  GoodsReceiptNote,
  DeliveryVerification,
  PaymentBill,
  StockLedger,
} = require('./models');
const { assessGrnHold } = require('./services/grnHoldService');

function grnPayload(po, line, { qty, rate, attachments }) {
  return {
    purchaseOrderId: po._id.toString(),
    invoiceDate: new Date().toISOString(),
    invoiceNo: `INV-${Date.now()}`,
    challanNo: 'CH-TEST',
    receiveType: 'PARTIAL',
    attachments,
    items: [
      {
        materialId: line.materialId.toString(),
        quantityOrdered: line.quantity,
        quantityReceived: qty,
        invoiceUnitPrice: rate,
        lineIndex: 0,
      },
    ],
  };
}

describe('GRN hold & approval workflow', () => {
  let app;
  let storeToken;
  let coordToken;
  let chairmanToken;
  let po;
  let site;
  let line;

  before(async () => {
    await setupTestDb();
    app = getApp();
    storeToken = await loginAs('storeincharge@bekem.com');
    coordToken = await loginAs('coordinator@bekem.com');
    chairmanToken = await loginAs('chairman@bekem.com');

    const project = await Project.findOne();
    const vendor = await Vendor.findOne();
    const material = await Material.findOne();
    site = await Site.findOne();
    const pr = await PurchaseRequest.findOne({ projectId: project._id });
    assert.ok(pr);

    po = await PurchaseOrder.create({
      draftRef: 'TEST-GRN-HOLD',
      purchaseRequestId: pr._id,
      vendorId: vendor._id,
      amount: 100000,
      paymentTerms: 'Net 30',
      lineItems: [
        {
          description: 'Hold test item',
          materialId: material._id,
          quantity: 10,
          rate: 100,
          gstPercent: 18,
          amount: 1000,
        },
      ],
      status: 'APPROVED',
      fulfillmentStatus: 'open_partial',
    });
    line = po.lineItems[0];

    await DeliveryVerification.findOneAndUpdate(
      { purchaseOrderId: po._id },
      {
        purchaseOrderId: po._id,
        siteId: site._id,
        items: [
          {
            materialId: line.materialId,
            quantityOrdered: line.quantity,
            quantityVerified: line.quantity,
            condition: 'OK',
          },
        ],
        verifiedByUserId: (await User.findOne({ role: 'STORE_INCHARGE' }))._id,
      },
      { upsert: true, new: true }
    );
  });

  after(async () => {
    if (po) {
      await GoodsReceiptNote.deleteMany({ purchaseOrderId: po._id });
      await PaymentBill.deleteMany({ purchaseOrderId: po._id });
      await DeliveryVerification.deleteMany({ purchaseOrderId: po._id });
      await PurchaseOrder.deleteOne({ _id: po._id });
    }
    await teardownTestDb();
  });

  const mandatoryAttachments = [
    { name: 'invoice.pdf', fileType: 'application/pdf', category: 'INVOICE' },
    { name: 'challan.pdf', fileType: 'application/pdf', category: 'CHALLAN' },
  ];

  it('assessGrnHold flags price, quantity, and e-way variances', () => {
    const hold = assessGrnHold(
      [
        { priceDeviation: true, qtyDeviation: false },
        { priceDeviation: false, qtyDeviation: true, receivedQty: 12, remainingQty: 10 },
      ],
      { invoiceValue: 60000, ewayBillNumber: '', saveDraft: false }
    );
    assert.equal(hold.requiresHold, true);
    assert.equal(hold.requiresChairmanApproval, true);
    assert.ok(hold.holdReasons.includes('PRICE'));
    assert.ok(hold.holdReasons.includes('QTY'));
    assert.ok(hold.holdReasons.includes('EWAY'));
  });

  it('creates ON_HOLD GRN without stock when e-way bill missing above threshold', async () => {
    const res = await request(app)
      .post('/api/goods-receipts')
      .set('Authorization', `Bearer ${storeToken}`)
      .set('Idempotency-Key', `grn-hold-eway-${po._id}`)
      .send({
        ...grnPayload(po, line, {
          qty: 2,
          rate: 30000,
          attachments: mandatoryAttachments,
        }),
        invoiceValue: 60000,
        ewayBillNumber: '',
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.data.status, 'ON_HOLD');
    assert.ok(res.body.data.holdReasons.includes('EWAY'));

    await GoodsReceiptNote.deleteOne({ _id: res.body.data.id });
  });

  it('rejects submit without mandatory uploads', async () => {
    const res = await request(app)
      .post('/api/goods-receipts')
      .set('Authorization', `Bearer ${storeToken}`)
      .send(grnPayload(po, line, { qty: 1, rate: 100, attachments: [] }));

    assert.equal(res.status, 400);
    assert.match(res.body.message, /Invoice and Challan/i);
  });

  it('creates ON_HOLD GRN without stock when invoice rate differs', async () => {
    const ledgerBefore = await StockLedger.findOne({
      siteId: site._id,
      materialId: line.materialId,
    });
    const beforeQty = ledgerBefore?.quantityOnHand || 0;

    const res = await request(app)
      .post('/api/goods-receipts')
      .set('Authorization', `Bearer ${storeToken}`)
      .set('Idempotency-Key', `grn-hold-price-${po._id}`)
      .send(grnPayload(po, line, { qty: 5, rate: 110, attachments: mandatoryAttachments }));

    assert.equal(res.status, 201);
    assert.equal(res.body.data.status, 'ON_HOLD');
    assert.equal(res.body.data.approvalStage, 'COORDINATOR_PENDING');
    assert.ok(res.body.data.holdReasons.includes('PRICE'));

    const grn = await GoodsReceiptNote.findOne({
      purchaseOrderId: po._id,
      status: 'ON_HOLD',
      holdReasons: 'PRICE',
    });
    assert.ok(grn);
    assert.equal((await PaymentBill.countDocuments({ grnId: grn._id })), 0);

    const ledgerAfter = await StockLedger.findOne({
      siteId: site._id,
      materialId: line.materialId,
    });
    assert.equal(ledgerAfter?.quantityOnHand || 0, beforeQty);
  });

  it('coordinator approves price-variance hold and allocates stock', async () => {
    const grn = await GoodsReceiptNote.findOne({
      purchaseOrderId: po._id,
      status: 'ON_HOLD',
      holdReasons: 'PRICE',
    });
    assert.ok(grn);

    const res = await request(app)
      .post(`/api/goods-receipts/${grn._id}/approve`)
      .set('Authorization', `Bearer ${coordToken}`)
      .send({});

    assert.equal(res.status, 200);
    assert.equal(res.body.data.approvalStage, 'APPROVED');
    assert.notEqual(res.body.data.status, 'ON_HOLD');

    const updated = await GoodsReceiptNote.findById(grn._id);
    assert.equal(updated.approvalStage, 'APPROVED');
    assert.ok(await PaymentBill.findOne({ grnId: grn._id }));
  });

  it('over-receipt requires chairman approval after coordinator sign-off', async () => {
    const res = await request(app)
      .post('/api/goods-receipts')
      .set('Authorization', `Bearer ${storeToken}`)
      .set('Idempotency-Key', `grn-hold-qty-${po._id}`)
      .send(grnPayload(po, line, { qty: 8, rate: 100, attachments: mandatoryAttachments }));

    assert.equal(res.status, 201);
    assert.equal(res.body.data.status, 'ON_HOLD');
    assert.equal(res.body.data.requiresChairmanApproval, true);

    const grn = await GoodsReceiptNote.findOne({
      purchaseOrderId: po._id,
      status: 'ON_HOLD',
      approvalStage: 'COORDINATOR_PENDING',
    });
    assert.ok(grn);

    const coordRes = await request(app)
      .post(`/api/goods-receipts/${grn._id}/approve`)
      .set('Authorization', `Bearer ${coordToken}`)
      .send({});
    assert.equal(coordRes.status, 200);
    assert.equal(coordRes.body.data.approvalStage, 'CHAIRMAN_PENDING');
    assert.equal(coordRes.body.data.status, 'ON_HOLD');

    const chairRes = await request(app)
      .post(`/api/goods-receipts/${grn._id}/approve`)
      .set('Authorization', `Bearer ${chairmanToken}`)
      .send({});
    assert.equal(chairRes.status, 200);
    assert.equal(chairRes.body.data.approvalStage, 'APPROVED');
    assert.notEqual(chairRes.body.data.status, 'ON_HOLD');
  });
});
