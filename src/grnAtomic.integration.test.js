const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestDb, teardownTestDb, loginAs, getApp } = require('./test/helpers');
const { Project, Vendor, Material, Site, PurchaseRequest, PurchaseOrder, GoodsReceiptNote, StockBatch, StockLedger, PaymentBill } = require('./models');

describe('Atomic GRN posting and invoice uniqueness', () => {
  let app, storeToken, coordinatorToken, po, site, line, receiptId;
  before(async () => {
    await setupTestDb();
    app = getApp();
    storeToken = await loginAs('storeincharge@bekem.com');
    coordinatorToken = await loginAs('coordinator@bekem.com');
    const project = await Project.findOne();
    const vendor = await Vendor.findOne();
    const material = await Material.findOne();
    site = await Site.findOne({ projectId: project._id });
    const pr = await PurchaseRequest.findOne({ projectId: project._id });
    po = await PurchaseOrder.create({
      draftRef: 'TEST-ATOMIC-GRN', purchaseRequestId: pr._id, vendorId: vendor._id,
      amount: 1000, paymentTerms: 'Net 30', status: 'APPROVED', fulfillmentStatus: 'open_partial',
      lineItems: [{ materialId: material._id, description: 'Synthetic item', quantity: 10, rate: 100, gstPercent: 18, amount: 1000 }],
    });
    line = po.lineItems[0];
  });
  after(async () => { await teardownTestDb(); });
  function payload(invoiceNo) {
    return {
      purchaseOrderId: po._id.toString(), invoiceNo, invoiceDate: new Date().toISOString(), challanNo: 'TEST-CHALLAN',
      receiveType: 'PARTIAL', attachments: [
        { name: 'invoice.pdf', fileType: 'application/pdf', category: 'INVOICE' },
        { name: 'challan.pdf', fileType: 'application/pdf', category: 'CHALLAN' },
      ],
      items: [{ materialId: line.materialId.toString(), lineIndex: 0, quantityOrdered: 10, quantityReceived: 1, invoiceUnitPrice: 100 }],
    };
  }
  it('only creates one GRN when an invoice is submitted concurrently', async () => {
    const responses = await Promise.all([1, 2].map(() => request(app).post('/api/goods-receipts')
      .set('Authorization', `Bearer ${storeToken}`).send(payload('TEST-ATOMIC-INVOICE'))));
    assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
    assert.equal(await GoodsReceiptNote.countDocuments({ purchaseOrderId: po._id, invoiceNo: 'TEST-ATOMIC-INVOICE' }), 1);
    receiptId = responses.find((r) => r.status === 201).body.data.id;
  });
  it('does not overcommit a PO when different invoices arrive concurrently', async () => {
    const single = await PurchaseOrder.create({
      draftRef: 'TEST-ATOMIC-ONE-UNIT', purchaseRequestId: po.purchaseRequestId,
      vendorId: po.vendorId, amount: 100, paymentTerms: 'Net 30', status: 'APPROVED', fulfillmentStatus: 'open_partial',
      lineItems: [{ materialId: line.materialId, description: 'One unit', quantity: 1, rate: 100, gstPercent: 18, amount: 100 }],
    });
    const responses = await Promise.all(['TEST-ATOMIC-DIFFERENT-1', 'TEST-ATOMIC-DIFFERENT-2'].map((invoiceNo) => {
      const body = payload(invoiceNo);
      body.purchaseOrderId = single._id.toString();
      body.items[0].quantityOrdered = 1;
      return request(app).post('/api/goods-receipts').set('Authorization', `Bearer ${storeToken}`).send(body);
    }));
    assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
    assert.equal(await GoodsReceiptNote.countDocuments({ purchaseOrderId: single._id }), 1);
  });
  it('rolls back approval, inventory and finance if a finance write fails', async () => {
    const before = await StockLedger.findOne({ siteId: site._id, materialId: line.materialId }).lean();
    const original = PaymentBill.create;
    PaymentBill.create = async () => { throw new Error('Injected finance write failure'); };
    let response;
    try {
      response = await request(app).post(`/api/goods-receipts/${receiptId}/approve`)
        .set('Authorization', `Bearer ${coordinatorToken}`).send({});
    } finally { PaymentBill.create = original; }
    assert.equal(response.status, 500);
    const after = await StockLedger.findOne({ siteId: site._id, materialId: line.materialId }).lean();
    const grn = await GoodsReceiptNote.findById(receiptId).lean();
    assert.equal(grn.status, 'ON_HOLD');
    assert.equal(grn.approvalStage, 'COORDINATOR_PENDING');
    assert.equal(after?.quantityOnHand ?? 0, before?.quantityOnHand ?? 0);
    assert.equal(await StockBatch.countDocuments({ grnId: receiptId }), 0);
    assert.equal(await PaymentBill.countDocuments({ grnId: receiptId }), 0);
  });
  it('posts inventory and finance exactly once for concurrent approvals', async () => {
    const before = await StockLedger.findOne({ siteId: site._id, materialId: line.materialId }).lean();
    const responses = await Promise.all([1, 2].map(() => request(app).post(`/api/goods-receipts/${receiptId}/approve`)
      .set('Authorization', `Bearer ${coordinatorToken}`).send({})));
    assert.equal(responses.filter((r) => r.status === 200).length, 1);
    assert.ok(responses.some((r) => [400, 409].includes(r.status)));
    const after = await StockLedger.findOne({ siteId: site._id, materialId: line.materialId }).lean();
    assert.equal((after?.quantityOnHand ?? 0) - (before?.quantityOnHand ?? 0), 1);
    assert.equal(await StockBatch.countDocuments({ grnId: receiptId }), 1);
    assert.equal(await PaymentBill.countDocuments({ grnId: receiptId }), 1);
  });
});
