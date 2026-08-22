const { StatusHistory, MaterialRequest } = require('../models');
const { getSettings } = require('./orgSettingsService');
const { estimateIndentAmount } = require('./purchaseRequestService');

function dailyCap() {
  return getSettings().mrPmDailyMaxInr;
}

function appTimezone() {
  return getSettings().timezone;
}

function calendarDayStr(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Offset of `timeZone` at `date`, in milliseconds (IST = +19800000). */
function getTimeZoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const pick = (type) => Number(parts.find((p) => p.type === type).value);
  const asUtc = Date.UTC(
    pick('year'),
    pick('month') - 1,
    pick('day'),
    pick('hour'),
    pick('minute'),
    pick('second')
  );
  return asUtc - date.getTime();
}

function addCalendarDays(dayStr, days) {
  const [year, month, day] = dayStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** UTC instant for a wall-clock time on `dayStr` in `timeZone`. */
function zonedDateTimeToUtc(dayStr, hours, minutes, seconds, ms, timeZone) {
  const [year, month, day] = dayStr.split('-').map(Number);
  const asUtc = Date.UTC(year, month - 1, day, hours, minutes, seconds, ms);
  let instant = new Date(asUtc);
  instant = new Date(asUtc - getTimeZoneOffsetMs(instant, timeZone));
  instant = new Date(asUtc - getTimeZoneOffsetMs(instant, timeZone));
  return instant;
}

/**
 * Inclusive calendar-day window in the org timezone (default Asia/Kolkata).
 * A leftover indent from yesterday must not consume today's cap.
 */
function getDayBounds(date = new Date(), timeZone = appTimezone()) {
  const zone = timeZone || 'Asia/Kolkata';
  const dayStr = calendarDayStr(date, zone);
  const start = zonedDateTimeToUtc(dayStr, 0, 0, 0, 0, zone);
  const endExclusive = zonedDateTimeToUtc(addCalendarDays(dayStr, 1), 0, 0, 0, 0, zone);
  return {
    dayStr,
    start,
    end: new Date(endExclusive.getTime() - 1),
    endExclusive,
  };
}

async function indentCountsTowardPmDailyCap(mr) {
  if (!mr) return false;
  if (mr.indentRequestType === 'BELOW_5000') return false;
  return true;
}

async function sumApprovalValues(entries) {
  const seen = new Set();
  let total = 0;
  for (const entry of entries) {
    const id = entry.entityId?.toString();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const mr = await MaterialRequest.findById(entry.entityId).select(
      'estimatedValue items quantityRequested materialId indentRequestType'
    );
    if (!(await indentCountsTowardPmDailyCap(mr))) continue;
    total += mr.estimatedValue ?? (await estimateIndentAmount(mr));
  }
  return Math.round(total);
}

async function getPmDailyApprovedTotal(pmUserId, date = new Date()) {
  const { start, endExclusive } = getDayBounds(date);
  // Local PM close records ALLOCATED (from FORWARDED_TO_PM), not PM_APPROVED.
  // Only this calendar day's events count — yesterday's usage must not carry over.
  const approvals = await StatusHistory.find({
    entityType: 'MaterialRequest',
    actorUserId: pmUserId,
    timestamp: { $gte: start, $lt: endExclusive },
    $or: [
      { toStatus: 'PM_APPROVED' },
      { toStatus: 'ALLOCATED', fromStatus: 'FORWARDED_TO_PM' },
    ],
  }).select('entityId');

  return sumApprovalValues(approvals);
}

function wouldExceedPmDailyCap(currentTotal, requestValue) {
  return currentTotal + requestValue > dailyCap();
}

async function checkPmCanApprove(pmUserId, mr, date = new Date()) {
  const requestValue = mr.estimatedValue ?? (await estimateIndentAmount(mr));
  const dailyApprovedTotal = await getPmDailyApprovedTotal(pmUserId, date);
  // Below ₹5,000 indents stay with PM → Store; never count against HO daily-cap escalation.
  const isBelowCap = mr.indentRequestType === 'BELOW_5000';
  const wouldExceed = isBelowCap
    ? false
    : wouldExceedPmDailyCap(dailyApprovedTotal, requestValue);
  const { dayStr } = getDayBounds(date);
  return {
    dailyApprovedTotal,
    requestValue,
    dailyCap: dailyCap(),
    wouldExceed,
    remaining: Math.max(0, dailyCap() - dailyApprovedTotal),
    skippedCap: isBelowCap,
    day: dayStr,
  };
}

module.exports = {
  get MR_PM_DAILY_MAX_INR() {
    return dailyCap();
  },
  get APP_TIMEZONE() {
    return appTimezone();
  },
  getDayBounds,
  getPmDailyApprovedTotal,
  wouldExceedPmDailyCap,
  checkPmCanApprove,
};
