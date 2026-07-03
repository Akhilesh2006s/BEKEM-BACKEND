const mongoose = require('mongoose');

const vendorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    code: { type: String, default: '' },
    address: { type: String, default: '' },
    gstNumber: { type: String, default: '' },
    email: { type: String, default: '' },
    contactPerson: { type: String, default: '' },
    phone: { type: String, default: '' },
    contactInfo: { type: String, default: '' },
    category: { type: String, default: '' },
    suppliedCategories: { type: [String], default: [] },
    materialIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Material' }],
    rating: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Vendor', vendorSchema);
