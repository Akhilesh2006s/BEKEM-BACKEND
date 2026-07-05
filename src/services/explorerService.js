const { UserRole } = require('@afios/shared');
const {
  Project,
  Site,
  User,
  MaterialRequest,
  PurchaseRequest,
  PurchaseOrder,
  BranchTransfer,
} = require('../models');
const { seesAllProjects } = require('../middleware/projectScope');

const PENDING_PO_STATUSES = [
  'DRAFT',
  'PM_PENDING',
  'COORDINATOR_PENDING',
  'CHAIRMAN_PENDING',
  'PENDING_REVIEW',
  'PENDING_APPROVAL',
  'COORDINATOR_VERIFIED',
];

const PENDING_BT_STATUSES = [
  'REQUESTED',
  'PM_APPROVED',
  'COORDINATOR_DECIDED',
  'PENDING_DESTINATION_PM',
  'PENDING_SOURCE_FINAL',
  'APPROVED',
  'DISPATCHED',
];

const OPEN_MR_STATUSES = [
  'PENDING_STORE',
  'FORWARDED_TO_PM',
  'PM_APPROVED',
  'PURCHASE_REQUESTED',
  'PO_CREATED',
  'PARTIALLY_ALLOCATED',
];

function buildExplorerProjectQuery(user) {
  if (seesAllProjects(user.role)) {
    return { status: 'ACTIVE' };
  }

  const assignedIds = user.assignedProjectIds || [];
  if (!assignedIds.length) {
    return { _id: { $in: [] } };
  }

  if (
    user.role === UserRole.PROJECT_MANAGER ||
    user.role === UserRole.STORE_INCHARGE ||
    user.role === UserRole.SITE_INCHARGE
  ) {
    return { _id: { $in: assignedIds }, status: 'ACTIVE' };
  }

  return { _id: { $in: [] } };
}

function mapCounts(aggregateRows) {
  const out = {};
  for (const row of aggregateRows) {
    if (row._id) out[row._id.toString()] = row.count;
  }
  return out;
}

async function countMaterialRequestsByProject(projectIds) {
  if (!projectIds.length) return {};
  const rows = await MaterialRequest.aggregate([
    { $match: { projectId: { $in: projectIds }, status: { $in: OPEN_MR_STATUSES } } },
    { $group: { _id: '$projectId', count: { $sum: 1 } } },
  ]);
  return mapCounts(rows);
}

async function countPurchaseRequestsByProject(projectIds) {
  if (!projectIds.length) return {};
  const rows = await PurchaseRequest.aggregate([
    { $match: { projectId: { $in: projectIds }, status: 'OPEN' } },
    { $group: { _id: '$projectId', count: { $sum: 1 } } },
  ]);
  return mapCounts(rows);
}

async function countPurchaseOrdersByProject(projectIds) {
  if (!projectIds.length) return {};
  const rows = await PurchaseOrder.aggregate([
    {
      $lookup: {
        from: 'purchaserequests',
        localField: 'purchaseRequestId',
        foreignField: '_id',
        as: 'pr',
      },
    },
    { $unwind: '$pr' },
    {
      $match: {
        'pr.projectId': { $in: projectIds },
        status: { $in: PENDING_PO_STATUSES },
      },
    },
    { $group: { _id: '$pr.projectId', count: { $sum: 1 } } },
  ]);
  return mapCounts(rows);
}

async function countPendingGrnsByProject(projectIds) {
  if (!projectIds.length) return {};
  const rows = await PurchaseOrder.aggregate([
    {
      $lookup: {
        from: 'purchaserequests',
        localField: 'purchaseRequestId',
        foreignField: '_id',
        as: 'pr',
      },
    },
    { $unwind: '$pr' },
    {
      $match: {
        'pr.projectId': { $in: projectIds },
        status: 'APPROVED',
        fulfillmentStatus: { $ne: 'closed_complete' },
      },
    },
    { $group: { _id: '$pr.projectId', count: { $sum: 1 } } },
  ]);
  return mapCounts(rows);
}

async function countBranchTransfersByProject(projectIds) {
  if (!projectIds.length) return {};
  const rows = await BranchTransfer.aggregate([
    {
      $match: {
        status: { $in: PENDING_BT_STATUSES },
        $or: [{ fromProjectId: { $in: projectIds } }, { toProjectId: { $in: projectIds } }],
      },
    },
    {
      $project: {
        projectIds: ['$fromProjectId', '$toProjectId'],
      },
    },
    { $unwind: '$projectIds' },
    { $match: { projectIds: { $in: projectIds } } },
    { $group: { _id: '$projectIds', count: { $sum: 1 } } },
  ]);
  return mapCounts(rows);
}

