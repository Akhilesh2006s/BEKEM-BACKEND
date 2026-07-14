const { PurchaseOrder } = require('../models');

const PENDING_PO_PRIORITY = [
  'COORDINATOR_PENDING',
  'PENDING_REVIEW',
  'CHAIRMAN_PENDING',
  'PENDING_APPROVAL',
  'PM_PENDING',
  'DRAFT',
];

/**
 * Map live PO status → who holds the next action (for indent/PR labels).
 */
function pendingRoleForPoStatus(poStatus) {
  if (['COORDINATOR_PENDING', 'PENDING_REVIEW'].includes(poStatus)) return 'COORDINATOR';
  if (['CHAIRMAN_PENDING', 'PENDING_APPROVAL'].includes(poStatus)) return 'CHAIRMAN';
  if (poStatus === 'PM_PENDING') return 'PROJECT_MANAGER';
  if (poStatus === 'APPROVED') return null;
  return 'COORDINATOR';
}

function pickActivePo(pos) {
  if (!pos?.length) return null;
  for (const status of PENDING_PO_PRIORITY) {
    const hit = pos.find((p) => p.status === status);
    if (hit) return hit;
  }
  return pos[0];
}

/**
 * When PR/indent is marked PO_CREATED, resolve actual approval desk from linked POs.
 */
async function resolveLinkedPoApprovalState(purchaseRequestId) {
  if (!purchaseRequestId) return null;
  const pos = await PurchaseOrder.find({
    purchaseRequestId,
    status: { $ne: 'REJECTED' },
  })
    .select('status amount createdAt draftRef poNumber')
    .sort({ createdAt: -1 })
    .lean();
  if (!pos.length) return null;
  const active = pickActivePo(pos);
  return {
    poId: active._id.toString(),
    poStatus: active.status,
    poAmount: active.amount != null ? Number(active.amount) : null,
    poRef: active.draftRef || active.poNumber || null,
    pendingWithRole: pendingRoleForPoStatus(active.status),
  };
}

module.exports = {
  pendingRoleForPoStatus,
  pickActivePo,
  resolveLinkedPoApprovalState,
};
