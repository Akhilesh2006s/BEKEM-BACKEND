const { UserRole } = require('@afios/shared');
const { MiscPurchase, PurchaseOrder } = require('../models');
const { loadOrgSettings } = require('./orgSettingsService');
const { userCanAccessProject } = require('../utils/serialize');
const statusHistoryService = require('./statusHistoryService');

let refCounter = 0;

async function nextReferenceNumber() {
  refCounter += 1;
  const year = new Date().getFullYear();
  const count = await MiscPurchase.countDocuments();
  return `MISC/${year}/${String(count + refCounter).padStart(4, '0')}`;
}

function findExpenseCategory(settings, key) {
  return (settings.expenseCategories || []).find((c) => c.key === key);
}

function resolveInitialStatus(amount, categoryKey, settings) {
  const cat = findExpenseCategory(settings, categoryKey);
  if (!cat) {
    const err = new Error('Unknown expense category');
    err.statusCode = 400;
    throw err;
  }
  if (amount <= cat.pmMaxInr) return 'PM_PENDING';
  if (amount <= cat.coordinatorMaxInr) return 'COORDINATOR_PENDING';
  return 'CHAIRMAN_PENDING';
}

function assertCanView(user, doc) {
  if (user.role === UserRole.EXECUTIVE || user.role === UserRole.COORDINATOR || user.role === UserRole.CHAIRMAN) {
    return;
  }
  if (!userCanAccessProject(user, doc.projectId)) {
    const err = new Error('Forbidden');
    err.statusCode = 403;
    throw err;
  }
}

function assertCanApprove(user, doc) {
  if (doc.status === 'PM_PENDING' && user.role !== UserRole.PROJECT_MANAGER) {
    const err = new Error('Only Project Manager may approve at this stage');
    err.statusCode = 403;
    throw err;
  }
  if (doc.status === 'COORDINATOR_PENDING' && user.role !== UserRole.COORDINATOR) {
    const err = new Error('Only Coordinator may approve at this stage');
    err.statusCode = 403;
    throw err;
  }
  if (doc.status === 'CHAIRMAN_PENDING' && user.role !== UserRole.CHAIRMAN) {
    const err = new Error('Only Chairman may approve at this stage');
    err.statusCode = 403;
    throw err;
  }
}

function serialize(doc) {
  const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    id: o._id.toString(),
    referenceNumber: o.referenceNumber,
    expenseCategoryKey: o.expenseCategoryKey,
    expenseCategoryLabel:
      o.expenseCategoryKey?.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || '',
    description: o.description,
    amount: o.amount,
    projectId: o.projectId?._id?.toString() || o.projectId?.toString(),
    projectCode: o.projectId?.code || '',
    projectName: o.projectId?.name || '',
    siteId: o.siteId?._id?.toString() || o.siteId?.toString() || null,
    siteName: o.siteId?.name || '',
    vendorName: o.vendorName || '',
    purchaseOrderId: o.purchaseOrderId?._id?.toString() || o.purchaseOrderId?.toString() || null,
    poNumber: o.purchaseOrderId?.poNumber || o.purchaseOrderId?.procurementRef || '',
    requiresPo: !!o.requiresPo,
    status: o.status,
    createdByUserId: o.createdByUserId?._id?.toString() || o.createdByUserId?.toString(),
    createdByName: o.createdByUserId?.name || '',
    approvedByUserId: o.approvedByUserId?._id?.toString() || o.approvedByUserId?.toString() || null,
    approvedByName: o.approvedByUserId?.name || '',
    approvedAt: o.approvedAt?.toISOString?.() || null,
    rejectionReason: o.rejectionReason || '',
    transactionDate: o.transactionDate?.toISOString?.() || null,
    note: o.note || '',
    createdAt: o.createdAt?.toISOString?.() || null,
    updatedAt: o.updatedAt?.toISOString?.() || null,
  };
}

