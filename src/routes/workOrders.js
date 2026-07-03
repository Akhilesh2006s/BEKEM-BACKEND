const express = require('express');
const { body, param } = require('express-validator');
const { UserRole } = require('@afios/shared');
const { WorkOrder, User } = require('../models');
const { authenticate } = require('../middleware/auth');
const { requireCapability, requireRoles } = require('../middleware/rbac');
const { requireFinalApproval } = require('../middleware/approvalAuth');
const { validate } = require('../middleware/validate');
const statusHistoryService = require('../services/statusHistoryService');
const notificationService = require('../services/notificationService');
const workOrderService = require('../services/workOrderService');
const { serializeWorkOrder } = require('../utils/serializeWorkOrder');

const router = express.Router();
router.use(authenticate);

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

router.get('/', async (req, res, next) => {
  try {
    const { status, queue, projectId } = req.query;
    const filter = {};

    if (queue === 'coordinator') {
      filter.status = { $in: ['COORDINATOR_PENDING', 'CHAIRMAN_PENDING'] };
    } else if (queue === 'chairman') {
      filter.status = 'CHAIRMAN_PENDING';
    } else if (queue === 'executive') {
      filter.status = { $in: ['PENDING_ACCEPTANCE', 'DRAFT'] };
    } else if (queue === 'store') {
      filter.status = { $in: ['ACCEPTED', 'IN_PROGRESS'] };
    } else if (queue === 'pm') {
      filter.status = { $in: ['ACCEPTED', 'IN_PROGRESS'] };
      if (projectId) filter.projectId = projectId;
      else if (req.user.role === UserRole.PROJECT_MANAGER && req.user.assignedProjectIds?.length) {
        filter.projectId = { $in: req.user.assignedProjectIds };
      }
    } else if (queue === 'site') {
      filter.status = { $in: ['ACCEPTED', 'IN_PROGRESS'] };
      if (req.user.assignedSiteId) filter.siteId = req.user.assignedSiteId;
    } else if (status) {
      filter.status = status;
    }

    if (req.user.role === UserRole.PROJECT_MANAGER && !queue && !status) {
      filter.projectId = { $in: req.user.assignedProjectIds || [] };
    }
    if (req.user.role === UserRole.SITE_INCHARGE && req.user.assignedSiteId && !queue) {
      filter.siteId = req.user.assignedSiteId;
    }
    if (req.user.role === UserRole.STORE_INCHARGE && req.user.assignedSiteId && queue !== 'store') {
      filter.siteId = req.user.assignedSiteId;
    }

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
    res.json({ data: serializeWorkOrder(wo) });
  } catch (err) {
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
    try {
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

      const populated = await WorkOrder.findById(wo._id).populate(woPopulate);
      res.status(201).json({ data: serializeWorkOrder(populated) });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
      next(err);
    }
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
    try {
      const wo = await WorkOrder.findById(req.params.id);
      if (!wo) return res.status(404).json({ statusCode: 404, message: 'Not found' });
      if (wo.status !== 'COORDINATOR_PENDING') {
        return res.status(400).json({ statusCode: 400, message: 'Work order not pending verification' });
      }

      const fromStatus = wo.status;
      if (req.body.action === 'APPROVE') {
        wo.status = 'PENDING_ACCEPTANCE';
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
        const executives = await User.find({ role: UserRole.EXECUTIVE });
        for (const e of executives) {
          await notificationService.notifyUser(e._id, {
            title: 'Work order approved',
            body: `${wo.woNumber} is ready for contractor acceptance.`,
            relatedEntityType: 'WorkOrder',
            relatedEntityId: wo._id,
          });
        }
      }

      req.auditEntityType = 'WorkOrder';
      req.auditEntityId = wo._id;

      const populated = await WorkOrder.findById(wo._id).populate(woPopulate);
      res.json({ data: serializeWorkOrder(populated) });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/approve',
  requireFinalApproval(),
  [param('id').isMongoId(), body('note').optional().trim()],
  validate,
  async (req, res, next) => {
    try {
      const wo = await WorkOrder.findById(req.params.id);
      if (!wo) return res.status(404).json({ statusCode: 404, message: 'Not found' });
      if (wo.status !== 'CHAIRMAN_PENDING') {
        return res.status(400).json({ statusCode: 400, message: 'Work order not awaiting chairman approval' });
      }

      const fromStatus = wo.status;
      wo.status = 'PENDING_ACCEPTANCE';
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

      const populated = await WorkOrder.findById(wo._id).populate(woPopulate);
      res.json({ data: serializeWorkOrder(populated) });
    } catch (err) {
      next(err);
    }
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
  '/:id/issue-material',
  requireCapability('ISSUE_WO_MATERIAL'),
  [
    param('id').isMongoId(),
    body('materialId').isMongoId(),
    body('quantity').isFloat({ min: 0.01 }),
  ],
  validate,
  async (req, res, next) => {
    try {
      const wo = await workOrderService.issueMaterial({
        workOrderId: req.params.id,
        materialId: req.body.materialId,
        quantity: req.body.quantity,
        actorUserId: req.user._id,
        siteId: req.user.assignedSiteId,
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
  '/:id/certify',
  requireCapability('CERTIFY_WO_WORK'),
  [
    param('id').isMongoId(),
    body('quantity').isFloat({ min: 0.01 }),
    body('note').trim().notEmpty(),
    body('evidenceNote').optional().trim(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const wo = await workOrderService.certifyWork({
        workOrderId: req.params.id,
        quantity: req.body.quantity,
        note: req.body.note,
        evidenceNote: req.body.evidenceNote,
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
  '/:id/certifications/:certId/verify',
  requireCapability('TRACK_WO_PROGRESS'),
  [
    param('id').isMongoId(),
    param('certId').isMongoId(),
    body('action').isIn(['VERIFY', 'REJECT']),
    body('pmNote').optional().trim(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const wo = await workOrderService.verifyCertification({
        workOrderId: req.params.id,
        certificationId: req.params.certId,
        action: req.body.action,
        pmNote: req.body.pmNote,
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
      next(err);
    }
  }
);

module.exports = router;
