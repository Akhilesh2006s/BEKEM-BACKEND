const mongoose = require('mongoose');

const STATUSES = [
  'PENDING_STORE',
  'ALLOCATED',
  'FORWARDED_TO_PM',
  'BRANCH_TRANSFER_REQUESTED',
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
  'MATERIAL_RECEIVED',
  'ISSUED',
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
  'CLOSED',
  'HO_PENDING_COORDINATOR',
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
    /** Free-text name entered at indent creation (site manager flow). */
    requestedByName: { type: String, default: '' },
    requiredByDate: { type: Date },
    requestedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: STATUSES, default: 'PENDING_STORE' },
    pendingWithRole: { type: String, default: 'STORE_INCHARGE' },
    /** Estimated indent value (INR) for PM daily cap tracking. */
    estimatedValue: { type: Number, default: 0 },
    escalatedToHo: { type: Boolean, default: false },
    escalatedAt: { type: Date },
    pmForwardRemark: { type: String, default: '' },
    /** Store confirmed stock is available before PM approval (no direct issue). */
    storeStockVerified: { type: Boolean, default: false },
    executiveProcurementMethod: {
      type: String,
      enum: ['PURCHASE_ORDER', 'BRANCH_TRANSFER', null],
      default: null,
    },
    executiveDecisionRemark: { type: String, default: '' },
    executiveDecidedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    executiveDecidedAt: { type: Date },
    coordinatorProcurementMethod: {
      type: String,
      enum: ['PURCHASE_ORDER', 'BRANCH_TRANSFER', null],
      default: null,
    },
    coordinatorProcurementRemark: { type: String, default: '' },
    coordinatorProcurementDecidedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    coordinatorProcurementDecidedAt: { type: Date },
    /** SITE = site-raised indent; EXECUTIVE = HO-only indent (Coordinator-generated; hidden from site/store/PM). */
    origin: { type: String, enum: ['SITE', 'EXECUTIVE'], default: 'SITE' },
    /** BELOW_5000 = capped petty indent with visible pricing; ABOVE_5000 = standard indent. */
    indentRequestType: { type: String, enum: ['BELOW_5000', 'ABOVE_5000'], default: 'ABOVE_5000' },
    /** Whole-indent category — routes executive notifications and visibility. */
    indentCategoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'IndentCategory' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('MaterialRequest', materialRequestSchema);
module.exports.STATUSES = STATUSES;