function buildListFilter(user, { tab, expenseCategoryKey, projectId } = {}) {
  const filter = {};
  if (expenseCategoryKey) filter.expenseCategoryKey = expenseCategoryKey;
  if (projectId) filter.projectId = projectId;

  if (user.role === UserRole.PROJECT_MANAGER) {
    filter.projectId = { $in: user.assignedProjectIds || [] };
    if (tab === 'pending') filter.status = 'PM_PENDING';
    else if (tab === 'approved') filter.status = 'APPROVED';
    else if (tab === 'completed') filter.status = { $in: ['APPROVED', 'REJECTED'] };
  } else if (user.role === UserRole.COORDINATOR) {
    if (tab === 'pending') filter.status = 'COORDINATOR_PENDING';
    else if (tab === 'approved') filter.status = 'APPROVED';
    else if (tab === 'completed') filter.status = { $in: ['APPROVED', 'REJECTED'] };
  } else if (user.role === UserRole.CHAIRMAN) {
    if (tab === 'pending') filter.status = 'CHAIRMAN_PENDING';
    else if (tab === 'approved') filter.status = 'APPROVED';
    else if (tab === 'completed') filter.status = { $in: ['APPROVED', 'REJECTED'] };
  } else if (user.role === UserRole.EXECUTIVE) {
    if (tab === 'pending') {
      filter.status = { $in: ['PM_PENDING', 'COORDINATOR_PENDING', 'CHAIRMAN_PENDING'] };
    } else if (tab === 'approved') filter.status = 'APPROVED';
    else if (tab === 'completed') filter.status = { $in: ['APPROVED', 'REJECTED'] };
  } else {
    filter.createdByUserId = user._id;
    if (tab === 'pending') {
      filter.status = { $in: ['DRAFT', 'PM_PENDING', 'COORDINATOR_PENDING', 'CHAIRMAN_PENDING'] };
    } else if (tab === 'approved') filter.status = 'APPROVED';
    else if (tab === 'completed') filter.status = { $in: ['APPROVED', 'REJECTED'] };
  }

  return filter;
}

async function listMiscPurchases(user, query = {}) {
  const filter = buildListFilter(user, query);
  const rows = await MiscPurchase.find(filter)
    .sort({ transactionDate: -1, createdAt: -1 })
    .populate([
      { path: 'projectId', select: 'code name' },
      { path: 'siteId', select: 'name' },
      { path: 'createdByUserId', select: 'name' },
      { path: 'approvedByUserId', select: 'name' },
      { path: 'purchaseOrderId', select: 'poNumber procurementRef' },
    ]);
  return rows.map(serialize);
}

async function createMiscPurchase(user, payload) {
  const settings = await loadOrgSettings();
  const cat = findExpenseCategory(settings, payload.expenseCategoryKey);
  if (!cat) {
    const err = new Error('Unknown expense category');
    err.statusCode = 400;
    throw err;
  }
  if (cat.requiresPo && !payload.purchaseOrderId) {
    const err = new Error('This category requires a linked purchase order');
    err.statusCode = 400;
    throw err;
  }
  if (payload.purchaseOrderId) {
    const po = await PurchaseOrder.findById(payload.purchaseOrderId);
    if (!po) {
      const err = new Error('Purchase order not found');
      err.statusCode = 404;
      throw err;
    }
  }

  const status = resolveInitialStatus(Number(payload.amount), payload.expenseCategoryKey, settings);
  const doc = await MiscPurchase.create({
    referenceNumber: await nextReferenceNumber(),
    expenseCategoryKey: payload.expenseCategoryKey,
    description: payload.description,
    amount: Number(payload.amount),
    projectId: payload.projectId,
    siteId: payload.siteId || null,
    vendorName: payload.vendorName || '',
    purchaseOrderId: payload.purchaseOrderId || null,
    requiresPo: !!cat.requiresPo,
    status,
    createdByUserId: user._id,
    transactionDate: payload.transactionDate ? new Date(payload.transactionDate) : new Date(),
    note: payload.note || '',
  });

  await statusHistoryService.record(
    'MiscPurchase',
    doc._id,
    null,
    status,
    user._id,
    `Misc purchase submitted — ${cat.label}`
  );

  return serialize(
    await MiscPurchase.findById(doc._id).populate([
      { path: 'projectId', select: 'code name' },
      { path: 'siteId', select: 'name' },
      { path: 'createdByUserId', select: 'name' },
      { path: 'purchaseOrderId', select: 'poNumber procurementRef' },
    ])
  );
}

