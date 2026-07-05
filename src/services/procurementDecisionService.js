const { UserRole } = require('@afios/shared');
const { computeRequiredQty } = require('@afios/shared');
const {
  MaterialRequest,
  StockLedger,
  Site,
  Project,
  User,
  BranchTransfer,
} = require('../models');
const { getIndentLineItems } = require('./materialRequestHelpers');
const { createPurchaseRequestForIndent } = require('./purchaseRequestService');
const { generateTransferNumber } = require('./documentNumberService');
const statusHistoryService = require('./statusHistoryService');
const notificationService = require('./notificationService');

const EXECUTIVE_QUEUE_STATUSES = ['PENDING_EXECUTIVE_DECISION', 'PENDING_HO'];
const COORDINATOR_QUEUE_STATUSES = [
  'EXECUTIVE_DECISION_PO',
  'EXECUTIVE_DECISION_BRANCH_TRANSFER',
];

function executiveDecisionStatus(method) {
  return method === 'BRANCH_TRANSFER'
    ? 'EXECUTIVE_DECISION_BRANCH_TRANSFER'
    : 'EXECUTIVE_DECISION_PO';
}

async function getEnterpriseStockByMaterial(materialIds) {
  if (!materialIds.length) return new Map();

  const ledgers = await StockLedger.find({ materialId: { $in: materialIds } })
    .populate('materialId', 'name code unit')
    .populate({ path: 'siteId', populate: { path: 'projectId', select: 'code name' } })
    .lean();

  const byMaterial = new Map();
  for (const ledger of ledgers) {
    const mid = ledger.materialId?._id?.toString() || ledger.materialId?.toString();
    if (!mid) continue;
    const project = ledger.siteId?.projectId;
    const projectId = project?._id?.toString() || project?.toString();
    if (!projectId) continue;

    const availableQty = Math.max(
      0,
      (ledger.quantityOnHand || 0) - (ledger.quantityReserved || 0)
    );
    if (!byMaterial.has(mid)) byMaterial.set(mid, []);
    byMaterial.get(mid).push({
      projectId,
      projectCode: project?.code || '',
      projectName: project?.name || '',
      siteName: ledger.siteId?.name || '',
      availableQty,
    });
  }

  for (const rows of byMaterial.values()) {
    rows.sort((a, b) => b.availableQty - a.availableQty);
  }

  return byMaterial;
}

async function loadDecisionIndent(id) {
  return MaterialRequest.findById(id)
    .populate('projectId')
    .populate('siteId')
    .populate('requestedByUserId', 'name')
    .populate('items.materialId')
    .populate('materialId')
    .populate('executiveDecidedByUserId', 'name')
    .populate('coordinatorProcurementDecidedByUserId', 'name');
}

async function buildProcurementDecisionDto(mr) {
  const { enrichIndentWithStock } = require('./indentStockService');
  const stockContext = await enrichIndentWithStock(mr);
  const lineItems = getIndentLineItems(mr);
  const materialIds = lineItems.map((item) =>
    (item.materialId?._id || item.materialId).toString()
  );
  const enterpriseByMaterial = await getEnterpriseStockByMaterial(materialIds);

  const items = lineItems.map((item) => {
    const itemId = item._id.toString();
    const mid = (item.materialId?._id || item.materialId).toString();
    const stock = stockContext.stockByLine.find((s) => s.itemId === itemId) || {};
    const mat = item.materialId;
    return {
      id: itemId,
      materialId: mid,
      materialName: mat?.name || 'Material',
      unit: item.unit || mat?.unit || '',
      requestedQty: stock.requestedQty ?? item.quantityRequested,
      availableQty: stock.availableQty ?? 0,
      requiredQty: computeRequiredQty(
        stock.requestedQty ?? item.quantityRequested,
        stock.availableQty ?? 0
      ),
      enterpriseStock: enterpriseByMaterial.get(mid) || [],
    };
  });

  const lastForward = mr.pmForwardRemark || '';

  return {
    id: mr._id.toString(),
    indentNumber: mr.indentNumber,
    indentDate: mr.createdAt?.toISOString?.() || null,
    status: mr.status,
    projectId: mr.projectId?._id?.toString() || mr.projectId?.toString(),
    projectCode: mr.projectId?.code,
    projectName: mr.projectId?.name,
    requestedBy: mr.requestedByUserId?.name,
    pmRemarks: mr.pmForwardRemark || lastForward || '',
    estimatedValue: mr.estimatedValue || 0,
    items,
    executiveProcurementMethod: mr.executiveProcurementMethod || null,
    executiveDecisionRemark: mr.executiveDecisionRemark || '',
    executiveDecidedBy: mr.executiveDecidedByUserId?.name || null,
    executiveDecidedAt: mr.executiveDecidedAt?.toISOString?.() || null,
    coordinatorProcurementMethod: mr.coordinatorProcurementMethod || null,
    coordinatorProcurementRemark: mr.coordinatorProcurementRemark || '',
    canExecutiveDecide: EXECUTIVE_QUEUE_STATUSES.includes(mr.status),
    canCoordinatorReview: COORDINATOR_QUEUE_STATUSES.includes(mr.status),
  };
}

