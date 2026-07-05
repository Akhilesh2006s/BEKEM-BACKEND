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

router.get('/executive', async (req, res, next) => {
  try {
    if (req.user.role !== UserRole.EXECUTIVE) {
      return res.status(403).json({ statusCode: 403, message: 'Forbidden' });
    }
    const data = await dashboardService.getExecutiveDashboard(req.user, req.query);
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.get('/pm', async (req, res, next) => {
  try {
    if (req.user.role !== UserRole.PROJECT_MANAGER) {
      return res.status(403).json({ statusCode: 403, message: 'Forbidden' });
    }
    const data = await dashboardService.getPmDashboard(req.user);
    res.json({ data });
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
      const data = await dashboardService.getChairmanKpis(req.query);
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

router.get('/widgets', async (req, res, next) => {
  try {
    const data = await dashboardService.getDashboardWidgets(req.user);
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.get(
  '/chairman',
  requireCapability('VIEW_ALL_PROJECTS'),
  async (req, res, next) => {
    try {
      if (req.user.role !== UserRole.CHAIRMAN) {
        return res.status(403).json({ statusCode: 403, message: 'Forbidden' });
      }
      const [kpis, extras] = await Promise.all([
        dashboardService.getChairmanKpis(req.query),
        dashboardService.getChairmanDashboardExtras(req.query),
      ]);
      res.json({ data: { ...kpis, ...extras } });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/delivery-alerts', async (req, res, next) => {
  try {
    const { getUnresolvedDeliveryAlerts } = require('../services/deliveryAlertService');
    const data = await getUnresolvedDeliveryAlerts(req.user);
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
