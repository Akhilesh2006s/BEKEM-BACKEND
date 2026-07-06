const mongoose = require('mongoose');

const purchaseOrderGrnCounterSchema = new mongoose.Schema(
  {
    purchaseOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PurchaseOrder',
      required: true,
      unique: true,
      index: true,
    },
    lastGrnNumber: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PurchaseOrderGrnCounter', purchaseOrderGrnCounterSchema);
