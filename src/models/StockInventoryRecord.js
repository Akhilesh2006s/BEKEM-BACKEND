const mongoose = require('mongoose');

const stockInventoryRecordSchema = new mongoose.Schema(
  {
    poSlNo: { type: Number, index: true },
    project: { type: String, default: '', index: true },
    indentNo: { type: String, default: '' },
    recordDate: { type: Date },
    supplier: { type: String, default: '', index: true },
    poNo: { type: String, default: '', index: true },
    poDate: { type: Date },
    itemCode: { type: String, default: '' },
    itemDescription: { type: String, default: '', index: true },
    qty: { type: Number, default: 0 },
    units: { type: String, default: '' },
    poQty: { type: String, default: '' },
    unitRate: { type: Number, default: 0 },
    basicTotal: { type: Number, default: 0 },
    gst: { type: Number, default: 0 },
    netTotal: { type: Number, default: 0 },
    deliveryDate: { type: Date },
    expectedDeliveryDate: { type: Date },
    delayReason: { type: String, default: '' },
    delayReasonUpdatedAt: { type: Date },
    delayReasonByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    advancePaid: { type: Number, default: 0 },
    invoiceNumber: { type: String, default: '' },
    invoiceDate: { type: Date },
    qtyReceived: { type: Number, default: 0 },
    qtyBalance: { type: Number, default: 0 },
    qtyAvailable: { type: String, default: '' },
    invoiceAmount: { type: Number, default: 0 },
    deliveryLocation: { type: String, default: '' },
    transport: { type: String, default: '' },
    materialReceived: { type: String, default: '' },
    invoiceEntry: { type: String, default: '' },
    purpose: { type: String, default: '' },
    financialYear: { type: String, default: '25-26', index: true },
    sourceSheet: { type: String, default: 'Stock Inventory' },
  },
  { timestamps: true }
);

stockInventoryRecordSchema.index({ project: 1, poNo: 1, itemDescription: 1 });

module.exports = mongoose.model('StockInventoryRecord', stockInventoryRecordSchema);
