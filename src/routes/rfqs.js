const express = require('express');
const { body, param, query } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { requireCapability } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const rfqService = require('../services/rfqService');
const { generateRfqPdf } = require('../services/pdfService');

const router = express.Router();
router.use(authenticate);

router.post(
  '/wizard/preview',
  requireCapability('CREATE_RFQ'),
  [body('purchaseRequestId').isMongoId(), body('includeMaterialIds').optional().isArray()],
  validate,
  async (req, res, next) => {
    try {
      const data = await rfqService.previewRfqWizard(req.body.purchaseRequestId, req.user, {
        includeMaterialIds: req.body.includeMaterialIds,
      });
      res.json({ data });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
      next(err);
    }
  }
);

router.post(
  '/wizard/submit',
  requireCapability('CREATE_RFQ'),
  [
    body('rfqId').isMongoId(),
    body('quotations').optional().isArray({ min: 1 }),
    body('quotations.*.vendorId').optional().isMongoId(),
    body('quotations.*.rate').optional().isFloat({ min: 0 }),
    body('quotations.*.gstPercent').optional().isFloat({ min: 0 }),
    body('quotations.*.paymentTerms').optional().isString(),
    body('quotations.*.deliveryTerms').optional().isString(),
    body('quotations.*.transportation').optional().isString(),
    body('quotations.*.deliveryTime').optional().isString(),
    body('quotations.*.make').optional().isString(),
    body('quotations.*.itemRates').optional().isArray(),
    body('quotations.*.itemRates.*.materialId').optional().isMongoId(),
    body('quotations.*.itemRates.*.rate').optional().isFloat({ min: 0 }),
    body('quotations.*.itemRates.*.gstPercent').optional().isFloat({ min: 0 }),
    body('quotations.*.selectedMaterialIds').optional().isArray(),
    body('quotations.*.selectedMaterialIds.*').optional().isMongoId(),
    body('selectedVendorId').optional().isMongoId(),
    body('whyWeChoseThisVendor').optional().isString(),
    body('vendorSelectionReason').optional().isString(),
    body('dueDate').optional().isISO8601(),
    body('finalize').optional().isBoolean(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const data = await rfqService.submitRfqWizard(req.user, req.body);
      res.json({ data });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
      next(err);
    }
  }
);

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
    body('quotations.*.transportation').optional().isString(),
    body('quotations.*.deliveryTime').optional().isString(),
    body('quotations.*.make').optional().isString(),
    body('quotations.*.itemRates').optional().isArray(),
    body('quotations.*.itemRates.*.materialId').optional().isMongoId(),
    body('quotations.*.itemRates.*.rate').optional().isFloat({ min: 0 }),
    body('quotations.*.itemRates.*.gstPercent').optional().isFloat({ min: 0 }),
    body('quotations.*.selectedMaterialIds').optional().isArray(),
    body('quotations.*.selectedMaterialIds.*').optional().isMongoId(),
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
    body('transportation').optional().isString(),
    body('deliveryTime').optional().isString(),
    body('make').optional().isString(),
    body('itemRates').optional().isArray(),
    body('itemRates.*.materialId').optional().isMongoId(),
    body('itemRates.*.rate').optional().isFloat({ min: 0 }),
    body('itemRates.*.gstPercent').optional().isFloat({ min: 0 }),
    body('selectedMaterialIds').optional().isArray(),
    body('selectedMaterialIds.*').optional().isMongoId(),
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
  '/:id/quotes-obtained',
  param('id').isMongoId(),
  validate,
  async (req, res, next) => {
    try {
      const data = await rfqService.markQuotesObtained(req.params.id, req.user);
      res.json({ data });
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

router.get(
  '/:id/pdf',
  param('id').isMongoId(),
  [query('vendorId').optional().isMongoId()],
  validate,
  async (req, res, next) => {
  try {
    const detail = req.query.vendorId
      ? await rfqService.getRfqDetailForVendor(req.params.id, req.user, req.query.vendorId)
      : await rfqService.getRfqDetail(req.params.id, req.user);
    generateRfqPdf(detail)(res);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
    next(err);
  }
});

router.get(
  '/:id/share/whatsapp',
  param('id').isMongoId(),
  [query('vendorId').optional().isMongoId()],
  validate,
  async (req, res, next) => {
  try {
    const detail = req.query.vendorId
      ? await rfqService.getRfqDetailForVendor(req.params.id, req.user, req.query.vendorId)
      : await rfqService.getRfqDetail(req.params.id, req.user);
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
