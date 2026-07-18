const mongoose = require('mongoose');

const rfqSchema = new mongoose.Schema(
  {
    rfqNumber: { type: String, required: true, unique: true },
    purchaseRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseRequest', required: true },
    vendorIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Vendor' }],
    dueDate: { type: Date },
    status: { type: String, enum: ['OPEN', 'FINALIZED'], default: 'OPEN' },
    selectedVendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor' },
    /** Required when selected vendor is not L1 (lowest quote) — set on PO creation. */
    vendorSelectionReason: { type: String, default: '' },
    /** Set when vendor is chosen on Create PO (or legacy RFQ finalize). */
    whyWeChoseThisVendor: { type: String, default: '' },
    /** Materials included in this RFQ (skip stock-covered / user-excluded). Empty = derive from shortfall. */
    procurementMaterialIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Material' }],
    /** Executive confirmed vendor RFQ replies were received — unlocks Create PO. */
    quotesObtainedAt: { type: Date },
    quotesObtainedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    finalizedAt: { type: Date },
    finalizedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('RFQ', rfqSchema);
