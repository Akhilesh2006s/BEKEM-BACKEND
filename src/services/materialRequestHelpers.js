function getIndentLineItems(mr) {
  if (mr.items?.length) return mr.items;
  if (mr.materialId) {
    return [
      {
        _id: mr._id,
        materialId: mr.materialId,
        quantityRequested: mr.quantityRequested,
        quantityAllocated: mr.quantityAllocated || 0,
        quantityIssued: mr.quantityIssued || 0,
      },
    ];
  }
  return [];
}

function pendingWithLabel(status) {
  const map = {
    PENDING_STORE: 'STORE_INCHARGE',
    ALLOCATED: 'STORE_INCHARGE',
    FORWARDED_TO_PM: 'PROJECT_MANAGER',
    BRANCH_TRANSFER_REQUESTED: 'PROJECT_MANAGER',
    PENDING_HO: 'EXECUTIVE',
    PENDING_EXECUTIVE_DECISION: 'EXECUTIVE',
    EXECUTIVE_DECISION_PO: 'COORDINATOR',
    EXECUTIVE_DECISION_BRANCH_TRANSFER: 'COORDINATOR',
    // PM local close / Below ₹5,000 approve → Store purchases & allocates
    PM_APPROVED: 'STORE_INCHARGE',
    PURCHASE_REQUESTED: 'EXECUTIVE',
    PO_CREATED: 'COORDINATOR',
    COORDINATOR_VERIFIED: 'CHAIRMAN',
    CHAIRMAN_APPROVED: 'STORE_INCHARGE',
    MATERIAL_RECEIVED: 'STORE_INCHARGE',
    ISSUED: 'SITE_INCHARGE',
    COMPLETED: null,
    REJECTED: null,
    CANCELLED: null,
  };
  return map[status] || 'STORE_INCHARGE';
}

const SITE_STATUS_STEPS = [
  { key: 'PENDING_STORE', label: 'Pending at Store' },
  { key: 'ALLOCATED', label: 'Pending at Store' },
  { key: 'FORWARDED_TO_PM', label: 'Pending at PM' },
  { key: 'BRANCH_TRANSFER_REQUESTED', label: 'Pending at PM' },
  { key: 'PENDING_HO', label: 'Pending at Executive' },
  { key: 'PENDING_EXECUTIVE_DECISION', label: 'Pending at Executive' },
  { key: 'EXECUTIVE_DECISION_PO', label: 'Pending at Coordinator' },
  { key: 'EXECUTIVE_DECISION_BRANCH_TRANSFER', label: 'Pending at Coordinator' },
  { key: 'PM_APPROVED', label: 'Pending at Store' },
  { key: 'PURCHASE_REQUESTED', label: 'Pending at Executive' },
  { key: 'PO_CREATED', label: 'Pending at Coordinator' },
  { key: 'COORDINATOR_VERIFIED', label: 'Pending at Chairman' },
  { key: 'CHAIRMAN_APPROVED', label: 'Pending at Store' },
  { key: 'MATERIAL_RECEIVED', label: 'Material Received' },
  { key: 'ISSUED', label: 'Issued' },
  { key: 'COMPLETED', label: 'Completed' },
];

module.exports = { getIndentLineItems, pendingWithLabel, SITE_STATUS_STEPS };
