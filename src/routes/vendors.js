const express = require('express');
const { body, param, query } = require('express-validator');
const { Vendor, Material, PurchaseRequest, RFQ, Quotation } = require('../models');
const { authenticate } = require('../middleware/auth');
const { requireCapability, hasCapability } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { serializeVendor } = require('../utils/serializeProcurement');
const vendorScorecardService = require('../services/vendorScorecardService');
const {
  vendorsForMaterial,
  vendorsForMaterialsGrouped,
  buildVendorOffersForMaterials,
} = require('../services/vendorOfferService');

const router = express.Router();
router.use(authenticate);

router.get('/for-materials', async (req, res, next) => {
  try {
    const raw = req.query.materialIds || req.query.ids || '';
    const materialIds = String(raw)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const strict = req.query.strict === 'true' || req.query.strict === '1';
    const rows = await vendorsForMaterialsGrouped(materialIds, { strict });
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/offers-for-materials', async (req, res, next) => {
  try {
    const raw = req.query.materialIds || req.query.ids || '';
    const materialIds = String(raw)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const strict = req.query.strict !== 'false' && req.query.strict !== '0';
    const purchaseRequestId = req.query.purchaseRequestId;

    let currentQuotations = [];
    if (purchaseRequestId) {
      const pr = await PurchaseRequest.findById(purchaseRequestId);
      if (pr) {
        const rfq = await RFQ.findOne({ purchaseRequestId: pr._id });
        if (rfq) {
          currentQuotations = await Quotation.find({ rfqId: rfq._id }).populate('vendorId');
        }
      }
    }

    const rows = await buildVendorOffersForMaterials(materialIds, {
      strict,
      currentQuotations,
    });
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/search', async (req, res, next) => {
  try {
    const { searchVendors } = require('../services/searchService');
    const data = await searchVendors(req.query.q, req.user, {
      materialId: req.query.materialId,
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.get('/pending-authorization', requireCapability('MANAGE_VENDORS'), async (req, res, next) => {
  try {
    const vendors = await Vendor.find({ authorizationStatus: 'PENDING' }).sort({ createdAt: -1 });
    res.json({ data: vendors.map(serializeVendor) });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const { materialId, search, strict, includePending } = req.query;
    let vendors;
    if (materialId) {
      vendors = await vendorsForMaterial(materialId, {
        strict: strict === 'true' || strict === '1',
      });
    } else {
      const filter =
        includePending === 'true' && hasCapability(req.user.role, 'MANAGE_VENDORS')
          ? {}
          : { isActive: { $ne: false }, authorizationStatus: { $in: ['AUTHORIZED', null] } };
      if (search) {
        const term = search.trim();
        filter.$or = [
          { name: { $regex: term, $options: 'i' } },
          { category: { $regex: term, $options: 'i' } },
          { address: { $regex: term, $options: 'i' } },
        ];
      }
      vendors = await Vendor.find(filter).populate('materialIds').sort({ name: 1 });
    }
    res.json({ data: vendors.map(serializeVendor) });
  } catch (err) {
    next(err);
  }
});

router.get('/gst-lookup/preview', async (req, res, next) => {
  try {
    const {
      lookupVendorByGstNumber,
      isGstLookupEnabled,
      normalizeGstNumber,
      getLookupStatusMessage,
    } = require('../services/vendorGstLookupService');
    const gstNumber = normalizeGstNumber(req.query.gstNumber);
    if (!gstNumber) {
      return res.status(400).json({ statusCode: 400, message: 'gstNumber query required' });
    }

    if (!isGstLookupEnabled()) {
      return res.json({
        data: {
          available: false,
          message: getLookupStatusMessage(),
        },
      });
    }

    try {
      const result = await lookupVendorByGstNumber(gstNumber);
      res.json({
        data: {
          available: true,
          name: result?.name,
          address: result?.address,
          panNumber: result?.panNumber,
          gstDetails: result?.gstDetails,
          message: 'Vendor details fetched from GST registry',
        },
      });
    } catch (lookupErr) {
      if (lookupErr.statusCode === 404) {
        return res.json({
          data: {
            available: false,
            message: lookupErr.message || 'No taxpayer record found for this GSTIN',
          },
        });
      }
      throw lookupErr;
    }
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
    next(err);
  }
});

router.get('/:id/scorecard', param('id').isMongoId(), validate, async (req, res, next) => {
  try {
    const vendor = await Vendor.findById(req.params.id).populate('materialIds');
    if (!vendor) return res.status(404).json({ statusCode: 404, message: 'Vendor not found' });

    const scorecard = await vendorScorecardService.getVendorScorecard(vendor._id);
    res.json({
      data: {
        vendor: serializeVendor(vendor),
        ...scorecard,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', param('id').isMongoId(), validate, async (req, res, next) => {
  try {
    const vendor = await Vendor.findById(req.params.id).populate('materialIds');
    if (!vendor || vendor.isActive === false) {
      return res.status(404).json({ statusCode: 404, message: 'Vendor not found' });
    }
    res.json({ data: serializeVendor(vendor) });
  } catch (err) {
    next(err);
  }
});

function validateVendorMsmePayload(body) {
  const isMsme = body.isMsme === true;
  if (isMsme) {
    if (!body.msmeNumber?.trim()) {
      const err = new Error('MSME number is required when vendor is MSME registered');
      err.statusCode = 400;
      throw err;
    }
    if (!body.msmeCertificate?.dataBase64 && !body.msmeCertificateUrl) {
      const err = new Error('MSME certificate upload is required when vendor is MSME registered');
      err.statusCode = 400;
      throw err;
    }
  } else if (body.isMsme === false) {
    if (body.msmeNumber || body.msmeCertificate || body.msmeCertificateUrl) {
      const err = new Error('MSME fields must not be sent when isMsme is false');
      err.statusCode = 400;
      throw err;
    }
  }
  return isMsme;
}

async function buildVendorPayload(body) {
  const isMsme = validateVendorMsmePayload(body);
  let msmeCertificateUrl = null;
  if (isMsme && body.msmeCertificate?.dataBase64) {
    const { saveMsmeCertificate } = require('../services/vendorFileService');
    msmeCertificateUrl = saveMsmeCertificate(body.msmeCertificate);
  } else if (isMsme && body.msmeCertificateUrl) {
    msmeCertificateUrl = body.msmeCertificateUrl;
  }

  return {
    name: body.name,
    code: body.code,
    address: body.address,
    gstNumber: body.gstNumber,
    email: body.email,
    contactPerson: body.contactPerson,
    phone: body.phone,
    category: body.category,
    suppliedCategories: body.suppliedCategories,
    materialIds: body.materialIds,
    isMsme,
    msmeNumber: isMsme ? body.msmeNumber?.trim() : null,
    msmeCertificateUrl: isMsme ? msmeCertificateUrl : null,
    panNumber: body.panNumber || '',
    bankName: body.bankName || '',
    bankAccountNumber: body.bankAccountNumber || '',
    ifscCode: body.ifscCode || '',
    contactInfo: body.phone || body.email || '',
  };
}

router.post(
  '/',
  (req, res, next) => {
    const canManage = hasCapability(req.user.role, 'MANAGE_VENDORS');
    const canCreate = hasCapability(req.user.role, 'CREATE_VENDOR');
    if (!canManage && !canCreate) {
      return res.status(403).json({ statusCode: 403, message: 'Forbidden' });
    }
    next();
  },
  [
    body('name').trim().notEmpty(),
    body('isMsme').isBoolean(),
    body('code').optional().trim(),
    body('address').optional().trim(),
    body('gstNumber').optional().trim(),
    body('panNumber').trim().notEmpty().withMessage('PAN is required'),
    body('email').optional().trim(),
    body('contactPerson').trim().notEmpty(),
    body('phone').trim().notEmpty(),
    body('bankName').trim().notEmpty(),
    body('bankAccountNumber').trim().notEmpty(),
    body('ifscCode').trim().notEmpty(),
    body('msmeNumber').optional().trim(),
    body('msmeCertificate').optional().isObject(),
    body('category').optional().trim(),
    body('suppliedCategories').optional().isArray(),
    body('materialIds').optional().isArray(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const isCoordinator = hasCapability(req.user.role, 'MANAGE_VENDORS');
      const payload = await buildVendorPayload(req.body);
      const vendor = await Vendor.create({
        ...payload,
        authorizationStatus: isCoordinator ? 'AUTHORIZED' : 'PENDING',
        isActive: isCoordinator,
        createdByUserId: req.user._id,
        authorizedByUserId: isCoordinator ? req.user._id : undefined,
        authorizedAt: isCoordinator ? new Date() : undefined,
      });

      if (!isCoordinator) {
        const { User } = require('../models');
        const { UserRole } = require('@afios/shared');
        const notificationService = require('../services/notificationService');
        const coordinators = await User.find({ role: UserRole.COORDINATOR });
        await notificationService.notifyUsers(
          coordinators.map((u) => u._id),
          {
            title: 'New vendor pending authorization',
            body: `${vendor.name} submitted by Executive — review and authorize.`,
            relatedEntityType: 'Vendor',
            relatedEntityId: vendor._id,
          }
        );
      }

      const populated = await Vendor.findById(vendor._id).populate('materialIds');
      res.status(201).json({ data: serializeVendor(populated) });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
      }
      next(err);
    }
  }
);

router.post(
  '/:id/authorize',
  requireCapability('MANAGE_VENDORS'),
  [
    param('id').isMongoId(),
    body('action').isIn(['authorize', 'reject']),
    body('remark').optional().trim(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const vendor = await Vendor.findById(req.params.id);
      if (!vendor) return res.status(404).json({ statusCode: 404, message: 'Not found' });
      if (vendor.authorizationStatus === 'AUTHORIZED') {
        return res.status(400).json({ statusCode: 400, message: 'Vendor already authorized' });
      }

      if (req.body.action === 'reject') {
        vendor.authorizationStatus = 'REJECTED';
        vendor.isActive = false;
        vendor.authorizationRemark = req.body.remark || '';
        vendor.authorizedByUserId = req.user._id;
        vendor.authorizedAt = new Date();
        await vendor.save();
        return res.json({ data: serializeVendor(vendor) });
      }

      vendor.authorizationStatus = 'AUTHORIZED';
      vendor.isActive = true;
      vendor.authorizationRemark = req.body.remark || '';
      vendor.authorizedByUserId = req.user._id;
      vendor.authorizedAt = new Date();
      await vendor.save();

      const populated = await Vendor.findById(vendor._id).populate('materialIds');
      res.json({ data: serializeVendor(populated) });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/:id',
  requireCapability('MANAGE_VENDORS'),
  [
    param('id').isMongoId(),
    body('name').optional().trim().notEmpty(),
    body('isMsme').optional().isBoolean(),
    body('address').optional().trim(),
    body('gstNumber').optional().trim(),
    body('panNumber').optional().trim(),
    body('email').optional().trim(),
    body('contactPerson').optional().trim(),
    body('phone').optional().trim(),
    body('bankName').optional().trim(),
    body('bankAccountNumber').optional().trim(),
    body('ifscCode').optional().trim(),
    body('msmeNumber').optional().trim(),
    body('msmeCertificate').optional().isObject(),
    body('category').optional().trim(),
    body('suppliedCategories').optional().isArray(),
    body('materialIds').optional().isArray(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const vendor = await Vendor.findById(req.params.id);
      if (!vendor) return res.status(404).json({ statusCode: 404, message: 'Not found' });

      if (req.body.isMsme !== undefined) {
        const merged = { ...vendor.toObject(), ...req.body };
        const payload = await buildVendorPayload(merged);
        Object.assign(vendor, payload);
      } else {
        const fields = [
          'name',
          'address',
          'gstNumber',
          'panNumber',
          'email',
          'contactPerson',
          'phone',
          'bankName',
          'bankAccountNumber',
          'ifscCode',
          'category',
          'code',
        ];
        for (const field of fields) {
          if (req.body[field] !== undefined) vendor[field] = req.body[field];
        }
        if (req.body.suppliedCategories) vendor.suppliedCategories = req.body.suppliedCategories;
        if (req.body.materialIds) vendor.materialIds = req.body.materialIds;
        vendor.contactInfo = vendor.phone || vendor.email || '';
      }

      await vendor.save();
      const populated = await Vendor.findById(vendor._id).populate('materialIds');
      res.json({ data: serializeVendor(populated) });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
      }
      next(err);
    }
  }
);

router.delete(
  '/:id',
  requireCapability('MANAGE_VENDORS'),
  param('id').isMongoId(),
  validate,
  async (req, res, next) => {
    try {
      const vendor = await Vendor.findById(req.params.id);
      if (!vendor) return res.status(404).json({ statusCode: 404, message: 'Not found' });
      vendor.isActive = false;
      await vendor.save();
      res.json({ data: { id: vendor._id.toString() } });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/reviews',
  requireCapability('EDIT_PROCUREMENT'),
  [
    param('id').isMongoId(),
    body('deliveryScore').isFloat({ min: 1, max: 5 }),
    body('qualityScore').isFloat({ min: 1, max: 5 }),
    body('note').optional().trim(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const vendor = await Vendor.findById(req.params.id);
      if (!vendor) return res.status(404).json({ statusCode: 404, message: 'Vendor not found' });

      const review = await vendorScorecardService.addVendorReview(vendor._id, req.user._id, {
        deliveryScore: Number(req.body.deliveryScore),
        qualityScore: Number(req.body.qualityScore),
        note: req.body.note || '',
      });

      res.status(201).json({ data: review });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
