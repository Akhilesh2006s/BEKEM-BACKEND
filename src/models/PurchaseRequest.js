const mongoose = require('mongoose');

const purchaseRequestSchema = new mongoose.Schema(
  {
    prNumber: { type: String, required: true, unique: true },
    materialRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'MaterialRequest' },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    status: { type: String, default: 'DRAFT' },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amountEstimate: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PurchaseRequest', purchaseRequestSchema);
