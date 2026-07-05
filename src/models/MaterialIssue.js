const mongoose = require('mongoose');

const issueItemSchema = new mongoose.Schema(
  {
    materialId: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true },
    quantity: { type: Number, required: true },
  },
  { _id: true }
);

const attachmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    fileType: { type: String, default: 'application/octet-stream' },
    category: { type: String, default: 'ISSUE_SLIP' },
  },
  { _id: false }
);

const ISSUE_REASONS = ['emergency', 'already_approved', 'urgent_work', 'repeat_issue', 'other'];

const materialIssueSchema = new mongoose.Schema(
  {
    issueNumber: { type: String, required: true, unique: true },
    materialRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'MaterialRequest', required: true },
    siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true },
    items: { type: [issueItemSchema], required: true },
    issuedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['ISSUED'], default: 'ISSUED' },
    issueReason: { type: String, enum: ISSUE_REASONS },
    issueReasonOtherText: { type: String, default: '' },
    note: { type: String, default: '' },
    attachments: { type: [attachmentSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('MaterialIssue', materialIssueSchema);
module.exports.ISSUE_REASONS = ISSUE_REASONS;
