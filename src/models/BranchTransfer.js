const mongoose = require('mongoose');

const TRANSFER_STATUSES = [
  'PENDING_DESTINATION_PM',
  'PENDING_SOURCE_FINAL',
  'APPROVED',
  'DISPATCHED',
  'RECEIVED',
  'REJECTED',
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
    items: { type: [transferItemSchema], required: true },
    status: { type: String, enum: TRANSFER_STATUSES, default: 'REQUESTED' },
    note: { type: String, default: '' },
    requestedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    destinationApprovedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    sourceFinalApprovedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectionNote: { type: String, default: '' },
    approvedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    dispatchedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    receivedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('BranchTransfer', branchTransferSchema);
module.exports.TRANSFER_STATUSES = TRANSFER_STATUSES;
