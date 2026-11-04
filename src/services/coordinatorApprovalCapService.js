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

async function getCoordinatorDailyApprovedTotal(coordinatorUserId, date = new Date(), session = null) {
  const { start, endExclusive } = getDayBounds(date);
  const approvals = await StatusHistory.find({
    entityType: 'MaterialRequest',
    actorUserId: coordinatorUserId,
    toStatus: { $in: COORDINATOR_CAP_STATUSES },
    note: { $not: /Chairman authorized/i },
    timestamp: { $gte: start, $lt: endExclusive },
  }).session(session).select('entityId');

  const seen = new Set();
  let total = 0;
  for (const entry of approvals) {
    const id = entry.entityId?.toString();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const mr = await MaterialRequest.findById(entry.entityId).session(session).select(
      'estimatedValue items quantityRequested materialId'
    );
    if (!mr) continue;
    let value = Number(mr.estimatedValue);
    if (!(value > 0)) value = await estimateIndentAmount(mr);
    total += value;
  }
  return Math.round(total * 100) / 100;
}

function wouldExceedCoordinatorDailyCap(currentTotal, requestValue) {
  return Math.round(currentTotal * 100) + Math.round(requestValue * 100) > Math.round(dailyCap() * 100);
}

async function checkCoordinatorCanApprove(coordinatorUserId, mr, session = null) {
  let requestValue = Number(mr.estimatedValue);
  if (!(requestValue > 0)) {
    requestValue = await estimateIndentAmount(mr);
  }
  const dailyApprovedTotal = await getCoordinatorDailyApprovedTotal(coordinatorUserId, new Date(), session);
  const wouldExceed = wouldExceedCoordinatorDailyCap(dailyApprovedTotal, requestValue);
  return {
    dailyApprovedTotal,
    requestValue,
    dailyCap: dailyCap(),
    wouldExceed,
    remaining: Math.max(0, dailyCap() - dailyApprovedTotal),
  };
}

/** Suggestion line for Coordinator notifications / UI when within ₹10,000/day. */
function coordinatorLocalApproveHint(capCheck) {
  if (!capCheck || capCheck.wouldExceed) return '';
  const capLabel = `₹${Number(capCheck.dailyCap || dailyCap()).toLocaleString('en-IN')}`;
  return `\nCan locally approve and close (within ${capLabel}/day). No need to escalate to MD / Chairman.`;
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
  coordinatorLocalApproveHint,
};