async function approveMiscPurchase(user, id, note = '') {
  const doc = await MiscPurchase.findById(id);
  if (!doc) {
    const err = new Error('Not found');
    err.statusCode = 404;
    throw err;
  }
  assertCanView(user, doc);
  assertCanApprove(user, doc);

  const fromStatus = doc.status;
  const settings = await loadOrgSettings();
  const cat = findExpenseCategory(settings, doc.expenseCategoryKey);

  if (doc.status === 'PM_PENDING') {
    doc.status = 'APPROVED';
  } else if (doc.status === 'COORDINATOR_PENDING') {
    doc.status = doc.amount > (cat?.coordinatorMaxInr || 0) ? 'CHAIRMAN_PENDING' : 'APPROVED';
  } else if (doc.status === 'CHAIRMAN_PENDING') {
    doc.status = 'APPROVED';
  }

  if (doc.status === 'APPROVED') {
    doc.approvedByUserId = user._id;
    doc.approvedAt = new Date();
  }

  await doc.save();
  await statusHistoryService.record(
    'MiscPurchase',
    doc._id,
    fromStatus,
    doc.status,
    user._id,
    note || 'Approved'
  );

  return serialize(
    await MiscPurchase.findById(doc._id).populate([
      { path: 'projectId', select: 'code name' },
      { path: 'siteId', select: 'name' },
      { path: 'createdByUserId', select: 'name' },
      { path: 'approvedByUserId', select: 'name' },
      { path: 'purchaseOrderId', select: 'poNumber procurementRef' },
    ])
  );
}

async function rejectMiscPurchase(user, id, reason = '') {
  const doc = await MiscPurchase.findById(id);
  if (!doc) {
    const err = new Error('Not found');
    err.statusCode = 404;
    throw err;
  }
  assertCanView(user, doc);
  assertCanApprove(user, doc);

  const fromStatus = doc.status;
  doc.status = 'REJECTED';
  doc.rejectionReason = reason;
  await doc.save();

  await statusHistoryService.record(
    'MiscPurchase',
    doc._id,
    fromStatus,
    'REJECTED',
    user._id,
    reason || 'Rejected'
  );

  return serialize(
    await MiscPurchase.findById(doc._id).populate([
      { path: 'projectId', select: 'code name' },
      { path: 'siteId', select: 'name' },
      { path: 'createdByUserId', select: 'name' },
    ])
  );
}

async function getMonthlyMiscTotals(user, year, month) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  const filter = {
    status: 'APPROVED',
    transactionDate: { $gte: start, $lt: end },
  };

  if (user.role === UserRole.PROJECT_MANAGER) {
    filter.projectId = { $in: user.assignedProjectIds || [] };
  }

  const rows = await MiscPurchase.find(filter).lean();
  const byCategory = {};
  for (const row of rows) {
    const key = row.expenseCategoryKey;
    if (!byCategory[key]) {
      byCategory[key] = { categoryKey: key, count: 0, totalAmount: 0, items: [] };
    }
    byCategory[key].count += 1;
    byCategory[key].totalAmount += Number(row.amount) || 0;
    byCategory[key].items.push({
      referenceNumber: row.referenceNumber,
      description: row.description,
      amount: row.amount,
      transactionDate: row.transactionDate?.toISOString?.() || null,
    });
  }
  return Object.values(byCategory);
}

module.exports = {
  listMiscPurchases,
  createMiscPurchase,
  approveMiscPurchase,
  rejectMiscPurchase,
  getMonthlyMiscTotals,
  serialize,
  buildListFilter,
};
