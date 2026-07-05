const MR_PM_DAILY_MAX_INR = Number(process.env.MR_PM_DAILY_MAX_INR || '5000');
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Kolkata';

const ISSUE_REASONS = ['emergency', 'already_approved', 'urgent_work', 'repeat_issue', 'other'];

module.exports = {
  MR_PM_DAILY_MAX_INR,
  APP_TIMEZONE,
  ISSUE_REASONS,
};
