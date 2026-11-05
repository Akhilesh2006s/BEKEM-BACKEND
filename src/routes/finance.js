const express = require('express');
const { body, param, query } = require('express-validator');
const { PaymentBill } = require('../models');
const { authenticate } = require('../middleware/auth');
const { requireCapability } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const {
  serializePaymentBill,
  listPaymentBills,
  getFinanceSummary,
  applyPaymentToBill,
  assertCanAccessBill,
  getMonthlyTransactionReport,
} = require('../services/financeService');

const router = express.Router();
router.use(authenticate);
router.use(requireCapability('VIEW_FINANCE'));

router.get('/summary', async (req, res, next) => {
  try {
    const summary = await getFinanceSummary(req.user);
    res.json({ data: summary });
  } catch (err) {
    next(err);
  }
});

router.get(
  '/monthly-report',
  [query('year').optional().isInt({ min: 2020, max: 2100 }), query('month').optional().isInt({ min: 1, max: 12 })],
  validate,
  async (req, res, next) => {
    try {
      const data = await getMonthlyTransactionReport(
        req.user,
        req.query.year,
        req.query.month
      );
      res.json({ data });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/bills', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.paymentStatus) filter.paymentStatus = req.query.paymentStatus;
    if (req.query.tallySyncStatus) filter.tallySyncStatus = req.query.tallySyncStatus;
    if (req.query.purchaseOrderId) filter.purchaseOrderId = req.query.purchaseOrderId;
    const bills = await listPaymentBills(req.user, filter);
    res.json({ data: bills.map(serializePaymentBill) });
  } catch (err) {
    next(err);
  }
});

router.patch(
  '/bills/:id/payment',
  requireCapability('EDIT_COORDINATOR_RECORDS'),
  param('id').isMongoId(),
  body('paymentAmount').optional().isFloat({ gt: 0 }),
  body('paidAmount').optional().isFloat({ min: 0 }),
  body('paidDate').optional().isISO8601(),
  body('paymentRemark').optional().trim().isLength({ max: 500 }),
  body('tallySyncStatus').optional().isIn(['PENDING', 'SYNCED', 'FAILED']),
  body('tallyVoucherId').optional().trim(),
  body('invoiceStatus').optional().isIn(['BILL_RECEIVED', 'VERIFIED', 'PAID']),
  validate,
  async (req, res, next) => {
    try {
      if (req.body.paymentAmount == null && req.body.paidAmount == null) {
        return res.status(400).json({
          statusCode: 400,
          message: 'Provide paymentAmount (installment) or paidAmount (cumulative total)',
        });
      }

      // Retry if another payment changed the bill after it was read. The
      // version check makes each accepted installment apply to the latest total.
      for (let attempt = 0; attempt < 10; attempt++) {
        const bill = await PaymentBill.findById(req.params.id)
          .populate('vendorId', 'name code')
          .populate('projectId', 'code name');
        if (!bill) return res.status(404).json({ statusCode: 404, message: 'Bill not found' });
        assertCanAccessBill(req.user, bill);
        await applyPaymentToBill(bill, req.body);
        bill.processedByUserId = req.user._id;
        const changes = bill.getChanges().$set || {};
        const saved = await PaymentBill.findOneAndUpdate(
          { _id: bill._id, __v: bill.__v == null ? { $exists: false } : bill.__v },
          { $set: changes, $inc: { __v: 1 } },
          { new: true, runValidators: true }
        ).populate('vendorId', 'name code').populate('projectId', 'code name');
        if (saved) return res.json({ data: serializePaymentBill(saved) });
      }
      return res.status(409).json({ statusCode: 409, message: 'Bill changed during payment update; please retry' });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
      }
      next(err);
    }
  }
);

module.exports = router;
