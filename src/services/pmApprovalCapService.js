const { StatusHistory, MaterialRequest } = require('../models');
const { UserRole } = require('@afios/shared');
const { MR_PM_DAILY_MAX_INR, APP_TIMEZONE } = require('../constants/indentPolicy');
const { estimateIndentAmount } = require('./purchaseRequestService');

function getTimezoneOffset(date, timeZone) {
  const utc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  const local = new Date(date.toLocaleString('en-US', { timeZone }));
  const diffMin = (local - utc) / 60000;
  const sign = diffMin >= 0 ? '+' : '-';
  const abs = Math.abs(diffMin);
  const h = String(Math.floor(abs / 60)).padStart(2, '0');
  const m = String(abs % 60).padStart(2, '0');
  return `${sign}${h}:${m}`;
}

function getDayBounds(date = new Date(), timeZone = APP_TIMEZONE) {
  const dayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  const offset = getTimezoneOffset(date, timeZone);
  return {
    dayStr,
    start: new Date(`${dayStr}T00:00:00${offset}`),
    end: new Date(`${dayStr}T23:59:59.999${offset}`),
  };
}

async function getPmDailyApprovedTotal(pmUserId, date = new Date()) {
  const { start, end } = getDayBounds(date);
  const approvals = await StatusHistory.find({
    entityType: 'MaterialRequest',
    actorUserId: pmUserId,
    toStatus: 'PM_APPROVED',
    timestamp: { $gte: start, $lte: end },
  }).select('entityId');

  let total = 0;
  for (const entry of approvals) {
    const mr = await MaterialRequest.findById(entry.entityId).select(
      'estimatedValue items quantityRequested materialId'
    );
    if (!mr) continue;
    total += mr.estimatedValue ?? (await estimateIndentAmount(mr));
  }
  return Math.round(total);
}

function wouldExceedPmDailyCap(currentTotal, requestValue) {
  return currentTotal + requestValue > MR_PM_DAILY_MAX_INR;
}

async function checkPmCanApprove(pmUserId, mr) {
  const requestValue = mr.estimatedValue ?? (await estimateIndentAmount(mr));
  const dailyApprovedTotal = await getPmDailyApprovedTotal(pmUserId);
  const wouldExceed = wouldExceedPmDailyCap(dailyApprovedTotal, requestValue);
  return {
    dailyApprovedTotal,
    requestValue,
    dailyCap: MR_PM_DAILY_MAX_INR,
    wouldExceed,
    remaining: Math.max(0, MR_PM_DAILY_MAX_INR - dailyApprovedTotal),
  };
}

module.exports = {
  MR_PM_DAILY_MAX_INR,
  APP_TIMEZONE,
  getDayBounds,
  getPmDailyApprovedTotal,
  wouldExceedPmDailyCap,
  checkPmCanApprove,
};
