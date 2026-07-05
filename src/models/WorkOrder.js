const mongoose = require('mongoose');

const WO_STATUSES = [
  'DRAFT',
  'PM_PENDING',
  'EXECUTIVE_PENDING',
  'COORDINATOR_PENDING',
  'CHAIRMAN_PENDING',
  'PENDING_ACCEPTANCE',
  'ACCEPTED',
  'IN_PROGRESS',
  'CLOSED',
  'REJECTED',
];

const MILESTONE_STATUSES = ['PENDING', 'RUNNING', 'COMPLETED'];
const CERT_STATUSES = ['PENDING_PM', 'PM_VERIFIED', 'REJECTED'];

const DEFAULT_MILESTONES = [
  { name: 'Survey', status: 'PENDING', order: 1 },
  { name: 'Installation', status: 'PENDING', order: 2 },
  { name: 'Testing', status: 'PENDING', order: 3 },
  { name: 'Commissioning', status: 'PENDING', order: 4 },
];

const milestoneSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    status: { type: String, enum: MILESTONE_STATUSES, default: 'PENDING' },
    order: { type: Number, default: 0 },
  },
  { _id: true }
);

const materialIssueSchema = new mongoose.Schema(
  {
    materialId: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true },
    materialName: { type: String, default: '' },
    materialUnit: { type: String, default: '' },
    quantity: { type: Number, required: true },
    issuedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

const certificationSchema = new mongoose.Schema(
  {
    quantity: { type: Number, required: true },
    note: { type: String, default: '' },
    evidenceNote: { type: String, default: '' },
    certifiedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: CERT_STATUSES, default: 'PENDING_PM' },
    pmVerifiedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    pmNote: { type: String, default: '' },
  },
  { timestamps: true }
);

const workOrderSchema = new mongoose.Schema(
  {
    woNumber: { type: String, required: true, unique: true },
    purchaseOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PurchaseOrder',
      required: true,
      unique: true,
    },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site' },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
    scope: { type: String, required: true },
    totalQuantity: { type: Number, required: true },
    quantityUnit: { type: String, default: 'Units' },
    completedQuantity: { type: Number, default: 0 },
    progressPercent: { type: Number, default: 0 },
    contractValue: { type: Number, required: true },
    status: { type: String, enum: WO_STATUSES, default: 'PM_PENDING' },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    pmApprovedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    pmApprovedAt: { type: Date },
    executiveReviewedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    executiveReviewedAt: { type: Date },
    coordinatorVerifiedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    coordinatorVerifiedAt: { type: Date },
    chairmanApprovedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    chairmanApprovedAt: { type: Date },
    milestones: { type: [milestoneSchema], default: () => DEFAULT_MILESTONES.map((m) => ({ ...m })) },
    materialIssues: { type: [materialIssueSchema], default: [] },
    certifications: { type: [certificationSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('WorkOrder', workOrderSchema);
module.exports.WO_STATUSES = WO_STATUSES;
module.exports.DEFAULT_MILESTONES = DEFAULT_MILESTONES;