async function listProcurementDecisions(user) {
  let filter = {};
  if (user.role === UserRole.EXECUTIVE) {
    filter.status = { $in: EXECUTIVE_QUEUE_STATUSES };
  } else if (user.role === UserRole.COORDINATOR) {
    filter.status = { $in: COORDINATOR_QUEUE_STATUSES };
  } else if (user.role === UserRole.CHAIRMAN) {
    filter.status = {
      $in: [...EXECUTIVE_QUEUE_STATUSES, ...COORDINATOR_QUEUE_STATUSES, 'PURCHASE_REQUESTED'],
    };
  } else {
    return [];
  }

  const rows = await MaterialRequest.find(filter)
    .sort({ updatedAt: -1 })
    .populate('projectId', 'code name')
    .limit(100);

  return rows.map((mr) => ({
    id: mr._id.toString(),
    indentNumber: mr.indentNumber,
    indentDate: mr.createdAt?.toISOString?.() || null,
    status: mr.status,
    projectCode: mr.projectId?.code,
    projectName: mr.projectId?.name,
    estimatedValue: mr.estimatedValue || 0,
    executiveProcurementMethod: mr.executiveProcurementMethod || null,
  }));
}

async function queueForExecutiveDecision(mr, actorUserId, remark, historyNote) {
  const fromStatus = mr.status;
  mr.status = 'PENDING_EXECUTIVE_DECISION';
  mr.pendingWithRole = 'EXECUTIVE';
  mr.pmForwardRemark = remark;
  mr.escalatedToHo = true;
  mr.escalatedAt = mr.escalatedAt || new Date();
  await mr.save();

  await statusHistoryService.record(
    'MaterialRequest',
    mr._id,
    fromStatus,
    'PENDING_EXECUTIVE_DECISION',
    actorUserId,
    historyNote || remark
  );

  const executives = await User.find({ role: UserRole.EXECUTIVE });
  await notificationService.notifyUsers(
    executives.map((u) => u._id),
    {
      title: 'New Procurement Decision Pending',
      body: `${mr.indentNumber} — select purchase order or branch transfer.`,
      relatedEntityType: 'ProcurementDecision',
      relatedEntityId: mr._id,
    }
  );
}

async function executiveDecide(mr, user, { method, remark }) {
  if (!EXECUTIVE_QUEUE_STATUSES.includes(mr.status)) {
    const err = new Error('Indent is not awaiting executive procurement decision');
    err.statusCode = 400;
    throw err;
  }
  if (!['PURCHASE_ORDER', 'BRANCH_TRANSFER'].includes(method)) {
    const err = new Error('Invalid procurement method');
    err.statusCode = 400;
    throw err;
  }

  const fromStatus = mr.status;
  const toStatus = executiveDecisionStatus(method);
  mr.status = toStatus;
  mr.pendingWithRole = 'COORDINATOR';
  mr.executiveProcurementMethod = method;
  mr.executiveDecisionRemark = remark;
  mr.executiveDecidedByUserId = user._id;
  mr.executiveDecidedAt = new Date();
  await mr.save();

  const label =
    method === 'BRANCH_TRANSFER'
      ? 'Executive selected Branch Transfer'
      : 'Executive selected Purchase Order';

  await statusHistoryService.record('MaterialRequest', mr._id, fromStatus, toStatus, user._id, `${label}: ${remark}`);

  const coordinators = await User.find({ role: UserRole.COORDINATOR });
  await notificationService.notifyUsers(
    coordinators.map((u) => u._id),
    {
      title: 'Procurement Decision Waiting for Approval',
      body: `${mr.indentNumber} — executive recommended ${method === 'BRANCH_TRANSFER' ? 'branch transfer' : 'purchase order'}.`,
      relatedEntityType: 'ProcurementDecision',
      relatedEntityId: mr._id,
    }
  );

  return buildProcurementDecisionDto(mr);
}

