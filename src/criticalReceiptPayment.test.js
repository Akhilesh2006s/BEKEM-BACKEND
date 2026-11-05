const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestDb, teardownTestDb, loginAs, getApp } = require('./test/helpers');
const { Project, Vendor, Material, PurchaseRequest, PurchaseOrder, PaymentBill, GoodsReceiptNote } = require('./models');

test('duplicate PO lines cannot bypass the excess receipt hold', async () => {
  await setupTestDb();
  try {
    const app = getApp(), token = await loginAs('storeincharge@bekem.com');
    const project = await Project.findOne(), vendor = await Vendor.findOne(), material = await Material.findOne();
    const pr = await PurchaseRequest.findOne({ projectId: project._id });
    const po = await PurchaseOrder.create({ draftRef: 'CRITICAL-RECEIPT-TEST', purchaseRequestId: pr._id, vendorId: vendor._id, amount: 10000, paymentTerms: 'Net 30', status: 'APPROVED', lineItems: [{ materialId: material._id, description: 'Synthetic', quantity: 100, rate: 100, amount: 10000 }] });
    const line = { materialId: String(material._id), lineIndex: 0, quantityOrdered: 100, quantityReceived: 60, invoiceUnitPrice: 100 };
    const body = { purchaseOrderId: String(po._id), invoiceNo: 'CRITICAL-RECEIPT-TEST', invoiceDate: new Date().toISOString(), challanNo: 'TEST', receiveType: 'PARTIAL', attachments: [{ name: 'invoice.pdf', category: 'INVOICE' }, { name: 'challan.pdf', category: 'CHALLAN' }], items: [line, line] };
    const send = payload => request(app).post('/api/goods-receipts').set('Authorization', `Bearer ${token}`).send(payload);
    const duplicate = await send(body);
    assert.equal(duplicate.status, 400);
    assert.equal(await GoodsReceiptNote.countDocuments({ purchaseOrderId: po._id }), 0);
    const over = await send({ ...body, invoiceNo: 'CRITICAL-OVER-CONTROL', items: [{ ...line, quantityReceived: 120 }] });
    assert.equal(over.status, 201);
    assert.equal(over.body.data.requiresChairmanApproval, true);
    assert.ok(over.body.data.holdReasons.includes('QTY'));
  } finally { await teardownTestDb(); }
});

test('concurrent installments both persist and cannot overpay', async () => {
  await setupTestDb();
  try {
    const app = getApp(), token = await loginAs('coordinator@bekem.com'), project = await Project.findOne();
    const bill = await PaymentBill.create({ billNumber: 'CRITICAL-PAYMENT-TEST', projectId: project._id, invoiceValue: 100, outstandingAmount: 100 });
    const send = amount => request(app).patch(`/api/finance/bills/${bill._id}/payment`).set('Authorization', `Bearer ${token}`).send({ paymentAmount: amount });
    const results = await Promise.all([send(30), send(40)]);
    assert.deepEqual(results.map(r => r.status), [200, 200]);
    let saved = await PaymentBill.findById(bill._id).lean();
    assert.equal(saved.paidAmount, 70); assert.equal(saved.outstandingAmount, 30);
    const extra = await Promise.all([send(20), send(20)]);
    assert.deepEqual(extra.map(r => r.status).sort(), [200, 400]);
    saved = await PaymentBill.findById(bill._id).lean();
    assert.equal(saved.paidAmount, 90); assert.equal(saved.outstandingAmount, 10);
    const legacy = await PaymentBill.create({ billNumber: 'CRITICAL-PAYMENT-LEGACY', projectId: project._id, invoiceValue: 100, outstandingAmount: 100 });
    await PaymentBill.collection.updateOne({ _id: legacy._id }, { $unset: { __v: '' } });
    const legacySend = amount => request(app).patch(`/api/finance/bills/${legacy._id}/payment`).set('Authorization', `Bearer ${token}`).send({ paymentAmount: amount });
    const legacyResults = await Promise.all([legacySend(30), legacySend(40)]);
    assert.deepEqual(legacyResults.map(r => r.status), [200, 200]);
    const legacySaved = await PaymentBill.findById(legacy._id).lean();
    assert.equal(legacySaved.paidAmount, 70); assert.equal(legacySaved.outstandingAmount, 30);
  } finally { await teardownTestDb(); }
});
