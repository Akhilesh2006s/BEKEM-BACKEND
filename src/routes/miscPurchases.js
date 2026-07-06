const express = require('express');
const { body, param, query } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const {
  listMiscPurchases,
  createMiscPurchase,
  approveMiscPurchase,
  rejectMiscPurchase,
} = require('../services/miscPurchaseService');

const router = express.Router();
router.use(authenticate);

router.get(
  '/',
  [query('tab').optional().isIn(['pending', 'approved', 'completed', 'all'])],
  validate,
  async (req, res, next) => {
    try {
      const data = await listMiscPurchases(req.user, {
        tab: req.query.tab || 'all',
        expenseCategoryKey: req.query.expenseCategoryKey,
        projectId: req.query.projectId,
      });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/',
  [
    body('expenseCategoryKey').trim().notEmpty(),
    body('description').trim().notEmpty(),
    body('amount').isFloat({ gt: 0 }),
    body('projectId').isMongoId(),
    body('siteId').optional({ nullable: true }).isMongoId(),
    body('vendorName').optional().trim(),
    body('purchaseOrderId').optional({ nullable: true }).isMongoId(),
    body('transactionDate').optional().isISO8601(),
    body('note').optional().trim(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const data = await createMiscPurchase(req.user, req.body);
      res.status(201).json({ data });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
      }
      next(err);
    }
  }
);

router.post(
  '/:id/approve',
  param('id').isMongoId(),
  body('note').optional().trim(),
  validate,
  async (req, res, next) => {
    try {
      const data = await approveMiscPurchase(req.user, req.params.id, req.body.note);
      res.json({ data });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
      }
      next(err);
    }
  }
);

router.post(
  '/:id/reject',
  param('id').isMongoId(),
  body('reason').optional().trim(),
  validate,
  async (req, res, next) => {
    try {
      const data = await rejectMiscPurchase(req.user, req.params.id, req.body.reason);
      res.json({ data });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
      }
      next(err);
    }
  }
);

module.exports = router;
