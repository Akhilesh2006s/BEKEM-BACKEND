const mongoose = require('mongoose');

const PAYMENT_STATUSES = ['PENDING', 'PARTIAL', 'PAID', 'OVERDUE'];
const INVOICE_STATUSES = ['BILL_RECEIVED', 'VERIFIED', 'PAID'];
const TALLY_SYNC_STATUSES = ['PENDING', 'SYNCED', 'FAILED'];

const paymentBillSchema = new mongoose.Schema(
  {
    billNumber: { type: String, required: true, unique: true },
    purchaseOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder' },
    grnId: { type: mongoose.Schema.Types.ObjectId, ref: 'GoodsReceiptNote' },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor' },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
    invoiceNumber: { type: String, default: '' },
    invoiceDate: { type: Date },
    invoiceValue: { type: Number, default: 0 },
    billReceivedDate: { type: Date },
    dueDate: { type: Date },
    paidDate: { type: Date },
    paidAmount: { type: Number, default: 0 },
    outstandingAmount: { type: Number, default: 0 },
    paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: 'PENDING' },
    invoiceStatus: { type: String, enum: INVOICE_STATUSES, default: 'BILL_RECEIVED' },
    tallySyncStatus: { type: String, enum: TALLY_SYNC_STATUSES, default: 'PENDING' },
    tallyVoucherId: { type: String, default: '' },
    paymentRemark: { type: String, default: '' },
    processedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PaymentBill', paymentBillSchema);
module.exports.PAYMENT_STATUSES = PAYMENT_STATUSES;
module.exports.INVOICE_STATUSES = INVOICE_STATUSES;
module.exports.TALLY_SYNC_STATUSES = TALLY_SYNC_STATUSES;
