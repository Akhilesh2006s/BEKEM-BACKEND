const mongoose = require('mongoose');

const TRANSFER_STATUSES = [
  'REQUESTED',
  'EXECUTIVE_APPROVED',
  'DISPATCHED',
  'PARTIALLY_RECEIVED',
  'TRANSFERRED',
  'REJECTED',
  'RAISE_PO_INSTEAD',
  'PM_APPROVED',
  'COORDINATOR_DECIDED',
  // legacy (read/migrate only)
  'PENDING_DESTINATION_PM',
  'PENDING_SOURCE_FINAL',
  'APPROVED',
  'RECEIVED',
  'CANCELLED',
];

const transferItemSchema = new mongoose.Schema(
  {
    materialId: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true },
    quantity: { type: Number, required: true },
    quantityReceived: { type: Number, default: 0 },
  },
  { _id: true }
);

const branchTransferSchema = new mongoose.Schema(
  {
    transferNumber: { type: String, required: true, unique: true },
    fromProjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    fromSiteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site' },
    toProjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    toSiteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site' },
    materialRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'MaterialRequest' },
    items: { type: [transferItemSchema], required: true },
    status: { type: String, enum: TRANSFER_STATUSES, default: 'REQUESTED' },
    note: { type: String, default: '' },
    coordinatorDecision: { type: String, enum: ['transfer', 'raise_po_instead', null], default: null },
    requestedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    /** Executive (or legacy coordinator) who approved the transfer request. */
    executiveApprovedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    executiveApprovedAt: { type: Date },
    pmApprovedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    pmApprovedAt: { type: Date },
    coordinatorDecidedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    coordinatorDecidedAt: { type: Date },
    /** Source PM dispatch — challan / ETA before material leaves. */
    challanNo: { type: String, default: '' },
    expectedArrivalDate: { type: Date },
    dispatchNote: { type: String, default: '' },
    dispatchedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    dispatchedAt: { type: Date },
    executedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    transferredAt: { type: Date },
    rejectedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectionNote: { type: String, default: '' },
    /** GRNs created from destination receipts (partial → multiple). */
    receiptGrnIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'GoodsReceiptNote' }],
    // legacy fields retained for migrated rows
    destinationApprovedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    sourceFinalApprovedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    receivedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('BranchTransfer', branchTransferSchema);
module.exports.TRANSFER_STATUSES = TRANSFER_STATUSES;
