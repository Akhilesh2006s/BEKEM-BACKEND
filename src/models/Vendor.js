const mongoose = require('mongoose');

const vendorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    code: { type: String, default: '' },
    address: { type: String, default: '' },
    gstNumber: { type: String, default: '' },
    email: { type: String, default: '' },
    contactPerson: { type: String, default: '' },
    phone: { type: String, default: '' },
    contactInfo: { type: String, default: '' },
    category: { type: String, default: '' },
    suppliedCategories: { type: [String], default: [] },
    materialIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Material' }],
    rating: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    isMsme: { type: Boolean, default: false },
    msmeNumber: { type: String, default: null },
    msmeCertificateUrl: { type: String, default: null },
    panNumber: { type: String, default: '' },
    bankName: { type: String, default: '' },
    bankAccountNumber: { type: String, default: '' },
    ifscCode: { type: String, default: '' },
    authorizationStatus: {
      type: String,
      enum: ['PENDING', 'AUTHORIZED', 'REJECTED'],
      default: 'AUTHORIZED',
    },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    authorizedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    authorizedAt: { type: Date },
    authorizationRemark: { type: String, default: '' },
  },
  { timestamps: true }
);

vendorSchema.pre('validate', function enforceMsmeFields() {
  if (this.isMsme) {
    if (!this.msmeNumber?.trim()) {
      this.invalidate('msmeNumber', 'MSME number is required when vendor is MSME registered');
    }
    if (!this.msmeCertificateUrl?.trim()) {
      this.invalidate('msmeCertificateUrl', 'MSME certificate is required when vendor is MSME registered');
    }
  } else {
    this.msmeNumber = null;
    this.msmeCertificateUrl = null;
  }
});

module.exports = mongoose.model('Vendor', vendorSchema);
