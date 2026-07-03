const express = require('express');
const { query } = require('express-validator');
const { UserRole } = require('@afios/shared');
const { authenticate } = require('../middleware/auth');
const { requireCapability } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const dashboardService = require('../services/dashboardService');

const router = express.Router();
router.use(authenticate);

router.get('/today', async (req, res, next) => {
  try {
    const actions = await dashboardService.getTodayActions(req.user);
    res.json({ data: actions });
  } catch (err) {
    next(err);
  }
});

router.get(
  '/chairman-kpis',
  requireCapability('VIEW_ALL_PROJECTS'),
  async (req, res, next) => {
    try {
      if (req.user.role !== UserRole.CHAIRMAN) {
        return res.status(403).json({ statusCode: 403, message: 'Forbidden' });
      }
      const data = await dashboardService.getChairmanKpis();
      res.json({ data });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/budget-vs-actual', async (req, res, next) => {
  try {
    const data = await dashboardService.getBudgetVsActual(req.user);
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.get(
  '/search',
  [query('q').trim().isLength({ min: 2 })],
  validate,
  async (req, res, next) => {
    try {
      const data = await dashboardService.globalSearch(req.user, req.query.q);
      res.json({ data });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/tally-sync',
  requireCapability('VIEW_FINANCE'),
  async (req, res, next) => {
    try {
      const data = await dashboardService.getTallySyncStatus();
      res.json({ data });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/user-analytics',
  requireCapability('VIEW_USER_ANALYTICS'),
  async (req, res, next) => {
    try {
      const data = await dashboardService.getUserAnalytics();
      res.json({ data });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/explorer',
  requireCapability('VIEW_ALL_PROJECTS'),
  async (req, res, next) => {
    try {
      const data = await dashboardService.getExplorerProjects();
      res.json({ data });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
