const mongoose = require('mongoose');

const deliveryAlertSchema = new mongoose.Schema(
  {
    purchaseOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PurchaseOrder',
      required: true,
      index: true,
    },
    expectedDeliveryDate: { type: Date, required: true },
    alertCreatedAt: { type: Date, default: Date.now },
    resolvedAt: { type: Date, default: null },
    notificationSentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

deliveryAlertSchema.index(
  { purchaseOrderId: 1, resolvedAt: 1 },
  { partialFilterExpression: { resolvedAt: null } }
);

module.exports = mongoose.model('DeliveryAlert', deliveryAlertSchema);
