const { PurchaseRequest, PurchaseOrder } = require('../models');

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
  return prs.filter((pr) => !orderedSet.has(pr._id.toString()));
}

async function listExecutivePendingPurchaseRequests() {
  const open = await listOpenPurchaseRequests();
  return filterReadyForExecutivePo(open);
}

async function countExecutivePendingPurchaseRequests() {
  const items = await listExecutivePendingPurchaseRequests();
  return items.length;
}

module.exports = {
  EXECUTIVE_PR_STATUSES,
  executivePurchaseRequestFilter,
  listExecutivePendingPurchaseRequests,
  countExecutivePendingPurchaseRequests,
  filterReadyForExecutivePo,
};
