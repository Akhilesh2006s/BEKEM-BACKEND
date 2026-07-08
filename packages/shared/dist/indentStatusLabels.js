"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HEAD_OFFICE_PIPELINE_STATUSES = void 0;
exports.isHeadOfficePipelineStatus = isHeadOfficePipelineStatus;
exports.getIndentStatusLabel = getIndentStatusLabel;
/** Statuses where Head Office owns procurement — site/store see a single friendly label. */
exports.HEAD_OFFICE_PIPELINE_STATUSES = new Set([
    'PENDING_HO',
    'PENDING_EXECUTIVE_DECISION',
    'EXECUTIVE_DECISION_PO',
    'EXECUTIVE_DECISION_BRANCH_TRANSFER',
    'PM_APPROVED',
    'PURCHASE_REQUESTED',
    'RFQ_OPEN',
    'QUOTED',
    'VENDOR_SELECTED',
    'PO_CREATED',
    'COORDINATOR_VERIFIED',
    'CHAIRMAN_APPROVED',
]);
const INTERNAL_STATUS_LABELS = {
    PENDING_STORE: 'Pending',
    ALLOCATED: 'Store accepted',
    FORWARDED_TO_PM: 'With PM',
    BRANCH_TRANSFER_REQUESTED: 'Branch transfer',
    PENDING_HO: 'Head Office',
    PENDING_EXECUTIVE_DECISION: 'Executive decision',
    EXECUTIVE_DECISION_PO: 'Executive: PO',
    EXECUTIVE_DECISION_BRANCH_TRANSFER: 'Executive: branch transfer',
    PM_APPROVED: 'Approved',
    PURCHASE_REQUESTED: 'Purchase request created',
    RFQ_OPEN: 'RFQ open',
    QUOTED: 'Quotes received',
    VENDOR_SELECTED: 'Vendor selected',
    PO_CREATED: 'Processing',
    COORDINATOR_VERIFIED: 'Coordinator verified',
    CHAIRMAN_APPROVED: 'Approved',
    MATERIAL_RECEIVED: 'Received',
    ISSUED: 'Issued',
    COMPLETED: 'Completed',
    REJECTED: 'Rejected',
    CANCELLED: 'Cancelled',
};
const SITE_FACING_LABELS = {
    PENDING_STORE: 'Pending at store',
    ALLOCATED: 'At store',
    FORWARDED_TO_PM: 'With project manager',
    BRANCH_TRANSFER_REQUESTED: 'Branch transfer',
    MATERIAL_RECEIVED: 'Received at store',
    ISSUED: 'Issued to site',
    COMPLETED: 'Completed',
    REJECTED: 'Rejected',
    CANCELLED: 'Cancelled',
};
function isHeadOfficePipelineStatus(status) {
    return exports.HEAD_OFFICE_PIPELINE_STATUSES.has(status);
}
function getIndentStatusLabel(status, viewerRole) {
    if (viewerRole === 'SITE_INCHARGE' || viewerRole === 'STORE_INCHARGE') {
        if (exports.HEAD_OFFICE_PIPELINE_STATUSES.has(status)) {
            return 'With Head Office';
        }
        if (SITE_FACING_LABELS[status]) {
            return SITE_FACING_LABELS[status];
        }
    }
    return INTERNAL_STATUS_LABELS[status] || status.replace(/_/g, ' ').toLowerCase();
}
