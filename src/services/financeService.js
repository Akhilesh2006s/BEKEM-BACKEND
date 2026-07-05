const { PaymentBill, TallySyncRecord } = require('../models');

function computePaymentStatus(bill) {
  const outstanding = Number(bill.outstandingAmount) || 0;
  const paid = Number(bill.paidAmount) || 0;
  if (outstanding <= 0 && paid > 0) return 'PAID';
  if (paid > 0 && outstanding > 0) return 'PARTIAL';
  if (bill.dueDate && new Date(bill.dueDate) < new Date() && outstanding > 0) return 'OVERDUE';
  return 'PENDING';
}

function computeAgingDays(bill) {
  const anchor = bill.billReceivedDate || bill.invoiceDate || bill.createdAt;
  if (!anchor) return 0;
  const ms = Date.now() - new Date(anchor).getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

function serializePaymentBill(bill) {
  return {
    id: bill._id.toString(),
    billNumber: bill.billNumber,
    purchaseOrderId: bill.purchaseOrderId?.toString?.() || bill.purchaseOrderId,
    grnId: bill.grnId?.toString?.() || bill.grnId,
    vendorId: bill.vendorId?._id?.toString() || bill.vendorId?.toString(),
    vendorName: bill.vendorId?.name || '',
    projectId: bill.projectId?._id?.toString() || bill.projectId?.toString(),
    projectCode: bill.projectId?.code || '',
    projectName: bill.projectId?.name || '',
    invoiceNumber: bill.invoiceNumber || '',
    invoiceDate: bill.invoiceDate?.toISOString?.() || null,
    invoiceValue: bill.invoiceValue,
    billReceivedDate: bill.billReceivedDate?.toISOString?.() || null,
    dueDate: bill.dueDate?.toISOString?.() || null,
    paidDate: bill.paidDate?.toISOString?.() || null,
    paidAmount: bill.paidAmount || 0,
    outstandingAmount: bill.outstandingAmount,
    paymentStatus: bill.paymentStatus,
    invoiceStatus: bill.invoiceStatus,
    tallySyncStatus: bill.tallySyncStatus,
    tallyVoucherId: bill.tallyVoucherId || '',
    paymentRemark: bill.paymentRemark || '',
    agingDays: computeAgingDays(bill),
    createdAt: bill.createdAt?.toISOString?.(),
    updatedAt: bill.updatedAt?.toISOString?.(),
  };
}

async function createBillFromGrn(grn, po, vendor, projectId, actorUserId) {
  const existing = await PaymentBill.findOne({ grnId: grn._id });
  if (existing) return existing;

  const invoiceValue = Number(grn.invoiceValue) || Number(po?.amount) || 0;
  const billNumber = `BILL/${grn.grnNumber}`;
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 30);

  const bill = await PaymentBill.create({
    billNumber,
    purchaseOrderId: po?._id,
    grnId: grn._id,
    vendorId: vendor?._id || po?.vendorId,
    projectId,
    invoiceNumber: grn.invoiceNo || '',
    invoiceDate: grn.invoiceDate || grn.receivedAt,
    invoiceValue,
    billReceivedDate: grn.receivedAt || new Date(),
    dueDate,
    outstandingAmount: invoiceValue,
    paymentStatus: 'PENDING',
    invoiceStatus: 'BILL_RECEIVED',
    tallySyncStatus: 'PENDING',
    processedByUserId: actorUserId,
  });

  await TallySyncRecord.create({
    grnId: grn._id,
    purchaseOrderId: po?._id,
    status: 'PENDING',
  });

  return bill;
}

async function listPaymentBills(filter = {}) {
  return PaymentBill.find(filter)
    .sort({ createdAt: -1 })
    .populate('vendorId', 'name code')
    .populate('projectId', 'code name');
}

async function getFinanceSummary() {
  const bills = await PaymentBill.find().lean();
  const pending = bills.filter((b) => b.paymentStatus === 'PENDING').length;
  const overdue = bills.filter((b) => b.paymentStatus === 'OVERDUE').length;
  const paid = bills.filter((b) => b.paymentStatus === 'PAID').length;
  const outstandingTotal = bills.reduce((s, b) => s + (Number(b.outstandingAmount) || 0), 0);
  const tallyPending = bills.filter((b) => b.tallySyncStatus === 'PENDING').length;
  const tallySynced = bills.filter((b) => b.tallySyncStatus === 'SYNCED').length;
  return { pending, overdue, paid, outstandingTotal, tallyPending, tallySynced, total: bills.length };
}

module.exports = {
  computePaymentStatus,
  computeAgingDays,
  serializePaymentBill,
  createBillFromGrn,
  listPaymentBills,
  getFinanceSummary,
};
