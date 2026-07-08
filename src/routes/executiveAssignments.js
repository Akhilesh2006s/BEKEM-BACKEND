const express = require('express');
const { body, param } = require('express-validator');
const { UserRole } = require('@afios/shared');
const { User } = require('../models');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { serializeUser } = require('../utils/serialize');
const { listIndentCategories, serializeIndentCategory } = require('../services/indentCategoryService');

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
    assertCategoryAdmin(req.user);
    const [executives, categories] = await Promise.all([
      User.find({ role: UserRole.EXECUTIVE })
        .sort({ name: 1 })
        .select('-passwordHash -refreshToken')
        .populate('assignedIndentCategoryIds', 'name isActive sortOrder'),
      listIndentCategories({ activeOnly: false }),
    ]);

    res.json({
      data: {
        executives: executives.map((u) => ({
          ...serializeUser(u),
          assignedIndentCategories: (u.assignedIndentCategoryIds || [])
            .filter((c) => c && c.name)
            .map(serializeIndentCategory),
        })),
        categories: categories.map(serializeIndentCategory),
      },
    });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
    next(err);
  }
});

router.patch(
  '/:id',
  [
    param('id').isMongoId(),
    body('assignedIndentCategoryIds').isArray(),
    body('assignedIndentCategoryIds.*').isMongoId(),
  ],
  validate,
  async (req, res, next) => {
    try {
      assertCategoryAdmin(req.user);
      const user = await User.findById(req.params.id).populate(
        'assignedIndentCategoryIds',
        'name isActive sortOrder'
      );
      if (!user || user.role !== UserRole.EXECUTIVE) {
        return res.status(404).json({ statusCode: 404, message: 'Executive not found' });
      }

      user.assignedIndentCategoryIds = req.body.assignedIndentCategoryIds;
      await user.save();

      res.json({
        data: {
          ...serializeUser(user),
          assignedIndentCategories: (user.assignedIndentCategoryIds || [])
            .filter((c) => c && c.name)
            .map(serializeIndentCategory),
        },
      });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
      next(err);
    }
  }
);

module.exports = router;
