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

function requiresPmApproval(amount) {
  return poAmount(amount) < limits().poPmMaxInr;
}

function requiresCoordinatorFinalApproval(amount) {
  const a = poAmount(amount);
  return a >= limits().poPmMaxInr && a <= limits().poCoordinatorMaxInr;
}

function requiresChairmanApproval(amount) {
  return poAmount(amount) > limits().poCoordinatorMaxInr;
}

function initialPoStatusForAmount(amount) {
  if (requiresPmApproval(amount)) return 'PM_PENDING';
  return 'COORDINATOR_PENDING';
}

function poApprovalRoutingNote(po) {
  const { poPmMaxInr, poCoordinatorMaxInr } = limits();
  const amount = poAmount(po?.amount);
  const fmt = (n) => `₹${n.toLocaleString('en-IN')}`;

  if (po?.status === 'PM_PENDING') {
    return `Amount ${fmt(amount)} is below ${fmt(poPmMaxInr)} — Project Manager final approval only.`;
  }
  if (po?.status === 'CHAIRMAN_PENDING' || po?.status === 'PENDING_APPROVAL') {
    return `Amount ${fmt(amount)} is above ${fmt(poCoordinatorMaxInr)} — Chairman final approval required (or Coordinator may approve only if Chairman is not on premises, with a written reason).`;
  }
  if (po?.status === 'COORDINATOR_PENDING' || po?.status === 'PENDING_REVIEW') {
    if (requiresChairmanApproval(amount)) {
      return `Amount ${fmt(amount)} is above ${fmt(poCoordinatorMaxInr)}. Coordinator verifies then routes to Chairman, or may approve with a note that Chairman is not on premises.`;
    }
    if (requiresCoordinatorFinalApproval(amount)) {
      return `Amount ${fmt(amount)} is between ${fmt(poPmMaxInr)} and ${fmt(poCoordinatorMaxInr)} — Coordinator final approval.`;
    }
    return `Amount ${fmt(amount)} is below ${fmt(poPmMaxInr)} — should be with Project Manager.`;
  }
  if (po?.status === 'APPROVED') {
    if (requiresPmApproval(amount)) {
      return `Approved by Project Manager (under ${fmt(poPmMaxInr)}).`;
    }
    if (requiresCoordinatorFinalApproval(amount)) {
      return `Approved by Coordinator (${fmt(poPmMaxInr)}–${fmt(poCoordinatorMaxInr)} band).`;
    }
    return `Approved via Chairman queue (above ${fmt(poCoordinatorMaxInr)}), or Coordinator exception (Chairman not on premises).`;
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
