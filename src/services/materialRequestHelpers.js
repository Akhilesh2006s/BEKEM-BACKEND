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
    PENDING_HO: 'EXECUTIVE',
    PM_APPROVED: 'EXECUTIVE',
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
  { key: 'PENDING_STORE', label: 'Submitted' },
  { key: 'ALLOCATED', label: 'Store Accepted' },
  { key: 'FORWARDED_TO_PM', label: 'Forwarded to PM' },
  { key: 'PENDING_HO', label: 'Escalated to Head Office' },
  { key: 'PM_APPROVED', label: 'PM Approved' },
  { key: 'PURCHASE_REQUESTED', label: 'Executive Processing' },
  { key: 'PO_CREATED', label: 'PO Generated' },
  { key: 'COORDINATOR_VERIFIED', label: 'Coordinator Verified' },
  { key: 'CHAIRMAN_APPROVED', label: 'PO Approved' },
  { key: 'MATERIAL_RECEIVED', label: 'Material Received' },
  { key: 'ISSUED', label: 'Issued' },
  { key: 'COMPLETED', label: 'Completed' },
];

module.exports = { getIndentLineItems, pendingWithLabel, SITE_STATUS_STEPS };
