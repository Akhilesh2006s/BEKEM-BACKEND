const { PurchaseRequest, PurchaseOrder, MaterialRequest } = require('../models');
const { UserRole } = require('@afios/shared');
const { buildExecutiveIndentCategoryFilter } = require('./executiveRoutingService');

const EXECUTIVE_PR_STATUSES = ['OPEN'];

function executivePurchaseRequestFilter(extra = {}) {
  return {
    ...extra,
    status: { $in: EXECUTIVE_PR_STATUSES },
  };
}

const LIST_POPULATE = [
  { path: 'projectId' },
  {
    path: 'materialRequestId',
    populate: [
      { path: 'items.materialId' },
      { path: 'materialId' },
    ],
  },
  { path: 'executiveRecommendedByUserId', select: 'name' },
];

async function listOpenPurchaseRequests() {
  return PurchaseRequest.find(executivePurchaseRequestFilter())
    .sort({ createdAt: -1 })
    .populate(LIST_POPULATE);
}

async function filterReadyForExecutivePo(prs) {
  if (!prs.length) return [];
  const prIds = prs.map((pr) => pr._id);
  const orderedPrIds = await PurchaseOrder.distinct('purchaseRequestId', {
    purchaseRequestId: { $in: prIds },
    status: { $ne: 'REJECTED' },
  });
  const orderedSet = new Set(orderedPrIds.map((id) => id.toString()));
  const withoutPo = prs.filter((pr) => !orderedSet.has(pr._id.toString()));
  if (!withoutPo.length) return [];

  const { RFQ } = require('../models');
  const finalized = await RFQ.find({
    purchaseRequestId: { $in: withoutPo.map((p) => p._id) },
    status: 'FINALIZED',
  })
    .select('purchaseRequestId')
    .lean();
  const ready = new Set(finalized.map((r) => r.purchaseRequestId.toString()));
  return withoutPo.filter((pr) => ready.has(pr._id.toString()));
}

/** OPEN PRs that still need RFQ share / vendor quotes (not yet finalized). */
async function filterReadyForRfq(prs) {
  if (!prs.length) return [];
  const prIds = prs.map((pr) => pr._id);
  const orderedPrIds = await PurchaseOrder.distinct('purchaseRequestId', {
    purchaseRequestId: { $in: prIds },
    status: { $ne: 'REJECTED' },
  });
  const orderedSet = new Set(orderedPrIds.map((id) => id.toString()));
  const withoutPo = prs.filter((pr) => !orderedSet.has(pr._id.toString()));
  if (!withoutPo.length) return [];

  const { RFQ } = require('../models');
  const finalized = await RFQ.find({
    purchaseRequestId: { $in: withoutPo.map((p) => p._id) },
    status: 'FINALIZED',
  })
    .select('purchaseRequestId')
    .lean();
  const done = new Set(finalized.map((r) => r.purchaseRequestId.toString()));
  return withoutPo.filter((pr) => !done.has(pr._id.toString()));
}

async function filterPurchaseRequestsForExecutive(user, prs) {
  if (user?.role !== UserRole.EXECUTIVE) return prs;
  const categoryFilter = buildExecutiveIndentCategoryFilter(user);
  if (!categoryFilter.$or) return prs;

  const mrIds = prs
    .map((pr) => pr.materialRequestId?._id || pr.materialRequestId)
    .filter(Boolean);
  if (!mrIds.length) return prs;

  const allowedMrs = await MaterialRequest.find({
    _id: { $in: mrIds },
    ...categoryFilter,
  })
    .select('_id')
    .lean();
  const allowed = new Set(allowedMrs.map((mr) => mr._id.toString()));
  return prs.filter((pr) => {
    const mrId = (pr.materialRequestId?._id || pr.materialRequestId)?.toString();
    return mrId && allowed.has(mrId);
  });
}

async function listExecutivePendingPurchaseRequests(user) {
  const open = await listOpenPurchaseRequests();
  const ready = await filterReadyForExecutivePo(open);
  return filterPurchaseRequestsForExecutive(user, ready);
}

async function listExecutiveReadyForRfq(user) {
  const open = await listOpenPurchaseRequests();
  const ready = await filterReadyForRfq(open);
  return filterPurchaseRequestsForExecutive(user, ready);
}

async function countExecutivePendingPurchaseRequests(user) {
  const items = await listExecutivePendingPurchaseRequests(user);
  return items.length;
}

module.exports = {
  EXECUTIVE_PR_STATUSES,
  executivePurchaseRequestFilter,
  listExecutivePendingPurchaseRequests,
  listExecutiveReadyForRfq,
  countExecutivePendingPurchaseRequests,
  filterPurchaseRequestsForExecutive,
  filterReadyForExecutivePo,
  filterReadyForRfq,
};
