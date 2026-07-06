const mongoose = require('mongoose');

const materialSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    unit: { type: String, required: true },
    grade: { type: String, default: '' },
    category: { type: String, default: 'Civil Materials' },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'MaterialCategory' },
    /** Required when category is Others. */
    categoryRemarks: { type: String, default: '', trim: true },
    hsnCode: { type: String, default: '' },
    /** Default GST % for PO lines (e.g. 18). */
    gstRate: { type: Number, default: 18 },
    /** Material Master reference unit price (₹) when no approved PO rate exists. */
    referenceUnitPrice: { type: Number, default: null },
    isActive: { type: Boolean, default: true },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Material', materialSchema);
