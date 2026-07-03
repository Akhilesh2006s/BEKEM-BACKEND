const express = require('express');
const { body, param, query } = require('express-validator');
const { Vendor, Material } = require('../models');
const { authenticate } = require('../middleware/auth');
const { requireCapability } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { serializeVendor } = require('../utils/serializeProcurement');
const vendorScorecardService = require('../services/vendorScorecardService');

const router = express.Router();
router.use(authenticate);

async function vendorsForMaterial(materialId, { strict = false } = {}) {
  const material = await Material.findById(materialId);
  if (!material) return Vendor.find({ isActive: { $ne: false } }).populate('materialIds');

  if (strict) {
    return Vendor.find({
      isActive: { $ne: false },
      materialIds: materialId,
    })
      .populate('materialIds')
      .sort({ name: 1 });
  }

  return Vendor.find({
    isActive: { $ne: false },
    $or: [
      { materialIds: materialId },
      { suppliedCategories: material.category },
      { category: material.category },
      { materialIds: { $size: 0 } },
      { materialIds: { $exists: false } },
    ],
  })
    .populate('materialIds')
    .sort({ name: 1 });
}

async function vendorsForMaterialsGrouped(materialIds, { strict = false } = {}) {
  const uniqueIds = [...new Set(materialIds.filter(Boolean))];
  const rows = [];
  for (const materialId of uniqueIds) {
    const material = await Material.findById(materialId);
    const vendors = await vendorsForMaterial(materialId, { strict });
    rows.push({
      materialId,
      material: material
        ? { id: material._id.toString(), code: material.code, name: material.name, unit: material.unit }
        : null,
      vendors: vendors.map(serializeVendor),
    });
  }
  return rows;
}

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

router.get('/', async (req, res, next) => {
  try {
    const { materialId, search, strict } = req.query;
    let vendors;
    if (materialId) {
      vendors = await vendorsForMaterial(materialId, {
        strict: strict === 'true' || strict === '1',
      });
    } else {
      const filter = { isActive: { $ne: false } };
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

router.post(
  '/',
  requireCapability('MANAGE_VENDORS'),
  [
    body('name').trim().notEmpty(),
    body('code').optional().trim(),
    body('address').optional().trim(),
    body('gstNumber').optional().trim(),
    body('email').optional().trim(),
    body('contactPerson').optional().trim(),
    body('phone').optional().trim(),
    body('category').optional().trim(),
    body('suppliedCategories').optional().isArray(),
    body('materialIds').optional().isArray(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const vendor = await Vendor.create({
        ...req.body,
        contactInfo: req.body.phone || req.body.email || '',
      });
      const populated = await Vendor.findById(vendor._id).populate('materialIds');
      res.status(201).json({ data: serializeVendor(populated) });
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
    body('address').optional().trim(),
    body('gstNumber').optional().trim(),
    body('email').optional().trim(),
    body('contactPerson').optional().trim(),
    body('phone').optional().trim(),
    body('category').optional().trim(),
    body('suppliedCategories').optional().isArray(),
    body('materialIds').optional().isArray(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const vendor = await Vendor.findById(req.params.id);
      if (!vendor) return res.status(404).json({ statusCode: 404, message: 'Not found' });

      const fields = [
        'name',
        'address',
        'gstNumber',
        'email',
        'contactPerson',
        'phone',
        'category',
        'suppliedCategories',
        'materialIds',
      ];
      for (const f of fields) {
        if (req.body[f] !== undefined) vendor[f] = req.body[f];
      }
      if (req.body.phone || req.body.email) {
        vendor.contactInfo = req.body.phone || req.body.email || vendor.contactInfo;
      }
      await vendor.save();
      const populated = await Vendor.findById(vendor._id).populate('materialIds');
      res.json({ data: serializeVendor(populated) });
    } catch (err) {
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
      res.json({ data: { id: vendor._id.toString(), deleted: true } });
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
    body('deliveryScore').isInt({ min: 1, max: 5 }),
    body('qualityScore').isInt({ min: 1, max: 5 }),
    body('note').optional().trim(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const vendor = await Vendor.findById(req.params.id);
      if (!vendor) return res.status(404).json({ statusCode: 404, message: 'Vendor not found' });

      await vendorScorecardService.addVendorReview(vendor._id, req.user._id, req.body);
      const scorecard = await vendorScorecardService.getVendorScorecard(vendor._id);
      const updated = await Vendor.findById(vendor._id).populate('materialIds');

      res.status(201).json({
        data: {
          vendor: serializeVendor(updated),
          ...scorecard,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
