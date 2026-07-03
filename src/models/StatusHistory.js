const mongoose = require('mongoose');

const statusHistorySchema = new mongoose.Schema({
  entityType: { type: String, required: true },
  entityId: { type: mongoose.Schema.Types.ObjectId, required: true },
  fromStatus: { type: String, default: null },
  toStatus: { type: String, required: true },
  actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  note: { type: String, default: '' },
  timestamp: { type: Date, default: Date.now },
});

statusHistorySchema.index({ entityType: 1, entityId: 1, timestamp: -1 });

module.exports = mongoose.model('StatusHistory', statusHistorySchema);
