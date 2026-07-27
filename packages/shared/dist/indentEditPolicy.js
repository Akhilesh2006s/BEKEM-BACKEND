"use strict";
/**
 * One-level-ahead indent edit policy:
 * A role may modify an indent only while it is pending at the *next* desk.
 * Once it moves further, that role can no longer edit.
 *
 * Site   → edit only while pending at Store   (PENDING_STORE)
 * Store  → edit only while pending at PM      (FORWARDED_TO_PM)
 * PM     → edit only while pending at Executive / HO
 * Executive → edit only while pending at Coordinator
 * Coordinator → edit only while pending at Chairman (COORDINATOR_VERIFIED)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.INDENT_EDIT_STATUSES_BY_ROLE = void 0;
exports.canEditIndentOneLevelAhead = canEditIndentOneLevelAhead;
exports.indentEditLockedMessage = indentEditLockedMessage;
exports.INDENT_EDIT_STATUSES_BY_ROLE = {
    SITE_INCHARGE: ['PENDING_STORE'],
    STORE_INCHARGE: ['FORWARDED_TO_PM'],
    PROJECT_MANAGER: ['PENDING_HO', 'PENDING_EXECUTIVE_DECISION', 'PURCHASE_REQUESTED'],
    EXECUTIVE: ['EXECUTIVE_DECISION_PO', 'EXECUTIVE_DECISION_BRANCH_TRANSFER', 'HO_PENDING_COORDINATOR'],
    COORDINATOR: ['COORDINATOR_VERIFIED'],
};
function canEditIndentOneLevelAhead(role, status) {
    if (!role || !status)
        return false;
    const allowed = exports.INDENT_EDIT_STATUSES_BY_ROLE[role];
    return Boolean(allowed?.includes(status));
}
function indentEditLockedMessage(role, status) {
    if (canEditIndentOneLevelAhead(role, status))
        return '';
    return 'This indent can no longer be modified — it has moved past your edit window (one level ahead only).';
}
