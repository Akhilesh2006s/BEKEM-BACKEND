const mongoose = require('mongoose');

const rfqSchema = new mongoose.Schema(
  {
    rfqNumber: { type: String, required: true, unique: true },
    purchaseRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseRequest', required: true },
    vendorIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Vendor' }],
    dueDate: { type: Date },
    status: { type: String, default: 'OPEN' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('RFQ', rfqSchema);
