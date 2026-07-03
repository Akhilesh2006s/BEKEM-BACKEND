const express = require('express');
const { param, query } = require('express-validator');
const { UserRole } = require('@afios/shared');
const { AuditLog, PurchaseOrder, WorkOrder, MaterialIssue } = require('../models');
const { authenticate } = require('../middleware/auth');
const { requireCapability } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { serializeAuditLog, serializePurchaseOrder } = require('../utils/serializeProcurement');
const { serializeWorkOrder } = require('../utils/serializeWorkOrder');
const statusHistoryService = require('../services/statusHistoryService');
const { getBudgetVsActual } = require('../services/dashboardService');
const {
  generateAuditLogPdf,
  generatePurchaseOrderPdf,
  generateBudgetPdf,
  generateWorkOrderPdf,
  generateMaterialIssuePdf,
} = require('../services/pdfService');

const router = express.Router();
router.use(authenticate);

const PO_PDF_AFTER_COORDINATOR_STATUSES = ['APPROVED'];

const poPopulate = [
  { path: 'vendorId' },
  {
    path: 'purchaseRequestId',
    populate: [{ path: 'projectId' }, { path: 'materialRequestId' }],
  },
  { path: 'quotationId', populate: { path: 'vendorId' } },
];

router.get(
  '/audit-logs.pdf',
  requireCapability('VIEW_AUDIT_LOGS'),
  [
    query('entityType').optional().trim(),
    query('entityId').optional().isMongoId(),
    query('action').optional().trim(),
    query('from').optional().isISO8601(),
    query('to').optional().isISO8601(),
    query('limit').optional().isInt({ min: 1, max: 500 }),
  ],
  validate,
  async (req, res, next) => {
    try {
      const filter = {};
      if (req.query.entityType) filter.entityType = req.query.entityType;
      if (req.query.entityId) filter.entityId = req.query.entityId;
      if (req.query.action) {
        filter.action = new RegExp(
          req.query.action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
          'i'
        );
      }
      if (req.query.from || req.query.to) {
        filter.timestamp = {};
        if (req.query.from) filter.timestamp.$gte = new Date(req.query.from);
        if (req.query.to) filter.timestamp.$lte = new Date(req.query.to);
      }

      const limit = parseInt(req.query.limit, 10) || 200;
      const logs = await AuditLog.find(filter)
        .sort({ timestamp: -1 })
        .limit(limit)
        .populate('actorUserId', 'name role');

      const serialized = logs.map(serializeAuditLog);
      generateAuditLogPdf(serialized, {
        entityType: req.query.entityType,
        action: req.query.action,
        from: req.query.from,
        to: req.query.to,
      })(res);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/purchase-orders/:id.pdf',
  requireCapability('VIEW_ALL_PROJECTS'),
  param('id').isMongoId(),
  validate,
  async (req, res, next) => {
    try {
      const po = await PurchaseOrder.findById(req.params.id).populate(poPopulate);
      if (!po) return res.status(404).json({ statusCode: 404, message: 'Not found' });

      if (
        req.user.role === UserRole.EXECUTIVE &&
        !PO_PDF_AFTER_COORDINATOR_STATUSES.includes(po.status)
      ) {
        return res.status(403).json({
          statusCode: 403,
          message: 'PO PDF is available after coordinator verification',
        });
      }

      const timeline = await statusHistoryService.getTimeline('PurchaseOrder', po._id);
      const serializedTimeline = timeline.map((t) => ({
        fromStatus: t.fromStatus,
        toStatus: t.toStatus,
        actorName: t.actorUserId?.name || 'System',
        note: t.note,
        timestamp: t.timestamp?.toISOString?.() || '',
      }));
      const serialized = serializePurchaseOrder(po);
      generatePurchaseOrderPdf(serialized)(res);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/budget-vs-actual.pdf',
  requireCapability('VIEW_FINANCE'),
  async (req, res, next) => {
    try {
      const rows = await getBudgetVsActual(req.user);
      generateBudgetPdf(rows, new Date().toLocaleString())(res);
    } catch (err) {
      next(err);
    }
  }
);

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
];

router.get(
  '/work-orders/:id.pdf',
  param('id').isMongoId(),
  validate,
  async (req, res, next) => {
    try {
      const wo = await WorkOrder.findById(req.params.id).populate(woPopulate);
      if (!wo) return res.status(404).json({ statusCode: 404, message: 'Not found' });

      const timeline = await statusHistoryService.getTimeline('WorkOrder', wo._id);
      const serializedTimeline = timeline.map((t) => ({
        fromStatus: t.fromStatus,
        toStatus: t.toStatus,
        actorName: t.actorUserId?.name || 'System',
        note: t.note,
        timestamp: t.timestamp?.toISOString?.() || '',
      }));
      generateWorkOrderPdf(serializeWorkOrder(wo), serializedTimeline)(res);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/material-issues/:id.pdf',
  requireCapability('ISSUE_MATERIAL'),
  param('id').isMongoId(),
  validate,
  async (req, res, next) => {
    try {
      const issue = await MaterialIssue.findById(req.params.id).populate([
        { path: 'items.materialId' },
        { path: 'siteId' },
        { path: 'materialRequestId', select: 'indentNumber' },
        { path: 'issuedByUserId', select: 'name' },
      ]);
      if (!issue) return res.status(404).json({ statusCode: 404, message: 'Not found' });

      const serialized = {
        issueNumber: issue.issueNumber,
        note: issue.note,
        createdAt: issue.createdAt?.toISOString?.(),
        materialRequest: issue.materialRequestId
          ? { indentNumber: issue.materialRequestId.indentNumber }
          : undefined,
        site: issue.siteId
          ? { name: issue.siteId.name, chainageLabel: issue.siteId.chainageLabel }
          : undefined,
        issuedBy: issue.issuedByUserId ? { name: issue.issuedByUserId.name } : undefined,
        items: issue.items.map((item) => ({
          quantity: item.quantity,
          material: item.materialId
            ? {
                name: item.materialId.name,
                unit: item.materialId.unit,
                hsnCode: item.materialId.hsnCode,
              }
            : undefined,
        })),
      };

      generateMaterialIssuePdf(serialized)(res);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
