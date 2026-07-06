const express = require('express');
const { body } = require('express-validator');
const { UserRole } = require('@afios/shared');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const {
  loadOrgSettings,
  getSettings,
  getApprovalLimits,
  updateOrgSettings,
} = require('../services/orgSettingsService');

const router = express.Router();
router.use(authenticate);

function assertSettingsAdmin(user) {
  if (![UserRole.COORDINATOR, UserRole.CHAIRMAN].includes(user.role)) {
    const err = new Error('Forbidden');
    err.statusCode = 403;
    throw err;
  }
}

router.get('/approval-limits', async (req, res, next) => {
  try {
    await loadOrgSettings();
    res.json({ data: getApprovalLimits() });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    assertSettingsAdmin(req.user);
    await loadOrgSettings();
    res.json({ data: getSettings() });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
    next(err);
  }
});

router.patch(
  '/',
  [
    body('poPmMaxInr').optional().isFloat({ min: 0 }),
    body('poCoordinatorMaxInr').optional().isFloat({ min: 0 }),
    body('mrPmDailyMaxInr').optional().isFloat({ min: 0 }),
    body('timezone').optional().isString(),
    body('expenseCategories').optional().isArray(),
    body('expenseCategories.*.key').optional().isString(),
    body('expenseCategories.*.label').optional().isString(),
    body('expenseCategories.*.requiresPo').optional().isBoolean(),
    body('expenseCategories.*.pmMaxInr').optional().isFloat({ min: 0 }),
    body('expenseCategories.*.coordinatorMaxInr').optional().isFloat({ min: 0 }),
  ],
  validate,
  async (req, res, next) => {
    try {
      assertSettingsAdmin(req.user);
      const patch = req.body;
      if (
        patch.poPmMaxInr != null &&
        patch.poCoordinatorMaxInr != null &&
        Number(patch.poCoordinatorMaxInr) < Number(patch.poPmMaxInr)
      ) {
        return res.status(400).json({
          statusCode: 400,
          message: 'Coordinator limit must be greater than or equal to PM limit',
        });
      }
      const data = await updateOrgSettings(patch, req.user._id);
      res.json({ data });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
      next(err);
    }
  }
);

module.exports = router;
