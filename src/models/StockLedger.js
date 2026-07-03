const mongoose = require('mongoose');

const stockLedgerSchema = new mongoose.Schema({
  siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
  materialId: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true },
  quantityOnHand: { type: Number, default: 0 },
  quantityReserved: { type: Number, default: 0 },
  lowStockThreshold: { type: Number, default: 10 },
  lastMovementAt: { type: Date, default: Date.now },
});

stockLedgerSchema.index({ siteId: 1, materialId: 1 }, { unique: true });

module.exports = mongoose.model('StockLedger', stockLedgerSchema);
