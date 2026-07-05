const mongoose = require('mongoose');

const projectGrnCounterSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      unique: true,
      index: true,
    },
    lastGrnNumber: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ProjectGrnCounter', projectGrnCounterSchema);
