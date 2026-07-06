const { UserRole } = require('@afios/shared');
const { PaymentBill, TallySyncRecord } = require('../models');
const { seesAllProjects } = require('../middleware/projectScope');
const { userCanAccessProject } = require('../utils/serialize');

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

function buildFinanceScopeFilter(user) {
  if (seesAllProjects(user.role) || user.role === UserRole.EXECUTIVE) {
    return {};
  }
  if (user.role === UserRole.PROJECT_MANAGER) {
    const ids = user.assignedProjectIds || [];
    if (!ids.length) return { projectId: { $in: [] } };
    return { projectId: { $in: ids } };
  }
  if (user.role === UserRole.STORE_INCHARGE) {
    const ids = user.assignedProjectIds || [];
    if (!ids.length) return { projectId: { $in: [] } };
    return { projectId: { $in: ids } };
  }
  return { projectId: { $in: [] } };
}

function assertCanAccessBill(user, bill) {
  const projectId = bill.projectId?._id || bill.projectId;
  if (!projectId) return;
  if (!userCanAccessProject(user, projectId)) {
    const err = new Error('Forbidden — bill out of project scope');
    err.statusCode = 403;
    throw err;
  }
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

function summarizePayments(bills) {
  const rows = bills.map((b) => (typeof b.toObject === 'function' ? b.toObject() : b));
  const totalInvoiced = rows.reduce((s, b) => s + (Number(b.invoiceValue) || 0), 0);
  const totalPaid = rows.reduce((s, b) => s + (Number(b.paidAmount) || 0), 0);
  const totalOutstanding = rows.reduce((s, b) => s + (Number(b.outstandingAmount) || 0), 0);
  let paymentStatus = 'PENDING';
  if (totalOutstanding <= 0 && totalPaid > 0) paymentStatus = 'PAID';
  else if (totalPaid > 0 && totalOutstanding > 0) paymentStatus = 'PARTIAL';
  else if (rows.some((b) => b.paymentStatus === 'OVERDUE')) paymentStatus = 'OVERDUE';
  return { totalInvoiced, totalPaid, totalOutstanding, paymentStatus };
}

async function applyPaymentToBill(bill, payload = {}) {
  const invoiceValue = Number(bill.invoiceValue) || 0;
  let nextPaid = Number(bill.paidAmount) || 0;

  if (payload.paymentAmount != null) {
    const installment = Number(payload.paymentAmount);
    if (!Number.isFinite(installment) || installment <= 0) {
      const err = new Error('Payment amount must be greater than zero');
      err.statusCode = 400;
      throw err;
    }
    nextPaid += installment;
  } else if (payload.paidAmount != null) {
    nextPaid = Number(payload.paidAmount);
  }

  if (nextPaid > invoiceValue + 0.01) {
    const err = new Error('Payment exceeds outstanding invoice value');
    err.statusCode = 400;
    throw err;
  }

  bill.paidAmount = Math.round(nextPaid * 100) / 100;
  bill.outstandingAmount = Math.max(0, Math.round((invoiceValue - bill.paidAmount) * 100) / 100);

  if (bill.paidAmount >= invoiceValue) {
    bill.paidDate = payload.paidDate ? new Date(payload.paidDate) : new Date();
    bill.invoiceStatus = 'PAID';
  } else if (bill.paidAmount > 0) {
    bill.invoiceStatus = 'VERIFIED';
    bill.paidDate = payload.paidDate ? new Date(payload.paidDate) : bill.paidDate || null;
  }

  if (payload.paymentRemark != null) bill.paymentRemark = payload.paymentRemark;
  if (payload.tallySyncStatus) bill.tallySyncStatus = payload.tallySyncStatus;
  if (payload.tallyVoucherId != null) bill.tallyVoucherId = payload.tallyVoucherId;
  if (payload.invoiceStatus && bill.paidAmount >= invoiceValue) {
    bill.invoiceStatus = payload.invoiceStatus;
  }

  bill.paymentStatus = computePaymentStatus(bill);
  return bill;
}

async function createBillFromGrn(grn, po, vendor, projectId, actorUserId) {
  const existing = await PaymentBill.findOne({ grnId: grn._id });
  if (existing) return existing;

  const invoiceValue = Number(grn.invoiceValue) || Number(po?.amount) || 0;
  const billNumber = `BILL/${po?._id || po?.id}/${grn.grnNumber}`;
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

async function listPaymentBills(user, filter = {}) {
  const scope = buildFinanceScopeFilter(user);
  return PaymentBill.find({ ...scope, ...filter })
    .sort({ createdAt: -1 })
    .populate('vendorId', 'name code')
    .populate('projectId', 'code name');
}

async function getFinanceSummary(user) {
  const scope = buildFinanceScopeFilter(user);
  const bills = await PaymentBill.find(scope).lean();
  const pending = bills.filter((b) => b.paymentStatus === 'PENDING').length;
  const partial = bills.filter((b) => b.paymentStatus === 'PARTIAL').length;
  const overdue = bills.filter((b) => b.paymentStatus === 'OVERDUE').length;
  const paid = bills.filter((b) => b.paymentStatus === 'PAID').length;
  const outstandingTotal = bills.reduce((s, b) => s + (Number(b.outstandingAmount) || 0), 0);
  const paidTotal = bills.reduce((s, b) => s + (Number(b.paidAmount) || 0), 0);
  const tallyPending = bills.filter((b) => b.tallySyncStatus === 'PENDING').length;
  const tallySynced = bills.filter((b) => b.tallySyncStatus === 'SYNCED').length;
  return {
    pending,
    partial,
    overdue,
    paid,
    outstandingTotal,
    paidTotal,
    tallyPending,
    tallySynced,
    total: bills.length,
  };
}

async function listBillsForPo(poId) {
  return PaymentBill.find({ purchaseOrderId: poId }).sort({ createdAt: 1 }).lean();
}

async function getMonthlyTransactionReport(user, year, month) {
  const { getMonthlyMiscTotals } = require('./miscPurchaseService');
  const y = Number(year) || new Date().getFullYear();
  const m = Number(month) || new Date().getMonth() + 1;
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 1);

  const scope = buildFinanceScopeFilter(user);
  const bills = await PaymentBill.find({
    ...scope,
    createdAt: { $gte: start, $lt: end },
  })
    .populate('vendorId', 'name')
    .populate('projectId', 'code name')
    .lean();

  const miscByCategory = await getMonthlyMiscTotals(user, y, m);
  const billTotal = bills.reduce((s, b) => s + (Number(b.invoiceValue) || 0), 0);
  const miscTotal = miscByCategory.reduce((s, c) => s + c.totalAmount, 0);

  return {
    year: y,
    month: m,
    periodLabel: start.toLocaleString('en-IN', { month: 'long', year: 'numeric' }),
    summary: {
      miscPurchaseTotal: miscTotal,
      poBillTotal: billTotal,
      combinedTotal: miscTotal + billTotal,
      miscTransactionCount: miscByCategory.reduce((s, c) => s + c.count, 0),
      poBillCount: bills.length,
    },
    miscByCategory,
    poBills: bills.map((b) => ({
      id: b._id.toString(),
      billNumber: b.billNumber,
      vendorName: b.vendorId?.name || '',
      projectCode: b.projectId?.code || '',
      invoiceValue: b.invoiceValue,
      paymentStatus: b.paymentStatus,
      createdAt: b.createdAt?.toISOString?.() || null,
    })),
  };
}

module.exports = {
  computePaymentStatus,
  computeAgingDays,
  buildFinanceScopeFilter,
  assertCanAccessBill,
  serializePaymentBill,
  summarizePayments,
  applyPaymentToBill,
  createBillFromGrn,
  listPaymentBills,
  getFinanceSummary,
  listBillsForPo,
  getMonthlyTransactionReport,
};
