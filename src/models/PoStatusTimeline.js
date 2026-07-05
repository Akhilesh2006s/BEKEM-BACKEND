const mongoose = require('mongoose');

const PO_TRACKING_STAGES = [
  'created',
  'vendor_assigned',
  'sent',
  'dispatch',
  'transit',
  'received',
];

const poStatusTimelineSchema = new mongoose.Schema(
  {
    purchaseOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PurchaseOrder',
      required: true,
      index: true,
    },
    stage: { type: String, enum: PO_TRACKING_STAGES, required: true },
    reachedAt: { type: Date, default: Date.now },
    note: { type: String, default: '' },
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

poStatusTimelineSchema.index({ purchaseOrderId: 1, stage: 1 }, { unique: true });

module.exports = mongoose.model('PoStatusTimeline', poStatusTimelineSchema);
module.exports.PO_TRACKING_STAGES = PO_TRACKING_STAGES;
