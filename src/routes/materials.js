const express = require('express');
const { body, param } = require('express-validator');
const { Material, StockLedger, StockMovement, Site, MaterialCategory } = require('../models');
const { authenticate } = require('../middleware/auth');
const { requireCapability } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { UserRole } = require('@afios/shared');
const { serializeMaterial, userCanAccessSite } = require('../utils/serialize');
const { PHASE_CATEGORIES, assertCategoryRemarks } = require('../services/materialCategoryService');

const router = express.Router();
router.use(authenticate);

function buildMaterialFilter(search) {
  const filter = { isActive: { $ne: false } };
  if (search) {
    const term = search.trim();
    filter.$or = [
      { name: { $regex: term, $options: 'i' } },
      { code: { $regex: term, $options: 'i' } },
      { description: { $regex: term, $options: 'i' } },
      { grade: { $regex: term, $options: 'i' } },
      { category: { $regex: term, $options: 'i' } },
    ];
  }
  return filter;
}

router.get('/categories', async (req, res, next) => {
  try {
    const { listMaterialCategories } = require('../services/materialCategoryService');
    const rows = await listMaterialCategories();
    res.json({
      data: rows.map((c) => ({ id: c._id.toString(), name: c.name })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/search', async (req, res, next) => {
  try {
    const { searchMaterials } = require('../services/searchService');
    const data = await searchMaterials(req.query.q, req.user);
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.get('/catalog', async (req, res, next) => {
  try {
    const { search, siteId } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const filter = buildMaterialFilter(search);

    const resolvedSiteId = siteId || req.user.assignedSiteId?.toString();
    let stockByMaterial = new Map();

    const addLedgers = (ledgers) => {
      for (const ledger of ledgers) {
        const key = ledger.materialId.toString();
        const existing = stockByMaterial.get(key);
        if (existing) {
          existing.quantityOnHand += ledger.quantityOnHand;
        } else {
          stockByMaterial.set(key, {
            quantityOnHand: ledger.quantityOnHand,
            lowStockThreshold: ledger.lowStockThreshold,
            hasLedger: true,
          });
        }
      }
    };

    if (siteId) {
      // Explicit site filter (HQ)
      addLedgers(await StockLedger.find({ siteId }));
    } else if (req.user.role === UserRole.STORE_INCHARGE) {
      // Store Manager: stock across all sites for assigned projects (qty on hand)
      if (req.user.assignedProjectIds?.length) {
        const sites = await Site.find({
          projectId: { $in: req.user.assignedProjectIds },
        }).select('_id');
        if (sites.length) {
          addLedgers(await StockLedger.find({ siteId: { $in: sites.map((s) => s._id) } }));
        }
      } else if (resolvedSiteId) {
        addLedgers(await StockLedger.find({ siteId: resolvedSiteId }));
      }
    } else if (resolvedSiteId && req.user.role === UserRole.SITE_INCHARGE) {
      addLedgers(await StockLedger.find({ siteId: resolvedSiteId }));
    } else if (
      [UserRole.COORDINATOR, UserRole.CHAIRMAN, UserRole.EXECUTIVE, UserRole.PROJECT_MANAGER].includes(
        req.user.role
      )
    ) {
      addLedgers(await StockLedger.find());
    }

    const { dedupeMaterialListResults } = require('../services/materialDedupService');
    const allMatching = await Material.find(filter)
      .populate('categoryId')
      .sort({ category: 1, code: 1 })
      .lean();
    const deduped = dedupeMaterialListResults(
      allMatching.map((m) => serializeMaterial(m)),
      { collapseDuplicateNames: false }
    );
    const total = deduped.length;
    const materials = deduped.slice((page - 1) * limit, page * limit);

    const { getLatestApprovedRates, attachUnitPrices } = require('../services/materialPricingService');
    const rateByMaterial = await getLatestApprovedRates(materials.map((m) => m.id));

    // Stats across full filtered catalog (not only current page)
    let inStock = 0;
    let lowStock = 0;
    let totalQty = 0;
    for (const m of deduped) {
      const stock = stockByMaterial.get(m.id);
      const qty = stock?.quantityOnHand ?? 0;
      const threshold = stock?.lowStockThreshold ?? 0;
      totalQty += qty;
      if (qty > 0) inStock += 1;
      if (threshold > 0 && qty <= threshold) lowStock += 1;
    }

    res.json({
      data: attachUnitPrices(
        materials.map((m) => {
          const stock = stockByMaterial.get(m.id);
          const quantityOnHand = stock?.quantityOnHand ?? 0;
          const lowStockThreshold = stock?.lowStockThreshold ?? 0;
          return {
            ...m,
            stock: {
              quantityOnHand,
              lowStockThreshold,
              isLowStock: quantityOnHand <= lowStockThreshold && lowStockThreshold > 0,
              hasLedger: Boolean(stock?.hasLedger),
            },
          };
        }),
        rateByMaterial
      ),
      meta: {
        siteId: resolvedSiteId || null,
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        inStock,
        lowStock,
        totalQty,
      },
    });
  } catch (err) {
    next(err);
  }
});
router.get('/', async (req, res, next) => {
  try {
    const { search } = req.query;
    const { dedupeMaterialListResults } = require('../services/materialDedupService');
    const filter = buildMaterialFilter(search);
    const materials = await Material.find(filter).sort({ name: 1, code: 1 }).limit(200);
    const { getLatestApprovedRates, attachUnitPrices } = require('../services/materialPricingService');
    const rateByMaterial = await getLatestApprovedRates(materials.map((m) => m._id.toString()));
    const priced = attachUnitPrices(materials.map(serializeMaterial), rateByMaterial);
    res.json({
      data: dedupeMaterialListResults(priced, { collapseDuplicateNames: true }),
    });
  } catch (err) {
    next(err);
  }
});

async function resolveMaterialCategory(body) {
  const { resolveMaterialCategory: resolveCategory } = require('../services/materialCategoryService');
  return resolveCategory(body);
}

router.post(
  '/site-request',
  requireCapability('CREATE_MATERIAL_REQUEST'),
  [
    body('name').trim().notEmpty().isLength({ max: 200 }),
    body('unit').trim().notEmpty().isLength({ max: 40 }),
    body('category').optional().trim().isIn(PHASE_CATEGORIES),
    body('categoryRemarks').optional().trim().isLength({ max: 500 }),
    body('description').optional().trim().isLength({ max: 500 }),
  ],
  validate,
  async (req, res, next) => {
    try {
      const { createOrResolveSiteMaterial } = require('../services/siteMaterialService');
      const { material, created, reused } = await createOrResolveSiteMaterial({
        name: req.body.name,
        unit: req.body.unit,
        category: req.body.category,
        categoryRemarks: req.body.categoryRemarks,
        description: req.body.description,
        createdByUserId: req.user._id,
      });
      res.status(created ? 201 : 200).json({
        data: serializeMaterial(material),
        meta: { created, reused },
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/',
  requireCapability('CREATE_INVENTORY_ITEM'),
  [
    body('code').trim().notEmpty(),
    body('name').trim().notEmpty(),
    body('unit').trim().notEmpty(),
    body('description').optional().trim(),
    body('grade').optional().trim(),
    body('categoryId').optional().isMongoId(),
    body('category').optional().trim().isIn(PHASE_CATEGORIES),
    body('categoryRemarks').optional().trim().isLength({ max: 500 }),
    body('hsnCode').trim().notEmpty().withMessage('HSN code is required').isLength({ min: 4, max: 8 }),
    body('gstRate').optional().isFloat({ min: 0, max: 28 }),
    body('siteId').optional().isMongoId(),
    body('initialQuantity').optional().isFloat({ min: 0 }),
    body('lowStockThreshold').optional().isFloat({ min: 0 }),
  ],
  validate,
  async (req, res, next) => {
    try {
      const { findMaterialDuplicate } = require('../services/materialDedupService');
      const duplicate = await findMaterialDuplicate({
        code: req.body.code,
        name: req.body.name,
        hsnCode: req.body.hsnCode,
      });
      if (duplicate) {
        return res.status(400).json({ statusCode: 400, message: 'Material already exists.' });
      }
      const existing = await Material.findOne({ code: req.body.code.toUpperCase() });
      if (existing) {
        return res.status(400).json({ statusCode: 400, message: 'Material already exists.' });
      }
      const { siteId, initialQuantity, lowStockThreshold, categoryId, category, ...materialData } =
        req.body;
      const cat = await resolveMaterialCategory({ categoryId, category });
      assertCategoryRemarks(cat.name, req.body.categoryRemarks);
      const material = await Material.create({
        ...materialData,
        code: String(materialData.code || '').toUpperCase(),
        categoryId: cat._id,
        category: cat.name,
        categoryRemarks: cat.name === 'Others' ? String(req.body.categoryRemarks || '').trim() : '',
      });

      const resolvedSiteId = siteId || req.user.assignedSiteId;
      if (resolvedSiteId && initialQuantity !== undefined) {
        await StockLedger.findOneAndUpdate(
          { siteId: resolvedSiteId, materialId: material._id },
          {
            $setOnInsert: {
              siteId: resolvedSiteId,
              materialId: material._id,
              quantityOnHand: initialQuantity,
              lowStockThreshold: lowStockThreshold ?? 10,
            },
          },
          { upsert: true, new: true }
        );
      }

      res.status(201).json({ data: serializeMaterial(material) });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/:id',
  requireCapability('CREATE_INVENTORY_ITEM'),
  [
    param('id').isMongoId(),
    body('code').optional().trim().notEmpty(),
    body('name').optional().trim().notEmpty(),
    body('unit').optional().trim().notEmpty(),
    body('description').optional().trim(),
    body('grade').optional().trim(),
    body('categoryId').optional().isMongoId(),
    body('category').optional().trim().isIn(PHASE_CATEGORIES),
    body('categoryRemarks').optional().trim().isLength({ max: 500 }),
    body('hsnCode').optional().trim(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const material = await Material.findById(req.params.id);
      if (!material || material.isActive === false) {
        return res.status(404).json({ statusCode: 404, message: 'Material not found' });
      }

      if (req.body.code && req.body.code.toUpperCase() !== material.code) {
        const { findMaterialDuplicate } = require('../services/materialDedupService');
        const duplicate = await findMaterialDuplicate({
          code: req.body.code,
          name: req.body.name || material.name,
          hsnCode: req.body.hsnCode ?? material.hsnCode,
          excludeId: material._id,
        });
        if (duplicate) {
          return res.status(400).json({ statusCode: 400, message: 'Material already exists.' });
        }
        material.code = req.body.code.toUpperCase();
      } else if (req.body.name || req.body.hsnCode !== undefined) {
        const { findMaterialDuplicate } = require('../services/materialDedupService');
        const duplicate = await findMaterialDuplicate({
          name: req.body.name || material.name,
          hsnCode: req.body.hsnCode ?? material.hsnCode,
          excludeId: material._id,
        });
        if (duplicate) {
          return res.status(400).json({ statusCode: 400, message: 'Material already exists.' });
        }
      }
      if (req.body.name) material.name = req.body.name;
      if (req.body.unit) material.unit = req.body.unit;
      if (req.body.description !== undefined) material.description = req.body.description;
      if (req.body.grade !== undefined) material.grade = req.body.grade;
      if (req.body.categoryId != null || req.body.category != null) {
        const cat = await resolveMaterialCategory({
          categoryId: req.body.categoryId || material.categoryId,
          category: req.body.category || material.category,
        });
        const remarks =
          req.body.categoryRemarks !== undefined
            ? req.body.categoryRemarks
            : material.categoryRemarks;
        assertCategoryRemarks(cat.name, remarks);
        material.categoryId = cat._id;
        material.category = cat.name;
        material.categoryRemarks =
          cat.name === 'Others' ? String(remarks || '').trim() : '';
      } else if (req.body.categoryRemarks !== undefined) {
        assertCategoryRemarks(material.category, req.body.categoryRemarks);
        material.categoryRemarks = String(req.body.categoryRemarks || '').trim();
      }
      if (req.body.hsnCode !== undefined) material.hsnCode = req.body.hsnCode;

      await material.save();
      res.json({ data: serializeMaterial(material) });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/stock',
  requireCapability('CREATE_INVENTORY_ITEM'),
  [
    param('id').isMongoId(),
    body('siteId').optional().isMongoId(),
    body('quantity').isFloat({ min: 0 }),
    body('lowStockThreshold').optional().isFloat({ min: 0 }),
    body('mode').optional().isIn(['set', 'add']),
  ],
  validate,
  async (req, res, next) => {
    try {
      const material = await Material.findById(req.params.id);
      if (!material) {
        return res.status(404).json({ statusCode: 404, message: 'Material not found' });
      }

      const siteId = req.body.siteId || req.user.assignedSiteId;
      if (!siteId) {
        return res.status(400).json({ statusCode: 400, message: 'Site is required to update stock' });
      }
      if (!userCanAccessSite(req.user, siteId)) {
        return res.status(403).json({ statusCode: 403, message: 'Forbidden' });
      }

      const mode = req.body.mode || 'add';
      const quantity = Number(req.body.quantity);
      let ledger = await StockLedger.findOne({ siteId, materialId: material._id });
      const previousQty = ledger?.quantityOnHand ?? 0;

      if (!ledger) {
        ledger = await StockLedger.create({
          siteId,
          materialId: material._id,
          quantityOnHand: mode === 'set' ? quantity : quantity,
          lowStockThreshold: req.body.lowStockThreshold ?? 10,
        });
      } else {
        if (req.body.lowStockThreshold !== undefined) {
          ledger.lowStockThreshold = req.body.lowStockThreshold;
        }
        ledger.quantityOnHand = mode === 'set' ? quantity : previousQty + quantity;
        ledger.lastMovementAt = new Date();
        await ledger.save();
      }

      const delta = ledger.quantityOnHand - previousQty;
      if (delta !== 0) {
        await StockMovement.create({
          siteId,
          materialId: material._id,
          quantityDelta: delta,
          type: 'ADJUSTMENT',
          actorUserId: req.user._id,
        });
      }

      res.json({
        data: {
          materialId: material._id.toString(),
          siteId: siteId.toString(),
          quantityOnHand: ledger.quantityOnHand,
          lowStockThreshold: ledger.lowStockThreshold,
          isLowStock: ledger.quantityOnHand <= ledger.lowStockThreshold,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/:id',
  requireCapability('DELETE_INVENTORY_ITEM'),
  param('id').isMongoId(),
  validate,
  async (req, res, next) => {
    try {
      const material = await Material.findById(req.params.id);
      if (!material) return res.status(404).json({ statusCode: 404, message: 'Not found' });
      material.isActive = false;
      await material.save();
      res.json({ data: { id: material._id.toString(), deleted: true } });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
