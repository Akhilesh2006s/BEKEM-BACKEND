const mongoose = require('mongoose');

const materialSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    unit: { type: String, required: true },
    grade: { type: String, default: '' },
    category: { type: String, default: 'General' },
    hsnCode: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Material', materialSchema);
