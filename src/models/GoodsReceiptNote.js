const mongoose = require('mongoose');

const GRN_STATUSES = ['DRAFT', 'ON_HOLD', 'PARTIALLY_RECEIVED', 'RECEIVED', 'REJECTED'];
const GRN_APPROVAL_STAGES = ['NONE', 'COORDINATOR_PENDING', 'CHAIRMAN_PENDING', 'APPROVED'];

const grnItemSchema = new mongoose.Schema(
  {
    materialId: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true },
    poLineId: { type: mongoose.Schema.Types.ObjectId },
    quantityOrdered: { type: Number, required: true },
    quantityReceived: { type: Number, default: 0 },
    orderedUnitPrice: { type: Number, default: 0 },
    invoiceUnitPrice: { type: Number, default: 0 },
    qtyVariance: { type: Number, default: 0 },
    priceVariance: { type: Number, default: 0 },
    lineStatus: { type: String, enum: ['RECEIVED', 'PARTIAL', 'REJECTED'], default: 'RECEIVED' },
  },
  { _id: true }
);

const grnAttachmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    fileType: { type: String, default: 'application/octet-stream' },
    category: { type: String, enum: ['INVOICE', 'CHALLAN', 'PHOTO'], default: 'PHOTO' },
  },
  { _id: true }
);

const grnSchema = new mongoose.Schema(
  {
    grnNumber: { type: String, required: true },
    purchaseOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder', required: true },
    siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true },
    items: { type: [grnItemSchema], default: [] },
    receivedQuantity: { type: Number, default: 0 },
    status: { type: String, enum: GRN_STATUSES, default: 'RECEIVED' },
    approvalStage: { type: String, enum: GRN_APPROVAL_STAGES, default: 'NONE' },
    requiresChairmanApproval: { type: Boolean, default: false },
    holdReasons: { type: [String], default: [] },
    coordinatorApprovedAt: { type: Date },
    coordinatorApprovedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    chairmanApprovedAt: { type: Date },
    chairmanApprovedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    approvedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    receiveType: { type: String, enum: ['PARTIAL', 'FULL'], default: 'FULL' },
    isPartialGrn: { type: Boolean, default: false },
    varianceDetails: { type: mongoose.Schema.Types.Mixed, default: null },
    invoiceNo: { type: String, default: '' },
    invoiceDate: { type: Date },
    invoiceValue: { type: Number, default: 0 },
    challanNo: { type: String, default: '' },
    vehicleNo: { type: String, default: '' },
    ewayBillNumber: { type: String, default: '' },
    driverName: { type: String, default: '' },
    deliveryDate: { type: Date },
    note: { type: String, default: '' },
    attachments: { type: [grnAttachmentSchema], default: [] },
    receivedAt: { type: Date, default: Date.now },
    receivedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

grnSchema.index({ purchaseOrderId: 1, grnNumber: 1 }, { unique: true });

module.exports = mongoose.model('GoodsReceiptNote', grnSchema);
module.exports.GRN_STATUSES = GRN_STATUSES;
module.exports.GRN_APPROVAL_STAGES = GRN_APPROVAL_STAGES;