async function coordinatorReview(mr, user, { action, method, remark, fromProjectId }) {
  if (!COORDINATOR_QUEUE_STATUSES.includes(mr.status)) {
    const err = new Error('Indent is not awaiting coordinator procurement review');
    err.statusCode = 400;
    throw err;
  }

  if (action === 'reject') {
    const fromStatus = mr.status;
    mr.status = 'REJECTED';
    mr.pendingWithRole = null;
    mr.coordinatorProcurementRemark = remark;
    mr.coordinatorProcurementDecidedByUserId = user._id;
    mr.coordinatorProcurementDecidedAt = new Date();
    await mr.save();

    await statusHistoryService.record(
      'MaterialRequest',
      mr._id,
      fromStatus,
      'REJECTED',
      user._id,
      `Coordinator rejected procurement decision: ${remark}`
    );

    await notificationService.notifyUser(mr.requestedByUserId, {
      title: 'Indent rejected',
      body: `${mr.indentNumber} was rejected at Head Office.`,
      relatedEntityType: 'MaterialRequest',
      relatedEntityId: mr._id,
    });

    return buildProcurementDecisionDto(mr);
  }

  const finalMethod =
    method || mr.executiveProcurementMethod || (mr.status === 'EXECUTIVE_DECISION_BRANCH_TRANSFER' ? 'BRANCH_TRANSFER' : 'PURCHASE_ORDER');

  if (!['PURCHASE_ORDER', 'BRANCH_TRANSFER'].includes(finalMethod)) {
    const err = new Error('Procurement method is required');
    err.statusCode = 400;
    throw err;
  }

  const fromStatus = mr.status;
  mr.coordinatorProcurementMethod = finalMethod;
  mr.coordinatorProcurementRemark = remark;
  mr.coordinatorProcurementDecidedByUserId = user._id;
  mr.coordinatorProcurementDecidedAt = new Date();

  const executiveMethod = mr.executiveProcurementMethod;
  const modified =
    executiveMethod && executiveMethod !== finalMethod
      ? `Coordinator modified executive recommendation (${executiveMethod} → ${finalMethod})`
      : 'Coordinator approved executive recommendation';

  if (finalMethod === 'PURCHASE_ORDER') {
    await mr.save();
    const populated = await MaterialRequest.findById(mr._id)
      .populate('projectId')
      .populate('items.materialId');
    await createPurchaseRequestForIndent(
      populated,
      user._id,
      undefined,
      `${modified}: ${remark}`
    );
    await statusHistoryService.record(
      'MaterialRequest',
      mr._id,
      fromStatus,
      'PURCHASE_REQUESTED',
      user._id,
      `${modified}: ${remark}`
    );
  } else {
    if (!fromProjectId) {
      const err = new Error('Source project is required for branch transfer');
      err.statusCode = 400;
      throw err;
    }

    const destProjectId = (mr.projectId?._id || mr.projectId).toString();
    if (fromProjectId === destProjectId) {
      const err = new Error('Source and destination projects must differ');
      err.statusCode = 400;
      throw err;
    }

    const lineItems = getIndentLineItems(mr);
    const items = lineItems.map((item) => ({
      materialId: item.materialId?._id || item.materialId,
      quantity: item.quantityRequested,
    }));

    const transferNumber = await generateTransferNumber();
    const transfer = await BranchTransfer.create({
      transferNumber,
      fromProjectId,
      toProjectId: destProjectId,
      items,
      note: remark,
      materialRequestId: mr._id,
      requestedByUserId: user._id,
      status: 'REQUESTED',
    });

    mr.status = 'BRANCH_TRANSFER_REQUESTED';
    mr.pendingWithRole = 'COORDINATOR';
    await mr.save();

    await statusHistoryService.record(
      'MaterialRequest',
      mr._id,
      fromStatus,
      'BRANCH_TRANSFER_REQUESTED',
      user._id,
      `${modified}: ${remark}`
    );
    await statusHistoryService.record(
      'BranchTransfer',
      transfer._id,
      null,
      'REQUESTED',
      user._id,
      `Created from procurement decision ${transferNumber}`
    );
  }

  return buildProcurementDecisionDto(await loadDecisionIndent(mr._id));
}

async function countPendingProcurementDecisions() {
  const rows = await MaterialRequest.find({ status: { $in: EXECUTIVE_QUEUE_STATUSES } })
    .populate('items.materialId')
    .populate('materialId');

  let poPending = 0;
  let btPending = 0;

  const { enrichIndentWithStock } = require('./indentStockService');

  for (const mr of rows) {
    const stockContext = await enrichIndentWithStock(mr);
    const lineItems = getIndentLineItems(mr);
    const materialIds = lineItems.map((item) =>
      (item.materialId?._id || item.materialId).toString()
    );
    const enterpriseByMaterial = await getEnterpriseStockByMaterial(materialIds);
    const destProjectId = (mr.projectId?._id || mr.projectId).toString();

    let hasSurplusElsewhere = false;
    for (const item of lineItems) {
      const itemId = item._id.toString();
      const mid = (item.materialId?._id || item.materialId).toString();
      const stock = stockContext.stockByLine.find((s) => s.itemId === itemId) || {};
      const required = computeRequiredQty(
        stock.requestedQty ?? item.quantityRequested,
        stock.availableQty ?? 0
      );
      if (required <= 0) continue;
      const enterpriseRows = enterpriseByMaterial.get(mid) || [];
      if (
        enterpriseRows.some(
          (r) => r.projectId !== destProjectId && r.availableQty >= required
        )
      ) {
        hasSurplusElsewhere = true;
        break;
      }
    }

    if (hasSurplusElsewhere) btPending += 1;
    else poPending += 1;
  }

  return { total: rows.length, poPending, btPending };
}

module.exports = {
  EXECUTIVE_QUEUE_STATUSES,
  COORDINATOR_QUEUE_STATUSES,
  listProcurementDecisions,
  buildProcurementDecisionDto,
  loadDecisionIndent,
  queueForExecutiveDecision,
  executiveDecide,
  coordinatorReview,
  countPendingProcurementDecisions,
};
