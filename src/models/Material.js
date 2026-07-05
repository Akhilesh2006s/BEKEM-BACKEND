const mongoose = require('mongoose');

const materialSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    unit: { type: String, required: true },
    grade: { type: String, default: '' },
    category: { type: String, default: 'Consumables' },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'MaterialCategory' },
    hsnCode: { type: String, default: '' },
    /** Default GST % for PO lines (e.g. 18). */
    gstRate: { type: Number, default: 18 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Material', materialSchema);
