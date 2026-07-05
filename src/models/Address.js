const mongoose = require('mongoose');

const ADDRESS_TYPES = ['registered_office', 'project_billing', 'workshop', 'global'];

const addressSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ADDRESS_TYPES, required: true },
    label: { type: String, default: '' },
    lines: { type: String, required: true },
    gstNumber: { type: String, default: '' },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Address', addressSchema);
module.exports.ADDRESS_TYPES = ADDRESS_TYPES;
