const mongoose = require('mongoose');

const STATUSES = [
  'PENDING_STORE',
  'ALLOCATED',
  'FORWARDED_TO_PM',
  'PENDING_HO',
  'PM_APPROVED',
  'PURCHASE_REQUESTED',
  'RFQ_OPEN',
  'QUOTED',
  'VENDOR_SELECTED',
  'PO_CREATED',
  'COORDINATOR_VERIFIED',
  'CHAIRMAN_APPROVED',
  'MATERIAL_RECEIVED',
  'ISSUED',
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
  'CLOSED',
];

const lineItemSchema = new mongoose.Schema(
  {
    materialId: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true },
    quantityRequested: { type: Number, required: true },
    /** Unit requested on indent (may differ from catalog default). */
    unit: { type: String, default: '' },
    quantityAllocated: { type: Number, default: 0 },
    quantityIssued: { type: Number, default: 0 },
  },
  { _id: true }
);

const materialRequestSchema = new mongoose.Schema(
  {
    indentNumber: { type: String, required: true, unique: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true },
    items: { type: [lineItemSchema], default: [] },
    // Legacy single-item fields (backward compatibility)
    materialId: { type: mongoose.Schema.Types.ObjectId, ref: 'Material' },
    quantityRequested: { type: Number },
    quantityAllocated: { type: Number, default: 0 },
    purpose: { type: String, default: '' },
    requiredByDate: { type: Date },
    requestedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: STATUSES, default: 'PENDING_STORE' },
    pendingWithRole: { type: String, default: 'STORE_INCHARGE' },
    /** Estimated indent value (INR) for PM daily cap tracking. */
    estimatedValue: { type: Number, default: 0 },
    escalatedToHo: { type: Boolean, default: false },
    escalatedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model('MaterialRequest', materialRequestSchema);
module.exports.STATUSES = STATUSES;
