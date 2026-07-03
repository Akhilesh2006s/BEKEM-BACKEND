const express = require('express');
const { param, query } = require('express-validator');
const statusHistoryService = require('../services/statusHistoryService');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = express.Router();

router.use(authenticate);

router.get(
  '/:entityType/:entityId',
  [
    param('entityId').isMongoId(),
    query('entityType').optional(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const timeline = await statusHistoryService.getTimeline(
        req.params.entityType,
        req.params.entityId
      );
      res.json({
        data: timeline.map((t) => ({
          id: t._id.toString(),
          entityType: t.entityType,
          entityId: t.entityId.toString(),
          fromStatus: t.fromStatus,
          toStatus: t.toStatus,
          actorUserId: t.actorUserId?._id?.toString() || t.actorUserId?.toString(),
          actorName: t.actorUserId?.name || 'System',
          note: t.note,
          timestamp: t.timestamp.toISOString(),
        })),
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
