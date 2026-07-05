const mongoose = require('mongoose');

const idempotencyRecordSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    scope: { type: String, required: true },
    statusCode: { type: Number, default: 200 },
    responseBody: { type: mongoose.Schema.Types.Mixed },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

idempotencyRecordSchema.index({ key: 1, userId: 1, scope: 1 }, { unique: true });
idempotencyRecordSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('IdempotencyRecord', idempotencyRecordSchema);
