const { StatusHistory, MaterialRequest } = require('../models');
const { getSettings } = require('./orgSettingsService');
const { estimateIndentAmount } = require('./purchaseRequestService');
const { getDayBounds } = require('./pmApprovalCapService');

const COORDINATOR_LOCAL_CLOSE_STATUSES = [
  'PENDING_HO',
  'PENDING_EXECUTIVE_DECISION',
  'EXECUTIVE_DECISION_PO',
  'EXECUTIVE_DECISION_BRANCH_TRANSFER',
  'HO_PENDING_COORDINATOR',
];

const COORDINATOR_CAP_STATUSES = ['ALLOCATED', 'PURCHASE_REQUESTED', 'BRANCH_TRANSFER_REQUESTED'];

function dailyCap() {
  return getSettings().mrCoordinatorDailyMaxInr;
}

async function getCoordinatorDailyApprovedTotal(coordinatorUserId, date = new Date()) {
  const { start, endExclusive } = getDayBounds(date);
  const approvals = await StatusHistory.find({
    entityType: 'MaterialRequest',
    actorUserId: coordinatorUserId,
    toStatus: { $in: COORDINATOR_CAP_STATUSES },
    timestamp: { $gte: start, $lt: endExclusive },
  }).select('entityId');

  const seen = new Set();
  let total = 0;
  for (const entry of approvals) {
    const id = entry.entityId?.toString();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const mr = await MaterialRequest.findById(entry.entityId).select(
      'estimatedValue items quantityRequested materialId'
    );
    if (!mr) continue;
    total += mr.estimatedValue ?? (await estimateIndentAmount(mr));
  }
  return Math.round(total);
}

function wouldExceedCoordinatorDailyCap(currentTotal, requestValue) {
  return currentTotal + requestValue > dailyCap();
}

async function checkCoordinatorCanApprove(coordinatorUserId, mr) {
  const requestValue = mr.estimatedValue ?? (await estimateIndentAmount(mr));
  const dailyApprovedTotal = await getCoordinatorDailyApprovedTotal(coordinatorUserId);
  const wouldExceed = wouldExceedCoordinatorDailyCap(dailyApprovedTotal, requestValue);
  return {
    dailyApprovedTotal,
    requestValue,
    dailyCap: dailyCap(),
    wouldExceed,
    remaining: Math.max(0, dailyCap() - dailyApprovedTotal),
  };
}

function canCoordinatorLocalCloseStatus(status) {
  return COORDINATOR_LOCAL_CLOSE_STATUSES.includes(status);
}

module.exports = {
  get MR_COORDINATOR_DAILY_MAX_INR() {
    return dailyCap();
  },
  COORDINATOR_LOCAL_CLOSE_STATUSES,
  getCoordinatorDailyApprovedTotal,
  wouldExceedCoordinatorDailyCap,
  checkCoordinatorCanApprove,
  canCoordinatorLocalCloseStatus,
};
