const mongoose = require('mongoose');
const { APP_LOCALE_CODES } = require('@afios/shared');

const ROLES = [
  'SITE_INCHARGE',
  'STORE_INCHARGE',
  'PROJECT_MANAGER',
  'EXECUTIVE',
  'COORDINATOR',
  'CHAIRMAN',
];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ROLES, required: true },
    assignedProjectIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Project' }],
    assignedSiteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', default: null },
    avatarColor: { type: String, default: '#2563EB' },
    refreshToken: { type: String, default: null },
    locale: { type: String, enum: APP_LOCALE_CODES, default: 'en' },
    notificationPrefs: {
      inApp: { type: Boolean, default: true },
      emailDigest: { type: Boolean, default: false },
      sms: { type: Boolean, default: false },
    },
    /** Indent categories this executive receives (whole-indent routing). */
    assignedIndentCategoryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'IndentCategory' }],
    /** System administrator — only role that may manage users. */
    isSystemAdmin: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
