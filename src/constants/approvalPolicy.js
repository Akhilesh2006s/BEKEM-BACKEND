/**
 * PO approval routing (INR) — limits loaded from Org Settings (Admin) with env fallback.
 */
const { getSettings } = require('../services/orgSettingsService');

function limits() {
  return getSettings();
}

function poAmount(amount) {
  return Number(amount || 0);
}

function requiresPmApproval(_amount) {
  return false;
}

function requiresCoordinatorFinalApproval(_amount) {
  return false;
}

function requiresChairmanApproval(_amount) {
  return true;
}

function initialPoStatusForAmount(_amount) {
  // PO creation is Executive-only; approval is Coordinator → Chairman (no PM band).
  return 'COORDINATOR_PENDING';
}

function poApprovalRoutingNote(po) {
  if (po?.status === 'CHAIRMAN_PENDING' || po?.status === 'PENDING_APPROVAL') {
    return 'Coordinator verified; Chairman final approval is required.';
  }
  if (['PM_PENDING', 'COORDINATOR_PENDING', 'PENDING_REVIEW'].includes(po?.status)) {
    return 'Coordinator verifies, then Chairman approves every purchase order.';
  }
  if (po?.status === 'APPROVED') {
    return 'Purchase orders require Coordinator verification and Chairman final approval.';
  }
  return limits().approvalRoutingNote;
}

module.exports = {
  get PO_PM_MAX_INR() {
    return limits().poPmMaxInr;
  },
  get PO_COORDINATOR_MAX_INR() {
    return limits().poCoordinatorMaxInr;
  },
  get PO_CHAIRMAN_APPROVAL_THRESHOLD_INR() {
    return limits().poCoordinatorMaxInr;
  },
  requiresPmApproval,
  requiresCoordinatorFinalApproval,
  requiresChairmanApproval,
  initialPoStatusForAmount,
  poApprovalRoutingNote,
};
