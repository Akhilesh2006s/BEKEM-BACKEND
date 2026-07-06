"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROLE_LABELS = exports.ROLE_COLORS = exports.PERMISSION_MATRIX = exports.ProjectStatus = exports.WorkOrderMilestoneStatus = exports.BranchTransferStatus = exports.WorkOrderStatus = exports.PurchaseOrderStatus = exports.StockMovementType = exports.MaterialRequestStatus = exports.UserRole = void 0;
var UserRole;
(function (UserRole) {
    UserRole["SITE_INCHARGE"] = "SITE_INCHARGE";
    UserRole["STORE_INCHARGE"] = "STORE_INCHARGE";
    UserRole["PROJECT_MANAGER"] = "PROJECT_MANAGER";
    UserRole["EXECUTIVE"] = "EXECUTIVE";
    UserRole["COORDINATOR"] = "COORDINATOR";
    UserRole["CHAIRMAN"] = "CHAIRMAN";
})(UserRole || (exports.UserRole = UserRole = {}));
var MaterialRequestStatus;
(function (MaterialRequestStatus) {
    MaterialRequestStatus["PENDING_STORE"] = "PENDING_STORE";
    MaterialRequestStatus["ALLOCATED"] = "ALLOCATED";
    MaterialRequestStatus["FORWARDED_TO_PM"] = "FORWARDED_TO_PM";
    MaterialRequestStatus["BRANCH_TRANSFER_REQUESTED"] = "BRANCH_TRANSFER_REQUESTED";
    MaterialRequestStatus["PENDING_HO"] = "PENDING_HO";
    MaterialRequestStatus["PENDING_EXECUTIVE_DECISION"] = "PENDING_EXECUTIVE_DECISION";
    MaterialRequestStatus["EXECUTIVE_DECISION_PO"] = "EXECUTIVE_DECISION_PO";
    MaterialRequestStatus["EXECUTIVE_DECISION_BRANCH_TRANSFER"] = "EXECUTIVE_DECISION_BRANCH_TRANSFER";
    MaterialRequestStatus["PM_APPROVED"] = "PM_APPROVED";
    MaterialRequestStatus["PURCHASE_REQUESTED"] = "PURCHASE_REQUESTED";
    MaterialRequestStatus["RFQ_OPEN"] = "RFQ_OPEN";
    MaterialRequestStatus["QUOTED"] = "QUOTED";
    MaterialRequestStatus["VENDOR_SELECTED"] = "VENDOR_SELECTED";
    MaterialRequestStatus["PO_CREATED"] = "PO_CREATED";
    MaterialRequestStatus["COORDINATOR_VERIFIED"] = "COORDINATOR_VERIFIED";
    MaterialRequestStatus["CHAIRMAN_APPROVED"] = "CHAIRMAN_APPROVED";
    MaterialRequestStatus["MATERIAL_RECEIVED"] = "MATERIAL_RECEIVED";
    MaterialRequestStatus["ISSUED"] = "ISSUED";
    MaterialRequestStatus["COMPLETED"] = "COMPLETED";
    MaterialRequestStatus["REJECTED"] = "REJECTED";
    MaterialRequestStatus["CANCELLED"] = "CANCELLED";
    MaterialRequestStatus["CLOSED"] = "CLOSED";
})(MaterialRequestStatus || (exports.MaterialRequestStatus = MaterialRequestStatus = {}));
var StockMovementType;
(function (StockMovementType) {
    StockMovementType["ALLOCATION"] = "ALLOCATION";
    StockMovementType["INCOMING"] = "INCOMING";
    StockMovementType["ADJUSTMENT"] = "ADJUSTMENT";
})(StockMovementType || (exports.StockMovementType = StockMovementType = {}));
var PurchaseOrderStatus;
(function (PurchaseOrderStatus) {
    PurchaseOrderStatus["DRAFT"] = "DRAFT";
    PurchaseOrderStatus["PM_PENDING"] = "PM_PENDING";
    PurchaseOrderStatus["COORDINATOR_PENDING"] = "COORDINATOR_PENDING";
    PurchaseOrderStatus["COORDINATOR_VERIFIED"] = "COORDINATOR_VERIFIED";
    PurchaseOrderStatus["CHAIRMAN_PENDING"] = "CHAIRMAN_PENDING";
    PurchaseOrderStatus["APPROVED"] = "APPROVED";
    PurchaseOrderStatus["REJECTED"] = "REJECTED";
})(PurchaseOrderStatus || (exports.PurchaseOrderStatus = PurchaseOrderStatus = {}));
var WorkOrderStatus;
(function (WorkOrderStatus) {
    WorkOrderStatus["DRAFT"] = "DRAFT";
    WorkOrderStatus["PM_PENDING"] = "PM_PENDING";
    WorkOrderStatus["EXECUTIVE_PENDING"] = "EXECUTIVE_PENDING";
    WorkOrderStatus["COORDINATOR_PENDING"] = "COORDINATOR_PENDING";
    WorkOrderStatus["CHAIRMAN_PENDING"] = "CHAIRMAN_PENDING";
    WorkOrderStatus["PENDING_ACCEPTANCE"] = "PENDING_ACCEPTANCE";
    WorkOrderStatus["ACCEPTED"] = "ACCEPTED";
    WorkOrderStatus["IN_PROGRESS"] = "IN_PROGRESS";
    WorkOrderStatus["CLOSED"] = "CLOSED";
    WorkOrderStatus["REJECTED"] = "REJECTED";
})(WorkOrderStatus || (exports.WorkOrderStatus = WorkOrderStatus = {}));
var BranchTransferStatus;
(function (BranchTransferStatus) {
    BranchTransferStatus["REQUESTED"] = "REQUESTED";
    BranchTransferStatus["PM_APPROVED"] = "PM_APPROVED";
    BranchTransferStatus["COORDINATOR_DECIDED"] = "COORDINATOR_DECIDED";
    BranchTransferStatus["TRANSFERRED"] = "TRANSFERRED";
    BranchTransferStatus["REJECTED"] = "REJECTED";
    BranchTransferStatus["RAISE_PO_INSTEAD"] = "RAISE_PO_INSTEAD";
})(BranchTransferStatus || (exports.BranchTransferStatus = BranchTransferStatus = {}));
var WorkOrderMilestoneStatus;
(function (WorkOrderMilestoneStatus) {
    WorkOrderMilestoneStatus["PENDING"] = "PENDING";
    WorkOrderMilestoneStatus["RUNNING"] = "RUNNING";
    WorkOrderMilestoneStatus["COMPLETED"] = "COMPLETED";
})(WorkOrderMilestoneStatus || (exports.WorkOrderMilestoneStatus = WorkOrderMilestoneStatus = {}));
var ProjectStatus;
(function (ProjectStatus) {
    ProjectStatus["ACTIVE"] = "ACTIVE";
    ProjectStatus["ON_HOLD"] = "ON_HOLD";
    ProjectStatus["COMPLETED"] = "COMPLETED";
})(ProjectStatus || (exports.ProjectStatus = ProjectStatus = {}));
exports.PERMISSION_MATRIX = {
    [UserRole.SITE_INCHARGE]: ['VIEW_OWN_SCOPE', 'CREATE_MATERIAL_REQUEST', 'REPORT_INCIDENT'],
    [UserRole.STORE_INCHARGE]: [
        'VIEW_OWN_SCOPE',
        'CREATE_MATERIAL_REQUEST',
        'VIEW_FINANCE',
        'ALLOCATE_MATERIAL_REQUEST',
        'FORWARD_MATERIAL_REQUEST',
        'EDIT_ALLOCATION_QTY',
        'CREATE_INVENTORY_ITEM',
        'VERIFY_DELIVERY',
        'RECEIVE_MATERIAL',
        'ISSUE_MATERIAL',
        'REPORT_INCIDENT',
    ],
    [UserRole.PROJECT_MANAGER]: [
        'VIEW_OWN_SCOPE',
        'ALLOCATE_MATERIAL_REQUEST',
        'FORWARD_MATERIAL_REQUEST',
        'APPROVE_MATERIAL_REQUEST',
        'CREATE_PURCHASE_REQUEST',
        'EDIT_PROJECT_SCOPE',
        'VIEW_FINANCE',
        'TRACK_WO_PROGRESS',
        'CREATE_INVENTORY_ITEM',
        'REPORT_INCIDENT',
        'VIEW_INCIDENTS',
        'CREATE_BRANCH_TRANSFER',
    ],
    [UserRole.EXECUTIVE]: [
        'VIEW_ALL_PROJECTS',
        'APPROVE_MATERIAL_REQUEST',
        'CREATE_PURCHASE_REQUEST',
        'CREATE_RFQ',
        'SELECT_VENDOR',
        'CREATE_PO',
        'CREATE_WORK_ORDER',
        'EDIT_PROCUREMENT',
        'CREATE_VENDOR',
        'VIEW_FINANCE',
    ],
    [UserRole.COORDINATOR]: [
        'VIEW_ALL_PROJECTS',
        'VERIFY_RECORDS',
        'EDIT_COORDINATOR_RECORDS',
        'CREATE_PO',
        'CREATE_WORK_ORDER',
        'VIEW_FINANCE',
        'VIEW_AUDIT_LOGS',
        'CREATE_INVENTORY_ITEM',
        'DELETE_INVENTORY_ITEM',
        'DELETE_RECORDS',
        'MANAGE_PROJECTS',
        'MANAGE_VENDORS',
        'RECEIVE_MATERIAL',
        'VIEW_INCIDENTS',
        'RESOLVE_INCIDENT',
        'CREATE_BRANCH_TRANSFER',
        'APPROVE_MATERIAL_REQUEST',
    ],
    [UserRole.CHAIRMAN]: [
        'VIEW_ALL_PROJECTS',
        'FINAL_APPROVAL',
        'VIEW_FINANCE',
        'VIEW_USER_ANALYTICS',
    ],
};
exports.ROLE_COLORS = {
    [UserRole.SITE_INCHARGE]: { primary: '#1A4FA0', accent: '#E8F0FA' },
    [UserRole.STORE_INCHARGE]: { primary: '#1A4FA0', accent: '#E8F0FA' },
    [UserRole.PROJECT_MANAGER]: { primary: '#7C3AED', accent: '#F5F3FF' },
    [UserRole.EXECUTIVE]: { primary: '#1A4FA0', accent: '#E8F0FA' },
    [UserRole.COORDINATOR]: { primary: '#0D9488', accent: '#F0FDFA' },
    [UserRole.CHAIRMAN]: { primary: '#1A4FA0', accent: '#E8F0FA' },
};
exports.ROLE_LABELS = {
    [UserRole.SITE_INCHARGE]: 'Site Manager',
    [UserRole.STORE_INCHARGE]: 'Store Manager',
    [UserRole.PROJECT_MANAGER]: 'Project Manager',
    [UserRole.EXECUTIVE]: 'Executive',
    [UserRole.COORDINATOR]: 'Coordinator',
    [UserRole.CHAIRMAN]: 'Chairman / MD',
};
__exportStar(require("./formatters"), exports);
__exportStar(require("./dtos"), exports);
__exportStar(require("./locales"), exports);
__exportStar(require("./materialConstants"), exports);
__exportStar(require("./gstMath"), exports);
__exportStar(require("./indentRequestTypes"), exports);
