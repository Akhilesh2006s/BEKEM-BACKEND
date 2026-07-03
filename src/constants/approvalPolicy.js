/**
 * PO approval routing (INR):
 * - Below ₹5,000 → Project Manager final approval
 * - ₹5,000–₹10,000 → Coordinator final approval
 * - Above ₹10,000 → Chairman final approval
 *   (Coordinator may approve only with explicit “Chairman not on premises” note)
 */
const PO_PM_MAX_INR = Number(process.env.PO_PM_MAX_INR || '5000');
const PO_COORDINATOR_MAX_INR = Number(process.env.PO_COORDINATOR_MAX_INR || '10000');

function poAmount(amount) {
  return Number(amount || 0);
}

function requiresPmApproval(amount) {
  return poAmount(amount) < PO_PM_MAX_INR;
}

function requiresCoordinatorFinalApproval(amount) {
  const a = poAmount(amount);
  return a >= PO_PM_MAX_INR && a <= PO_COORDINATOR_MAX_INR;
}

function requiresChairmanApproval(amount) {
  return poAmount(amount) > PO_COORDINATOR_MAX_INR;
}

function initialPoStatusForAmount(amount) {
  if (requiresPmApproval(amount)) return 'PM_PENDING';
  return 'COORDINATOR_PENDING';
}

function poApprovalRoutingNote(po) {
  const amount = poAmount(po?.amount);
  const fmt = (n) => `₹${n.toLocaleString('en-IN')}`;

  if (po?.status === 'PM_PENDING') {
    return `Amount ${fmt(amount)} is below ${fmt(PO_PM_MAX_INR)} — Project Manager final approval only.`;
  }
  if (po?.status === 'CHAIRMAN_PENDING' || po?.status === 'PENDING_APPROVAL') {
    return `Amount ${fmt(amount)} is above ${fmt(PO_COORDINATOR_MAX_INR)} — Chairman final approval required (or Coordinator may approve only if Chairman is not on premises, with a written reason).`;
  }
  if (po?.status === 'COORDINATOR_PENDING' || po?.status === 'PENDING_REVIEW') {
    if (requiresChairmanApproval(amount)) {
      return `Amount ${fmt(amount)} is above ${fmt(PO_COORDINATOR_MAX_INR)}. Coordinator verifies then routes to Chairman, or may approve with a note that Chairman is not on premises.`;
    }
    if (requiresCoordinatorFinalApproval(amount)) {
      return `Amount ${fmt(amount)} is between ${fmt(PO_PM_MAX_INR)} and ${fmt(PO_COORDINATOR_MAX_INR)} — Coordinator final approval.`;
    }
    return `Amount ${fmt(amount)} is below ${fmt(PO_PM_MAX_INR)} — should be with Project Manager.`;
  }
  if (po?.status === 'APPROVED') {
    if (requiresPmApproval(amount)) {
      return `Approved by Project Manager (under ${fmt(PO_PM_MAX_INR)}).`;
    }
    if (requiresCoordinatorFinalApproval(amount)) {
      return `Approved by Coordinator (${fmt(PO_PM_MAX_INR)}–${fmt(PO_COORDINATOR_MAX_INR)} band).`;
    }
    return `Approved via Chairman queue (above ${fmt(PO_COORDINATOR_MAX_INR)}), or Coordinator exception (Chairman not on premises).`;
  }
  return `Routing: < ${fmt(PO_PM_MAX_INR)} PM · ${fmt(PO_PM_MAX_INR)}–${fmt(PO_COORDINATOR_MAX_INR)} Coordinator · > ${fmt(PO_COORDINATOR_MAX_INR)} Chairman.`;
}

module.exports = {
  PO_PM_MAX_INR,
  PO_COORDINATOR_MAX_INR,
  /** @deprecated use requiresChairmanApproval — kept for older imports */
  PO_CHAIRMAN_APPROVAL_THRESHOLD_INR: PO_COORDINATOR_MAX_INR,
  requiresPmApproval,
  requiresCoordinatorFinalApproval,
  requiresChairmanApproval,
  initialPoStatusForAmount,
  poApprovalRoutingNote,
};
