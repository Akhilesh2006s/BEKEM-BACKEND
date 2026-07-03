const mongoose = require('mongoose');

const verifyItemSchema = new mongoose.Schema(
  {
    materialId: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true },
    quantityOrdered: { type: Number, required: true },
    quantityVerified: { type: Number, required: true },
    condition: { type: String, enum: ['OK', 'DAMAGED', 'SHORT'], default: 'OK' },
  },
  { _id: true }
);

const deliveryVerificationSchema = new mongoose.Schema(
  {
    purchaseOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PurchaseOrder',
      required: true,
      unique: true,
    },
    siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true },
    items: { type: [verifyItemSchema], default: [] },
    remarks: { type: String, default: '' },
    status: { type: String, enum: ['VERIFIED'], default: 'VERIFIED' },
    verifiedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    verifiedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('DeliveryVerification', deliveryVerificationSchema);
