const mongoose = require('mongoose');

const siteSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    name: { type: String, required: true },
    chainageLabel: { type: String, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Site', siteSchema);
