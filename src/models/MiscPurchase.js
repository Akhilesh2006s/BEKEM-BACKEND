const mongoose = require('mongoose');

const MISC_PURCHASE_STATUSES = [
  'DRAFT',
  'PM_PENDING',
  'COORDINATOR_PENDING',
  'CHAIRMAN_PENDING',
  'APPROVED',
  'REJECTED',
];

const miscPurchaseSchema = new mongoose.Schema(
  {
    referenceNumber: { type: String, required: true, unique: true },
    expenseCategoryKey: { type: String, required: true },
    description: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site' },
    vendorName: { type: String, default: '' },
    purchaseOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder' },
    requiresPo: { type: Boolean, default: false },
    status: { type: String, enum: MISC_PURCHASE_STATUSES, default: 'DRAFT' },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    approvedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    rejectionReason: { type: String, default: '' },
    transactionDate: { type: Date, default: Date.now },
    note: { type: String, default: '' },
  },
  { timestamps: true }
);

miscPurchaseSchema.index({ projectId: 1, transactionDate: -1 });
miscPurchaseSchema.index({ expenseCategoryKey: 1, status: 1 });

module.exports = mongoose.model('MiscPurchase', miscPurchaseSchema);
module.exports.MISC_PURCHASE_STATUSES = MISC_PURCHASE_STATUSES;
