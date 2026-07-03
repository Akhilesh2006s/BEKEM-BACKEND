const mongoose = require('mongoose');

const tallySyncSchema = new mongoose.Schema(
  {
    purchaseOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder' },
    grnId: { type: mongoose.Schema.Types.ObjectId, ref: 'GoodsReceiptNote' },
    syncedAt: { type: Date },
    tallyVoucherId: { type: String, default: '' },
    status: { type: String, default: 'PENDING' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('TallySyncRecord', tallySyncSchema);
