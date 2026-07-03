const mongoose = require('mongoose');

const stockMovementSchema = new mongoose.Schema({
  siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true },
  materialId: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true },
  materialRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'MaterialRequest', default: null },
  quantityDelta: { type: Number, required: true },
  type: { type: String, enum: ['ALLOCATION', 'INCOMING', 'ADJUSTMENT'], required: true },
  actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  timestamp: { type: Date, default: Date.now },
});

module.exports = mongoose.model('StockMovement', stockMovementSchema);
