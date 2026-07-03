const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    location: { type: String, required: true },
    status: { type: String, enum: ['ACTIVE', 'ON_HOLD', 'COMPLETED'], default: 'ACTIVE' },
    startDate: { type: Date, required: true },
    targetEndDate: { type: Date, required: true },
    budgetTotal: { type: Number, default: 0 },
    budgetSpent: { type: Number, default: 0 },
    healthScore: { type: Number, default: 100 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Project', projectSchema);
