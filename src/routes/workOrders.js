const express = require('express');
const { body, param } = require('express-validator');
const { UserRole } = require('@afios/shared');
const { WorkOrder, User } = require('../models');
const { authenticate } = require('../middleware/auth');
const { requireCapability, requireRoles } = require('../middleware/rbac');
const { requireFinalApproval } = require('../middleware/approvalAuth');
const { validate } = require('../middleware/validate');
const {
  rejectStoreSiteForWorkOrders,
  assertCanAccessProject,
  seesAllProjects,
} = require('../middleware/projectScope');
const statusHistoryService = require('../services/statusHistoryService');
const notificationService = require('../services/notificationService');
const workOrderService = require('../services/workOrderService');
const { userManagesProject } = require('../services/branchTransferService');
const { serializeWorkOrder } = require('../utils/serializeWorkOrder');
const { handleIdempotent } = require('../utils/idempotentHandler');

const PM_APPROVED_STATUSES = [
  'EXECUTIVE_PENDING',
  'COORDINATOR_PENDING',
  'CHAIRMAN_PENDING',
  'PENDING_ACCEPTANCE',
  'ACCEPTED',
  'CLOSED',
];
const EXECUTIVE_APPROVED_STATUSES = [
  'COORDINATOR_PENDING',
  'CHAIRMAN_PENDING',
  'PENDING_ACCEPTANCE',
  'ACCEPTED',
  'CLOSED',
];
const COORDINATOR_VERIFIED_STATUSES = [
  'CHAIRMAN_PENDING',
  'PENDING_ACCEPTANCE',
  'ACCEPTED',
  'CLOSED',
];
const CHAIRMAN_APPROVED_STATUSES = ['PENDING_ACCEPTANCE', 'ACCEPTED', 'CLOSED'];

async function woResponse(woId, statusCode = 200) {
  const populated = await WorkOrder.findById(woId).populate(woPopulate);
  return { statusCode, body: { data: serializeWorkOrder(populated) } };
}

const router = express.Router();
router.use(authenticate);
router.use(rejectStoreSiteForWorkOrders);

const woPopulate = [
  { path: 'vendorId' },
  { path: 'projectId' },
  { path: 'siteId' },
  {
    path: 'purchaseOrderId',
    populate: {
      path: 'purchaseRequestId',
      populate: [{ path: 'projectId' }, { path: 'materialRequestId' }],
    },
  },
  { path: 'materialIssues.materialId' },
  { path: 'materialIssues.issuedByUserId', select: 'name' },
  { path: 'certifications.certifiedByUserId', select: 'name' },
];

function workOrderListFilter(user, query) {
  const { status, queue, projectId } = query;
  const filter = {};

  if (queue === 'pm') {
    filter.status = 'PM_PENDING';
    if (!seesAllProjects(user.role)) {
      filter.projectId = { $in: user.assignedProjectIds || [] };
    }
  } else if (queue === 'executive') {
    filter.status = 'EXECUTIVE_PENDING';
  } else if (queue === 'coordinator') {
    filter.status = 'COORDINATOR_PENDING';
  } else if (queue === 'chairman') {
    filter.status = 'CHAIRMAN_PENDING';
  } else if (queue === 'acceptance') {
    filter.status = 'PENDING_ACCEPTANCE';
  } else if (status) {
    filter.status = status;
  }

  if (!seesAllProjects(user.role)) {
    if (user.role === UserRole.PROJECT_MANAGER) {
      filter.projectId = filter.projectId || { $in: user.assignedProjectIds || [] };
    }
  } else if (projectId) {
    filter.projectId = projectId;
  }

  return filter;
}

