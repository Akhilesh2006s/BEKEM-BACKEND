const express = require('express');
const { body, param } = require('express-validator');
const { UserRole } = require('@afios/shared');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const {
  listIndentCategories,
  createIndentCategory,
  updateIndentCategory,
  serializeIndentCategory,
} = require('../services/indentCategoryService');

const router = express.Router();
router.use(authenticate);

function assertCategoryAdmin(user) {
  if (![UserRole.COORDINATOR, UserRole.CHAIRMAN].includes(user.role)) {
    const err = new Error('Forbidden');
    err.statusCode = 403;
    throw err;
  }
}

router.get('/', async (req, res, next) => {
  try {
    const includeInactive =
      [UserRole.COORDINATOR, UserRole.CHAIRMAN].includes(req.user.role) && req.query.all === 'true';
    const rows = await listIndentCategories({ activeOnly: !includeInactive });
    res.json({ data: rows.map(serializeIndentCategory) });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/',
  [
    body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 80 }),
    body('sortOrder').optional().isInt({ min: 0 }),
  ],
  validate,
  async (req, res, next) => {
    try {
      assertCategoryAdmin(req.user);
      const row = await createIndentCategory({
        name: req.body.name,
        sortOrder: req.body.sortOrder,
      });
      res.status(201).json({ data: serializeIndentCategory(row) });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
      next(err);
    }
  }
);

router.patch(
  '/:id',
  [
    param('id').isMongoId(),
    body('name').optional().trim().notEmpty().isLength({ max: 80 }),
    body('isActive').optional().isBoolean(),
    body('sortOrder').optional().isInt({ min: 0 }),
  ],
  validate,
  async (req, res, next) => {
    try {
      assertCategoryAdmin(req.user);
      const row = await updateIndentCategory(req.params.id, req.body);
      res.json({ data: serializeIndentCategory(row) });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
      next(err);
    }
  }
);

module.exports = router;
