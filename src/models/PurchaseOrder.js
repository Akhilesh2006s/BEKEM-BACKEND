const mongoose = require('mongoose');

const PO_STATUSES = [
  'DRAFT',
  'PENDING_REVIEW',
  'PENDING_APPROVAL',
  'PM_PENDING',
  'COORDINATOR_PENDING',
  'COORDINATOR_VERIFIED',
  'CHAIRMAN_PENDING',
  'APPROVED',
  'REJECTED',
];

const poLineSchema = new mongoose.Schema(
  {
    description: { type: String, required: true },
    materialId: { type: mongoose.Schema.Types.ObjectId, ref: 'Material' },
    itemCode: { type: String, default: '' },
    hsnCode: { type: String, default: '' },
    quantity: { type: Number, required: true },
    rate: { type: Number, required: true },
    gstPercent: { type: Number, default: 18 },
    amount: { type: Number, required: true },
  },
  { _id: true }
);

const attachmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    fileType: { type: String, default: 'application/pdf' },
    url: { type: String, default: '' },
    uploadedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

const purchaseOrderSchema = new mongoose.Schema(
  {
    poNumber: { type: String },
    draftRef: { type: String },
    procurementRef: { type: String },
    /** Bekem company-wide PO count for the financial year (e.g. 4 → 0004). */
    poSeq: { type: Number },
    /** How many POs sent to this vendor in the FY (e.g. 1 = first PO to that vendor). */
    vendorPoSeq: { type: Number },
    financialYear: { type: String },
    purchaseRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseRequest', required: true },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
    quotationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quotation' },
    amount: { type: Number, required: true },
    paymentTerms: { type: String, default: '' },
    billingAddress: { type: String, default: '' },
    billingAddressType: {
      type: String,
      enum: ['registered_office', 'project_billing'],
      default: 'registered_office',
    },
    deliveryAddress: { type: String, default: '' },
    deliveryAddressType: {
      type: String,
      enum: ['site', 'workshop', 'global', 'other'],
      default: 'site',
    },
    deliveryAddressOtherText: { type: String, default: '' },
    expectedDeliveryDate: { type: Date },
    referenceNote: { type: String, default: '' },
    lineItems: { type: [poLineSchema], default: [] },
    attachments: { type: [attachmentSchema], default: [] },
    status: { type: String, enum: PO_STATUSES, default: 'DRAFT' },
    officialPdfGeneratedAt: { type: Date },
    sentToVendorAt: { type: Date },
    emailSentAt: { type: Date },
    emailStatus: {
      type: String,
      enum: ['pending', 'queued', 'sent', 'failed', 'skipped'],
      default: 'pending',
    },
    approvedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    finalApprovedAt: { type: Date },
    approvedAsChairmanOverride: { type: Boolean, default: false },
    overrideRemark: { type: String, maxlength: 300, default: '' },
    /** Set once post-approval notifications + email dispatch complete (idempotency guard). */
    approvalDispatchedAt: { type: Date },
    fulfillmentStatus: {
      type: String,
      enum: ['open_partial', 'closed_complete'],
      default: 'open_partial',
    },
    trackingReceivedAt: { type: Date },
  },
  { timestamps: true }
);

purchaseOrderSchema.pre('validate', function unsetEmptyPoNumber() {
  if (this.poNumber == null || this.poNumber === '') {
    this.poNumber = undefined;
  }
  if (this.draftRef == null || this.draftRef === '') {
    this.draftRef = undefined;
  }
});

// Only enforce uniqueness when official numbers are assigned (draft POs omit poNumber).
purchaseOrderSchema.index(
  { poNumber: 1 },
  {
    unique: true,
    partialFilterExpression: { poNumber: { $exists: true, $type: 'string' } },
  }
);
purchaseOrderSchema.index(
  { draftRef: 1 },
  {
    unique: true,
    partialFilterExpression: { draftRef: { $exists: true, $type: 'string' } },
  }
);

module.exports = mongoose.model('PurchaseOrder', purchaseOrderSchema);
module.exports.PO_STATUSES = PO_STATUSES;