function resolveProcurementStatus({ pendingMrs, pendingPrs, pendingPos, pendingGrns, pendingBts }) {
  const total = pendingMrs + pendingPrs + pendingPos + pendingGrns + pendingBts;
  if (total === 0) return 'On track';
  if (pendingPos > 0 || pendingBts > 0) return 'Pending approvals';
  if (pendingGrns > 0) return 'Awaiting delivery';
  if (pendingPrs > 0 || pendingMrs > 0) return 'Procurement in progress';
  return 'Attention needed';
}

function resolveBudgetStatus(deployPct) {
  if (deployPct >= 95) return 'Over budget';
  if (deployPct >= 85) return 'Watch';
  return 'On track';
}

function resolveInventoryHealth(healthScore) {
  if (healthScore >= 80) return 'Healthy';
  if (healthScore >= 60) return 'Watch';
  return 'Low';
}

async function getExplorerProjects(user) {
  const query = buildExplorerProjectQuery(user);
  const projects = await Project.find(query).sort({ name: 1 }).lean();
  if (!projects.length) return [];

  const projectIds = projects.map((p) => p._id);

  const [
    sites,
    pmUsers,
    pendingMrs,
    pendingPrs,
    pendingPos,
    pendingGrns,
    pendingBts,
  ] = await Promise.all([
    Site.find({ projectId: { $in: projectIds } }).select('projectId name').lean(),
    User.find({
      role: UserRole.PROJECT_MANAGER,
      assignedProjectIds: { $in: projectIds },
    })
      .select('name assignedProjectIds')
      .lean(),
    countMaterialRequestsByProject(projectIds),
    countPurchaseRequestsByProject(projectIds),
    countPurchaseOrdersByProject(projectIds),
    countPendingGrnsByProject(projectIds),
    countBranchTransfersByProject(projectIds),
  ]);

  const sitesByProject = {};
  for (const site of sites) {
    const pid = site.projectId.toString();
    if (!sitesByProject[pid]) sitesByProject[pid] = [];
    sitesByProject[pid].push(site.name);
  }

  const pmByProject = {};
  for (const pm of pmUsers) {
    for (const pid of pm.assignedProjectIds || []) {
      const key = pid.toString();
      if (!projectIds.some((id) => id.toString() === key)) continue;
      if (!pmByProject[key]) pmByProject[key] = [];
      pmByProject[key].push(pm.name);
    }
  }

  return projects.map((p) => {
    const pid = p._id.toString();
    const budgetTotal = p.budgetTotal || 0;
    const budgetSpent = p.budgetSpent || 0;
    const deployPct = budgetTotal > 0 ? Math.round((budgetSpent / budgetTotal) * 100) : 0;
    const healthScore = p.healthScore ?? 100;
    const storeNames = sitesByProject[pid] || [];
    const mrCount = pendingMrs[pid] || 0;
    const prCount = pendingPrs[pid] || 0;
    const poCount = pendingPos[pid] || 0;
    const grnCount = pendingGrns[pid] || 0;
    const btCount = pendingBts[pid] || 0;

    return {
      id: pid,
      code: p.code,
      name: p.name,
      status: p.status,
      storeNames,
      storeCount: storeNames.length,
      projectManagers: pmByProject[pid] || [],
      projectManager: (pmByProject[pid] || []).join(', ') || '—',
      procurementStatus: resolveProcurementStatus({
        pendingMrs: mrCount,
        pendingPrs: prCount,
        pendingPos: poCount,
        pendingGrns: grnCount,
        pendingBts: btCount,
      }),
      pendingMaterialRequests: mrCount,
      pendingPurchaseRequests: prCount,
      pendingPurchaseOrders: poCount,
      pendingGrns: grnCount,
      pendingBranchTransfers: btCount,
      inventoryHealth: resolveInventoryHealth(healthScore),
      budgetStatus: resolveBudgetStatus(deployPct),
      budgetTotal,
      budgetSpent,
      deployPct,
      healthScore,
      siteCount: storeNames.length,
    };
  });
}

module.exports = {
  buildExplorerProjectQuery,
  getExplorerProjects,
};
