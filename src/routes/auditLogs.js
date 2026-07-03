const express = require('express');
const { query } = require('express-validator');
const { UserRole } = require('@afios/shared');
const { AuditLog } = require('../models');
const { authenticate } = require('../middleware/auth');
const { requireCapability } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { serializeAuditLog } = require('../utils/serializeProcurement');

const router = express.Router();
router.use(authenticate);
router.use(requireCapability('VIEW_AUDIT_LOGS'));

router.get(
  '/',
  [
    query('entityType').optional().trim(),
    query('entityId').optional().isMongoId(),
    query('action').optional().trim(),
    query('from').optional().isISO8601(),
    query('to').optional().isISO8601(),
    query('limit').optional().isInt({ min: 1, max: 200 }),
  ],
  validate,
  async (req, res, next) => {
    try {
      const filter = {};
      if (req.query.entityType) filter.entityType = req.query.entityType;
      if (req.query.entityId) filter.entityId = req.query.entityId;
      if (req.query.action) filter.action = new RegExp(req.query.action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      if (req.query.from || req.query.to) {
        filter.timestamp = {};
        if (req.query.from) filter.timestamp.$gte = new Date(req.query.from);
        if (req.query.to) filter.timestamp.$lte = new Date(req.query.to);
      }

      const limit = parseInt(req.query.limit, 10) || 50;

      const logs = await AuditLog.find(filter)
        .sort({ timestamp: -1 })
        .limit(limit)
        .populate('actorUserId', 'name role');

      res.json({ data: logs.map(serializeAuditLog) });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
