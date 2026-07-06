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
    /** Final cost incl. GST (same as legacy amount). */
    amount: { type: Number, required: true },
    terms: { type: String, default: '' },
    submittedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Quotation', quotationSchema);
