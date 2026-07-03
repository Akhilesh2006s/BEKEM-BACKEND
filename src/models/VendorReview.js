const mongoose = require('mongoose');

const vendorReviewSchema = new mongoose.Schema(
  {
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
    ratedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    deliveryScore: { type: Number, min: 1, max: 5, required: true },
    qualityScore: { type: Number, min: 1, max: 5, required: true },
    note: { type: String, default: '' },
  },
  { timestamps: true }
);

vendorReviewSchema.index({ vendorId: 1, createdAt: -1 });

module.exports = mongoose.model('VendorReview', vendorReviewSchema);
