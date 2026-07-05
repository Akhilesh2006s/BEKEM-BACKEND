const express = require('express');
const { body, param } = require('express-validator');
const { PaymentBill } = require('../models');
const { authenticate } = require('../middleware/auth');
const { requireCapability } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const {
  serializePaymentBill,
  listPaymentBills,
  getFinanceSummary,
  computePaymentStatus,
} = require('../services/financeService');

const router = express.Router();
router.use(authenticate);
router.use(requireCapability('VIEW_FINANCE'));

router.get('/summary', async (req, res, next) => {
  try {
    const summary = await getFinanceSummary();
    res.json({ data: summary });
  } catch (err) {
    next(err);
  }
});

router.get('/bills', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.paymentStatus) filter.paymentStatus = req.query.paymentStatus;
    if (req.query.tallySyncStatus) filter.tallySyncStatus = req.query.tallySyncStatus;
    const bills = await listPaymentBills(filter);
    res.json({ data: bills.map(serializePaymentBill) });
  } catch (err) {
    next(err);
  }
});

router.patch(
  '/bills/:id/payment',
  requireCapability('EDIT_COORDINATOR_RECORDS'),
  param('id').isMongoId(),
  body('paidAmount').optional().isFloat({ min: 0 }),
  body('paidDate').optional().isISO8601(),
  body('paymentRemark').optional().trim().isLength({ max: 500 }),
  body('tallySyncStatus').optional().isIn(['PENDING', 'SYNCED', 'FAILED']),
  body('tallyVoucherId').optional().trim(),
  body('invoiceStatus').optional().isIn(['BILL_RECEIVED', 'VERIFIED', 'PAID']),
  validate,
  async (req, res, next) => {
    try {
      const bill = await PaymentBill.findById(req.params.id)
        .populate('vendorId', 'name code')
        .populate('projectId', 'code name');
      if (!bill) return res.status(404).json({ statusCode: 404, message: 'Bill not found' });

      if (req.body.paidAmount != null) {
        bill.paidAmount = Number(req.body.paidAmount);
        bill.outstandingAmount = Math.max(0, bill.invoiceValue - bill.paidAmount);
        if (bill.paidAmount >= bill.invoiceValue) {
          bill.paidDate = req.body.paidDate ? new Date(req.body.paidDate) : new Date();
          bill.invoiceStatus = 'PAID';
        }
      }
      if (req.body.paidDate) bill.paidDate = new Date(req.body.paidDate);
      if (req.body.paymentRemark != null) bill.paymentRemark = req.body.paymentRemark;
      if (req.body.tallySyncStatus) bill.tallySyncStatus = req.body.tallySyncStatus;
      if (req.body.tallyVoucherId != null) bill.tallyVoucherId = req.body.tallyVoucherId;
      if (req.body.invoiceStatus) bill.invoiceStatus = req.body.invoiceStatus;

      bill.paymentStatus = computePaymentStatus(bill);
      bill.processedByUserId = req.user._id;
      await bill.save();

      res.json({ data: serializePaymentBill(bill) });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
