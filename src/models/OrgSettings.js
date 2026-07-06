const mongoose = require('mongoose');

const expenseCategorySchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    requiresPo: { type: Boolean, default: true },
    pmMaxInr: { type: Number, default: 5000 },
    coordinatorMaxInr: { type: Number, default: 10000 },
    description: { type: String, default: '' },
  },
  { _id: false }
);

const orgSettingsSchema = new mongoose.Schema(
  {
    singleton: { type: String, default: 'global', unique: true, immutable: true },
    poPmMaxInr: { type: Number, default: 5000 },
    poCoordinatorMaxInr: { type: Number, default: 10000 },
    mrPmDailyMaxInr: { type: Number, default: 5000 },
    timezone: { type: String, default: 'Asia/Kolkata' },
    expenseCategories: { type: [expenseCategorySchema], default: [] },
    updatedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('OrgSettings', orgSettingsSchema);
