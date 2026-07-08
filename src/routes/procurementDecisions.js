const express = require('express');
const { body, param } = require('express-validator');
const { UserRole } = require('@afios/shared');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { handleIdempotent } = require('../utils/idempotentHandler');
const {
  listProcurementDecisions,
  buildProcurementDecisionDto,
  loadDecisionIndent,
  executiveDecide,
  coordinatorReview,
} = require('../services/procurementDecisionService');
const { executiveCanAccessIndent } = require('../services/executiveRoutingService');

const router = express.Router();
router.use(authenticate);

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ statusCode: 403, message: 'Forbidden' });
    }
    next();
  };
}

router.get(
  '/',
  requireRoles(UserRole.EXECUTIVE, UserRole.COORDINATOR, UserRole.CHAIRMAN),
  async (req, res, next) => {
    try {
      const data = await listProcurementDecisions(req.user);
      res.json({ data });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/:id',
  requireRoles(UserRole.EXECUTIVE, UserRole.COORDINATOR, UserRole.CHAIRMAN),
  param('id').isMongoId(),
  validate,
  async (req, res, next) => {
    try {
      const mr = await loadDecisionIndent(req.params.id);
      if (!mr) return res.status(404).json({ statusCode: 404, message: 'Not found' });
      if (!executiveCanAccessIndent(req.user, mr)) {
        return res.status(403).json({ statusCode: 403, message: 'Forbidden' });
      }
      res.json({ data: await buildProcurementDecisionDto(mr) });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/executive-decide',
  requireRoles(UserRole.EXECUTIVE),
  [
    param('id').isMongoId(),
    body('method').optional().isIn(['PURCHASE_ORDER', 'BRANCH_TRANSFER']),
    body('remark').trim().notEmpty().withMessage('Remark is required'),
  ],
  validate,
  async (req, res, next) => {
    return handleIdempotent(req, res, `proc-exec:${req.params.id}:${req.body.method}`, async () => {
      const mr = await loadDecisionIndent(req.params.id);
      if (!mr) return { statusCode: 404, body: { statusCode: 404, message: 'Not found' } };
      const data = await executiveDecide(mr, req.user, {
        method: req.body.method || 'PURCHASE_ORDER',
        remark: req.body.remark.trim(),
      });
      return { statusCode: 200, body: { data } };
    }, next);
  }
);

router.post(
  '/:id/coordinator-review',
  requireRoles(UserRole.COORDINATOR),
  [
    param('id').isMongoId(),
    body('action').isIn(['approve', 'reject']),
    body('method').optional().isIn(['PURCHASE_ORDER', 'BRANCH_TRANSFER']),
    body('remark').trim().notEmpty().withMessage('Remark is required'),
    body('fromProjectId').optional().isMongoId(),
  ],
  validate,
  async (req, res, next) => {
    return handleIdempotent(
      req,
      res,
      `proc-coord:${req.params.id}:${req.body.action}:${req.body.method || 'default'}`,
      async () => {
        const mr = await loadDecisionIndent(req.params.id);
        if (!mr) return { statusCode: 404, body: { statusCode: 404, message: 'Not found' } };
        const data = await coordinatorReview(mr, req.user, {
          action: req.body.action,
          method: req.body.method,
          remark: req.body.remark.trim(),
          fromProjectId: req.body.fromProjectId,
        });
        return { statusCode: 200, body: { data } };
      },
      next
    );
  }
);

module.exports = router;
