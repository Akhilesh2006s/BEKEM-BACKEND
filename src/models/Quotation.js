const mongoose = require('mongoose');

const quotationSchema = new mongoose.Schema(
  {
    rfqId: { type: mongoose.Schema.Types.ObjectId, ref: 'RFQ', required: true },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
    /** Unit / blended rate before GST. */
    rate: { type: Number, default: 0 },
    gstPercent: { type: Number, default: 18 },
    paymentTerms: { type: String, default: '' },
    deliveryTerms: { type: String, default: '' },
    /** Optional item-level quotations for multi-item indents. */
    itemQuotes: [
      {
        materialId: { type: mongoose.Schema.Types.ObjectId, ref: 'Material' },
        rate: { type: Number, default: 0 },
        gstPercent: { type: Number, default: 18 },
        amount: { type: Number, default: 0 },
      },
    ],
    /** Optional subset assignment: vendor covers only these materials. */
    selectedMaterialIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Material' }],
    /** Final cost incl. GST (same as legacy amount). */
    amount: { type: Number, required: true },
    terms: { type: String, default: '' },
    submittedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Quotation', quotationSchema);
