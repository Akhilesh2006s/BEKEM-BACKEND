const { UserRole } = require('@afios/shared');
const { PurchaseRequest, MaterialRequest } = require('../models');

/**
 * Purchase requests "raised by" Store/PM:
 * - PR.createdByUserId = user (e.g. PM approved → PR created), or
 * - linked indent requestedByUserId = user (Store/PM raised the indent).
 */
async function findRaisedPurchaseRequestIds(userId) {
  const uid = userId?.toString?.() || userId;
  const ownMrs = await MaterialRequest.find({ requestedByUserId: uid }).select('_id').lean();
  const mrIds = ownMrs.map((m) => m._id);

  const prs = await PurchaseRequest.find({
    $or: [{ createdByUserId: uid }, ...(mrIds.length ? [{ materialRequestId: { $in: mrIds } }] : [])],
  })
    .select('_id')
    .lean();

  return prs.map((p) => p._id);
}

async function listProcurementRequestsForUser(user) {
  const role = user.role;

  if (role === UserRole.STORE_INCHARGE || role === UserRole.PROJECT_MANAGER) {
    const ids = await findRaisedPurchaseRequestIds(user._id || user.id);
    if (!ids.length) return [];
    return PurchaseRequest.find({ _id: { $in: ids } })
      .sort({ createdAt: -1 })
      .populate([{ path: 'projectId' }, { path: 'materialRequestId' }]);
  }

  if ([UserRole.EXECUTIVE, UserRole.COORDINATOR, UserRole.CHAIRMAN].includes(role)) {
    return PurchaseRequest.find({ status: { $nin: ['CANCELLED'] } })
      .sort({ createdAt: -1 })
      .populate([{ path: 'projectId' }, { path: 'materialRequestId' }])
      .limit(200);
  }

  return [];
}

module.exports = {
  findRaisedPurchaseRequestIds,
  listProcurementRequestsForUser,
};
