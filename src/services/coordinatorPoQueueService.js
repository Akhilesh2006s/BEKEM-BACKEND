const { PurchaseOrder } = require('../models');

/** Statuses where Coordinator must verify/review before PM final or Chairman routing. */
const COORDINATOR_VERIFY_PO_STATUSES = ['COORDINATOR_PENDING', 'PENDING_REVIEW'];

function coordinatorVerifyPoFilter(extra = {}) {
  return {
    ...extra,
    status: { $in: COORDINATOR_VERIFY_PO_STATUSES },
  };
}

const PO_POPULATE = [
  { path: 'vendorId' },
  {
    path: 'purchaseRequestId',
    populate: [{ path: 'projectId' }, { path: 'materialRequestId' }],
  },
  { path: 'quotationId', populate: { path: 'vendorId' } },
];

async function countCoordinatorVerifyPos() {
  return PurchaseOrder.countDocuments(coordinatorVerifyPoFilter());
}

async function listCoordinatorVerifyPos() {
  return PurchaseOrder.find(coordinatorVerifyPoFilter())
    .sort({ createdAt: -1 })
    .populate(PO_POPULATE);
}

function poRequiresCoordinatorVerification(status) {
  return COORDINATOR_VERIFY_PO_STATUSES.includes(status);
}

module.exports = {
  COORDINATOR_VERIFY_PO_STATUSES,
  PO_POPULATE,
  coordinatorVerifyPoFilter,
  countCoordinatorVerifyPos,
  listCoordinatorVerifyPos,
  poRequiresCoordinatorVerification,
};
