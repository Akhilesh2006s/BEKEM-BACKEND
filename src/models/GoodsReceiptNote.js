const mongoose = require('mongoose');

const GRN_STATUSES = ['DRAFT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'REJECTED'];

const grnItemSchema = new mongoose.Schema(
  {
    materialId: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true },
    quantityOrdered: { type: Number, required: true },
    quantityReceived: { type: Number, default: 0 },
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
    grnNumber: { type: String, required: true, unique: true },
    purchaseOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder', required: true },
    siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true },
    items: { type: [grnItemSchema], default: [] },
    receivedQuantity: { type: Number, default: 0 },
    status: { type: String, enum: GRN_STATUSES, default: 'RECEIVED' },
    receiveType: { type: String, enum: ['PARTIAL', 'FULL'], default: 'FULL' },
    invoiceNo: { type: String, default: '' },
    challanNo: { type: String, default: '' },
    vehicleNo: { type: String, default: '' },
    driverName: { type: String, default: '' },
    deliveryDate: { type: Date },
    note: { type: String, default: '' },
    attachments: { type: [grnAttachmentSchema], default: [] },
    receivedAt: { type: Date, default: Date.now },
    receivedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('GoodsReceiptNote', grnSchema);
module.exports.GRN_STATUSES = GRN_STATUSES;
