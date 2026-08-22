const { INDENT_VALUE_CAP_INR } = require('@afios/shared');

/** PM may close a single indent only up to this value. Above this, routing goes to HO. */
const PM_INDENT_APPROVAL_LIMIT_INR = INDENT_VALUE_CAP_INR;

const PM_ABOVE_APPROVAL_LEVEL_MESSAGE =
  'This indent value is higher than the PM approval level. Please proceed to HO level for further approvals.';

const PM_APPROVED_FORWARDED_TO_HO_MESSAGE = 'Approved and forwarded to HO level.';

/** True when this indent's value is above the PM's per-indent approval limit. */
function indentExceedsPmApprovalLevel(estimatedValue, indentRequestType) {
  const value = Number(estimatedValue) || 0;
  if (value > PM_INDENT_APPROVAL_LIMIT_INR) return true;
  if (value > 0) return false;
  return indentRequestType === 'ABOVE_5000';
}

module.exports = {
  PM_INDENT_APPROVAL_LIMIT_INR,
  PM_ABOVE_APPROVAL_LEVEL_MESSAGE,
  PM_APPROVED_FORWARDED_TO_HO_MESSAGE,
  indentExceedsPmApprovalLevel,
};
