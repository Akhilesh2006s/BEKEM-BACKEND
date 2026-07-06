const { getSettings } = require('../services/orgSettingsService');

function limits() {
  return getSettings();
}

const ISSUE_REASONS = ['emergency', 'already_approved', 'urgent_work', 'repeat_issue', 'other'];

module.exports = {
  get MR_PM_DAILY_MAX_INR() {
    return limits().mrPmDailyMaxInr;
  },
  get APP_TIMEZONE() {
    return limits().timezone;
  },
  ISSUE_REASONS,
};
