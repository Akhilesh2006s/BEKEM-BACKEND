const mongoose = require('mongoose');

const approvalDelegationSchema = new mongoose.Schema(
  {
    principalUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    delegateUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    scope: { type: String, enum: ['PO_FINAL', 'MR_PM'], required: true },
    projectIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Project' }],
    validFrom: { type: Date, default: Date.now },
    validTo: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

approvalDelegationSchema.index({ delegateUserId: 1, scope: 1, isActive: 1 });
approvalDelegationSchema.index({ principalUserId: 1, scope: 1, isActive: 1 });

module.exports = mongoose.model('ApprovalDelegation', approvalDelegationSchema);
