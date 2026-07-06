const express = require('express');
const { body, param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const rfqService = require('../services/rfqService');
const { generateRfqPdf } = require('../services/pdfService');

const router = express.Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const data = await rfqService.listRfqs(req.user);
    res.json({ data });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
    next(err);
  }
});

router.get('/by-pr/:purchaseRequestId', param('purchaseRequestId').isMongoId(), validate, async (req, res, next) => {
  try {
    const data = await rfqService.getRfqByPurchaseRequest(req.params.purchaseRequestId, req.user);
    res.json({ data });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
    next(err);
  }
});

router.get('/:id/comparison', param('id').isMongoId(), validate, async (req, res, next) => {
  try {
    const data = await rfqService.getRfqComparison(req.params.id, req.user);
    res.json({ data });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
    next(err);
  }
});

router.get('/:id', param('id').isMongoId(), validate, async (req, res, next) => {
  try {
    const data = await rfqService.getRfqDetail(req.params.id, req.user);
    res.json({ data });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
    next(err);
  }
});

router.put(
  '/:id/quotations',
  param('id').isMongoId(),
  [
    body('quotations').isArray({ min: 1 }),
    body('quotations.*.vendorId').isMongoId(),
    body('quotations.*.rate').isFloat({ min: 0 }),
    body('quotations.*.gstPercent').optional().isFloat({ min: 0 }),
    body('quotations.*.paymentTerms').optional().isString(),
    body('quotations.*.deliveryTerms').optional().isString(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const data = await rfqService.saveRfqQuotations(req.params.id, req.user, req.body);
      res.json({ data });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
      next(err);
    }
  }
);

router.post(
  '/:id/quotations',
  param('id').isMongoId(),
  [
    body('vendorId').isMongoId(),
    body('rate').isFloat({ min: 0 }),
    body('gstPercent').optional().isFloat({ min: 0 }),
    body('paymentTerms').optional().isString(),
    body('deliveryTerms').optional().isString(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const data = await rfqService.addRfqVendorQuotation(req.params.id, req.user, req.body);
      res.status(201).json({ data });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
      next(err);
    }
  }
);

router.post(
  '/:id/finalize',
  param('id').isMongoId(),
  [
    body('selectedVendorId').isMongoId(),
    body('whyWeChoseThisVendor').trim().notEmpty(),
    body('vendorSelectionReason').optional().isString(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const data = await rfqService.finalizeRfq(req.params.id, req.user, req.body);
      res.json({ data });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
      next(err);
    }
  }
);

router.get('/:id/pdf', param('id').isMongoId(), validate, async (req, res, next) => {
  try {
    const detail = await rfqService.getRfqDetail(req.params.id, req.user);
    generateRfqPdf(detail)(res);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
    next(err);
  }
});

router.get('/:id/share/whatsapp', param('id').isMongoId(), validate, async (req, res, next) => {
  try {
    const detail = await rfqService.getRfqDetail(req.params.id, req.user);
    const text = rfqService.buildRfqShareText(detail);
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    res.json({ data: { url, text } });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
    next(err);
  }
});

router.post(
  '/:id/email',
  param('id').isMongoId(),
  [body('vendorId').optional().isMongoId(), body('vendorEmail').optional().isEmail()],
  validate,
  async (req, res, next) => {
    try {
      const result = await rfqService.sendRfqEmail(req.params.id, req.user, req.body);
      res.json({ data: result });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
      next(err);
    }
  }
);

module.exports = router;
