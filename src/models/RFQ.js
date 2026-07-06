const mongoose = require('mongoose');

const rfqSchema = new mongoose.Schema(
  {
    rfqNumber: { type: String, required: true, unique: true },
    purchaseRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseRequest', required: true },
    vendorIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Vendor' }],
    dueDate: { type: Date },
    status: { type: String, enum: ['OPEN', 'FINALIZED'], default: 'OPEN' },
    selectedVendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor' },
    /** Required when selected vendor is not L1 (lowest quote). */
    vendorSelectionReason: { type: String, default: '' },
    /** Always required on RFQ finalization. */
    whyWeChoseThisVendor: { type: String, default: '' },
    finalizedAt: { type: Date },
    finalizedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('RFQ', rfqSchema);