router.get('/', async (req, res, next) => {
  try {
    const filter = workOrderListFilter(req.user, req.query);
    const orders = await WorkOrder.find(filter).sort({ createdAt: -1 }).populate(woPopulate);
    res.json({ data: orders.map(serializeWorkOrder) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', param('id').isMongoId(), validate, async (req, res, next) => {
  try {
    const wo = await WorkOrder.findById(req.params.id).populate(woPopulate);
    if (!wo) return res.status(404).json({ statusCode: 404, message: 'Not found' });
    assertCanAccessProject(req.user, wo.projectId?._id || wo.projectId);
    res.json({ data: serializeWorkOrder(wo) });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
    next(err);
  }
});

router.post(
  '/',
  requireCapability('CREATE_WORK_ORDER'),
  [
    body('purchaseOrderId').isMongoId(),
    body('scope').trim().notEmpty(),
    body('totalQuantity').isFloat({ min: 1 }),
    body('quantityUnit').trim().notEmpty(),
    body('siteId').optional().isMongoId(),
  ],
  validate,
  async (req, res, next) => {
    return handleIdempotent(req, res, `wo-create:${req.body.purchaseOrderId}`, async () => {
      const wo = await workOrderService.createFromPurchaseOrder({
        purchaseOrderId: req.body.purchaseOrderId,
        scope: req.body.scope,
        totalQuantity: req.body.totalQuantity,
        quantityUnit: req.body.quantityUnit,
        siteId: req.body.siteId,
        actorUserId: req.user._id,
      });

      req.auditEntityType = 'WorkOrder';
      req.auditEntityId = wo._id;

      return woResponse(wo._id, 201);
    }, next);
  }
);

router.post(
  '/:id/pm-approve',
  requireCapability('APPROVE_MATERIAL_REQUEST'),
  [param('id').isMongoId(), body('note').optional().trim()],
  validate,
  async (req, res, next) => {
    return handleIdempotent(req, res, `wo-pm-approve:${req.params.id}`, async () => {
      const wo = await WorkOrder.findById(req.params.id);
      if (!wo) return { statusCode: 404, body: { statusCode: 404, message: 'Not found' } };
      assertCanAccessProject(req.user, wo.projectId);
      if (wo.status !== 'PM_PENDING') {
        if (PM_APPROVED_STATUSES.includes(wo.status)) return woResponse(wo._id);
        return { statusCode: 400, body: { statusCode: 400, message: 'Work order not awaiting PM approval' } };
      }
      if (!userManagesProject(req.user, wo.projectId)) {
        return { statusCode: 403, body: { statusCode: 403, message: 'Only assigned project PM can approve' } };
      }

      const fromStatus = wo.status;
      wo.status = 'EXECUTIVE_PENDING';
      wo.pmApprovedByUserId = req.user._id;
      wo.pmApprovedAt = new Date();
      await wo.save();

      await statusHistoryService.record(
        'WorkOrder',
        wo._id,
        fromStatus,
        wo.status,
        req.user._id,
        req.body.note || 'PM approved work order'
      );

      const executives = await User.find({ role: UserRole.EXECUTIVE });
      for (const e of executives) {
        await notificationService.notifyUser(e._id, {
          title: 'Work order pending executive review',
          body: `${wo.woNumber} requires executive review.`,
          relatedEntityType: 'WorkOrder',
          relatedEntityId: wo._id,
        });
      }

      return woResponse(wo._id);
    }, next);
  }
);

router.post(
  '/:id/executive-review',
  requireCapability('CREATE_WORK_ORDER'),
  [
    param('id').isMongoId(),
    body('action').isIn(['APPROVE', 'RETURN']),
    body('note').optional().trim(),
  ],
  validate,
  async (req, res, next) => {
    return handleIdempotent(req, res, `wo-executive-review:${req.params.id}:${req.body.action}`, async () => {
      const wo = await WorkOrder.findById(req.params.id);
      if (!wo) return { statusCode: 404, body: { statusCode: 404, message: 'Not found' } };
      if (wo.status !== 'EXECUTIVE_PENDING') {
        if (req.body.action === 'APPROVE' && EXECUTIVE_APPROVED_STATUSES.includes(wo.status)) {
          return woResponse(wo._id);
        }
        return { statusCode: 400, body: { statusCode: 400, message: 'Work order not awaiting executive review' } };
      }

      const fromStatus = wo.status;
      if (req.body.action === 'APPROVE') {
        wo.status = 'COORDINATOR_PENDING';
        wo.executiveReviewedByUserId = req.user._id;
        wo.executiveReviewedAt = new Date();
      } else {
        wo.status = 'DRAFT';
      }
      await wo.save();

      await statusHistoryService.record(
        'WorkOrder',
        wo._id,
        fromStatus,
        wo.status,
        req.user._id,
        req.body.note || req.body.action
      );

      if (req.body.action === 'APPROVE') {
        const coordinators = await User.find({ role: UserRole.COORDINATOR });
        for (const c of coordinators) {
          await notificationService.notifyUser(c._id, {
            title: 'Work order pending verification',
            body: `${wo.woNumber} requires coordinator verification.`,
            relatedEntityType: 'WorkOrder',
            relatedEntityId: wo._id,
          });
        }
      }

      return woResponse(wo._id);
    }, next);
  }
);

router.post(
  '/:id/verify',
  requireCapability('VERIFY_RECORDS'),
  [
    param('id').isMongoId(),
    body('action').isIn(['APPROVE', 'RETURN']),
    body('note').optional().trim(),
  ],
  validate,
  async (req, res, next) => {
    return handleIdempotent(req, res, `wo-verify:${req.params.id}:${req.body.action}`, async () => {
      const wo = await WorkOrder.findById(req.params.id);
      if (!wo) return { statusCode: 404, body: { statusCode: 404, message: 'Not found' } };
      if (wo.status !== 'COORDINATOR_PENDING') {
        if (req.body.action === 'APPROVE' && COORDINATOR_VERIFIED_STATUSES.includes(wo.status)) {
          return woResponse(wo._id);
        }
        return { statusCode: 400, body: { statusCode: 400, message: 'Work order not pending verification' } };
      }

      const fromStatus = wo.status;
      if (req.body.action === 'APPROVE') {
        wo.status = 'CHAIRMAN_PENDING';
        wo.coordinatorVerifiedByUserId = req.user._id;
        wo.coordinatorVerifiedAt = new Date();
      } else {
        wo.status = 'EXECUTIVE_PENDING';
      }
      await wo.save();

      await statusHistoryService.record(
        'WorkOrder',
        wo._id,
        fromStatus,
        wo.status,
        req.user._id,
        req.body.note || req.body.action
      );

      if (req.body.action === 'APPROVE') {
        const chairmen = await User.find({ role: UserRole.CHAIRMAN });
        for (const c of chairmen) {
          await notificationService.notifyUser(c._id, {
            title: 'Work order awaiting final approval',
            body: `${wo.woNumber} requires chairman approval.`,
            relatedEntityType: 'WorkOrder',
            relatedEntityId: wo._id,
          });
        }
      }

      req.auditEntityType = 'WorkOrder';
      req.auditEntityId = wo._id;

      return woResponse(wo._id);
    }, next);
  }
);

router.post(
  '/:id/approve',
  requireFinalApproval(),
  [param('id').isMongoId(), body('note').optional().trim()],
  validate,
  async (req, res, next) => {
    return handleIdempotent(req, res, `wo-chairman-approve:${req.params.id}`, async () => {
      const wo = await WorkOrder.findById(req.params.id);
      if (!wo) return { statusCode: 404, body: { statusCode: 404, message: 'Not found' } };
      if (wo.status !== 'CHAIRMAN_PENDING') {
        if (CHAIRMAN_APPROVED_STATUSES.includes(wo.status)) return woResponse(wo._id);
        return { statusCode: 400, body: { statusCode: 400, message: 'Work order not awaiting chairman approval' } };
      }

      const fromStatus = wo.status;
      wo.status = 'PENDING_ACCEPTANCE';
      wo.chairmanApprovedByUserId = req.user._id;
      wo.chairmanApprovedAt = new Date();
      await wo.save();

      await statusHistoryService.record(
        'WorkOrder',
        wo._id,
        fromStatus,
        'PENDING_ACCEPTANCE',
        req.user._id,
        req.body.note || 'Chairman approved — awaiting contractor acceptance'
      );

      const executives = await User.find({ role: UserRole.EXECUTIVE });
      for (const e of executives) {
        await notificationService.notifyUser(e._id, {
          title: 'Send work order to contractor',
          body: `${wo.woNumber} approved — record contractor acceptance.`,
          relatedEntityType: 'WorkOrder',
          relatedEntityId: wo._id,
        });
      }

      return woResponse(wo._id);
    }, next);
  }
);

router.post(
  '/:id/reject',
  requireFinalApproval(),
  [param('id').isMongoId(), body('note').trim().notEmpty()],
  validate,
  async (req, res, next) => {
    try {
      const wo = await WorkOrder.findById(req.params.id);
      if (!wo) return res.status(404).json({ statusCode: 404, message: 'Not found' });
      if (wo.status !== 'CHAIRMAN_PENDING') {
        return res.status(400).json({ statusCode: 400, message: 'Work order not awaiting chairman approval' });
      }

      const fromStatus = wo.status;
      wo.status = 'REJECTED';
      await wo.save();

      await statusHistoryService.record(
        'WorkOrder',
        wo._id,
        fromStatus,
        'REJECTED',
        req.user._id,
        req.body.note
      );

      const populated = await WorkOrder.findById(wo._id).populate(woPopulate);
      res.json({ data: serializeWorkOrder(populated) });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/accept',
  requireCapability('CREATE_WORK_ORDER'),
  [param('id').isMongoId(), body('note').optional().trim()],
  validate,
  async (req, res, next) => {
    try {
      const wo = await WorkOrder.findById(req.params.id);
      if (!wo) return res.status(404).json({ statusCode: 404, message: 'Not found' });
      if (wo.status !== 'PENDING_ACCEPTANCE') {
        return res.status(400).json({ statusCode: 400, message: 'Work order not awaiting contractor acceptance' });
      }

      const fromStatus = wo.status;
      wo.status = 'ACCEPTED';
      if (wo.milestones.length && wo.milestones[0].status === 'PENDING') {
        wo.milestones[0].status = 'RUNNING';
      }
      await wo.save();

      await statusHistoryService.record(
        'WorkOrder',
        wo._id,
        fromStatus,
        'ACCEPTED',
        req.user._id,
        req.body.note || 'Contractor accepted work order'
      );

      const populated = await WorkOrder.findById(wo._id).populate(woPopulate);
      res.json({ data: serializeWorkOrder(populated) });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/progress',
  requireCapability('TRACK_WO_PROGRESS'),
  [
    param('id').isMongoId(),
    body('completedQuantity').optional().isFloat({ min: 0 }),
    body('milestones').optional().isArray(),
    body('milestones.*.id').optional().isMongoId(),
    body('milestones.*.status').optional().isIn(['PENDING', 'RUNNING', 'COMPLETED']),
  ],
  validate,
  async (req, res, next) => {
    try {
      const wo = await workOrderService.updateProgress({
        workOrderId: req.params.id,
        completedQuantity: req.body.completedQuantity,
        milestones: req.body.milestones,
        actorUserId: req.user._id,
      });

      const populated = await WorkOrder.findById(wo._id).populate(woPopulate);
      res.json({ data: serializeWorkOrder(populated) });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
      next(err);
    }
  }
);

router.post(
  '/:id/close',
  requireRoles(UserRole.PROJECT_MANAGER, UserRole.EXECUTIVE),
  [param('id').isMongoId(), body('note').optional().trim()],
  validate,
  async (req, res, next) => {
    try {
      const wo = await WorkOrder.findById(req.params.id);
      if (!wo) return res.status(404).json({ statusCode: 404, message: 'Not found' });
      assertCanAccessProject(req.user, wo.projectId);
      if (wo.status !== 'IN_PROGRESS') {
        return res.status(400).json({ statusCode: 400, message: 'Only in-progress work orders can be closed' });
      }
      if (wo.progressPercent < 100) {
        return res.status(400).json({ statusCode: 400, message: 'Work order must reach 100% progress before closing' });
      }

      const fromStatus = wo.status;
      wo.status = 'CLOSED';
      await wo.save();

      await statusHistoryService.record(
        'WorkOrder',
        wo._id,
        fromStatus,
        'CLOSED',
        req.user._id,
        req.body.note || 'Work order closed'
      );

      const populated = await WorkOrder.findById(wo._id).populate(woPopulate);
      res.json({ data: serializeWorkOrder(populated) });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
      next(err);
    }
  }
);

module.exports = router;
