const express = require('express');
const { body, param } = require('express-validator');
const { UserRole } = require('@afios/shared');
const {
  PurchaseOrder,
  PurchaseRequest,
  Quotation,
  RFQ,
  User,
} = require('../models');
const { authenticate } = require('../middleware/auth');
const { requireCapability } = require('../middleware/rbac');
const { requireFinalApproval } = require('../middleware/approvalAuth');
const delegationService = require('../services/delegationService');
const { validate } = require('../middleware/validate');
const statusHistoryService = require('../services/statusHistoryService');
const notificationService = require('../services/notificationService');
const {
  runSideEffect,
  recordPoStatusHistory,
  notifyChairmen,
  notifyExecutivesReturned,
  coordinatorVerifyPurchaseOrder,
  pmApprovePurchaseOrder,
  finalizePurchaseOrder,
} = require('../services/poVerifySideEffects');
const { userCanAccessProject } = require('../utils/serialize');
const {
  ensureRfqAndQuotations,
  createPurchaseOrderFromWizard,
  createPurchaseOrdersFromWizardBatch,
  buildConsigneeAddress,
  buildLineItemsFromIndent,
} = require('../services/procurementService');
const { BEKEM_BUYER_ADDRESS } = require('../constants/bekemAddresses');
const {
  serializePurchaseOrder,
  serializeQuotation,
} = require('../utils/serializeProcurement');
const { generatePoNumber } = require('../services/documentNumberService');

const router = express.Router();
router.use(authenticate);

const poPopulate = [
  { path: 'vendorId' },
  {
    path: 'purchaseRequestId',
    populate: [{ path: 'projectId' }, { path: 'materialRequestId' }],
  },
  { path: 'quotationId', populate: { path: 'vendorId' } },
];

router.get('/', async (req, res, next) => {
  try {
    const { status, queue } = req.query;
    const filter = {};

    if (queue === 'coordinator') {
      filter.status = { $in: ['PENDING_REVIEW', 'COORDINATOR_PENDING'] };
    } else if (queue === 'chairman') {
      filter.status = { $in: ['PENDING_APPROVAL', 'CHAIRMAN_PENDING'] };
    } else if (queue === 'pm') {
      filter.status = 'PM_PENDING';
    } else if (queue === 'executive') {
      filter.status = {
        $in: ['DRAFT', 'PENDING_REVIEW', 'PM_PENDING', 'COORDINATOR_PENDING', 'CHAIRMAN_PENDING'],
      };
    } else if (status) {
      filter.status = status;
    }

    let orders = await PurchaseOrder.find(filter)
      .sort({ createdAt: -1 })
      .populate(poPopulate);

    if (queue === 'pm' && req.user.role === UserRole.PROJECT_MANAGER) {
      orders = orders.filter((po) => {
        const projectId =
          po.purchaseRequestId?.projectId?._id || po.purchaseRequestId?.projectId;
        return userCanAccessProject(req.user, projectId);
      });
    }

    res.json({ data: orders.map(serializePurchaseOrder) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', param('id').isMongoId(), validate, async (req, res, next) => {
  try {
    const po = await PurchaseOrder.findById(req.params.id).populate(poPopulate);
    if (!po) return res.status(404).json({ statusCode: 404, message: 'Not found' });

    let quotations = [];
    const pr = await PurchaseRequest.findById(po.purchaseRequestId);
    if (pr) {
      const rfq = await RFQ.findOne({ purchaseRequestId: pr._id });
      if (rfq) {
        quotations = await Quotation.find({ rfqId: rfq._id }).populate('vendorId');
      }
    }

    res.json({
      data: serializePurchaseOrder(po),
      quotations: quotations.map(serializeQuotation),
    });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/wizard/preview-quotations',
  requireCapability('CREATE_PO'),
  [body('purchaseRequestId').isMongoId()],
  validate,
  async (req, res, next) => {
    try {
      const pr = await PurchaseRequest.findById(req.body.purchaseRequestId).populate('projectId');
      if (!pr) return res.status(404).json({ statusCode: 404, message: 'PR not found' });
      let materialIds = [];
      if (pr.materialRequestId) {
        const mr = await require('../models').MaterialRequest.findById(pr.materialRequestId);
        if (mr) {
          materialIds = require('../services/materialRequestHelpers')
            .getIndentLineItems(mr)
            .map((i) => (i.materialId?._id || i.materialId)?.toString())
            .filter(Boolean);
        }
      }
      const { quotations } = await ensureRfqAndQuotations(
        pr,
        pr.projectId.code,
        req.user._id,
        materialIds
      );

      let deliveryAddress = '';
      let lineItems = [];
      let subtotal = pr.amountEstimate || 0;
      if (pr.materialRequestId) {
        const mr = await require('../models').MaterialRequest.findById(pr.materialRequestId)
          .populate('items.materialId')
          .populate('siteId');
        if (mr) {
          deliveryAddress = await buildConsigneeAddress(mr);
          const built = await buildLineItemsFromIndent(mr, pr.amountEstimate);
          lineItems = built.lineItems;
          subtotal = built.subtotal;
        }
      }

      res.json({
        data: quotations.map(serializeQuotation),
        deliveryAddress,
        billingAddress: BEKEM_BUYER_ADDRESS,
        lineItems,
        subtotal,
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/wizard/batch',
  requireCapability('CREATE_PO'),
  [
    body('paymentTerms').trim().notEmpty(),
    body('materialRequestId').optional().isMongoId(),
    body('purchaseRequestId').optional().isMongoId(),
    body('billingAddress').optional().isString(),
    body('deliveryAddress').optional().isString(),
    body('expectedDeliveryDate').optional().isISO8601(),
    body('referenceNote').optional().isString(),
    body('orders').isArray({ min: 1 }),
    body('orders.*.vendorId').isMongoId(),
    body('orders.*.lineItems').isArray({ min: 1 }),
    body('orders.*.lineItems.*.description').optional().isString(),
    body('orders.*.lineItems.*.materialId').optional().isMongoId(),
    body('orders.*.lineItems.*.hsnCode').optional().isString(),
    body('orders.*.lineItems.*.quantity').optional().isFloat({ min: 0 }),
    body('orders.*.lineItems.*.rate').optional().isFloat({ min: 0 }),
    body('orders.*.lineItems.*.gstPercent').optional().isFloat({ min: 0 }),
    body('orders.*.lineItems.*.amount').optional().isFloat({ min: 0 }),
    body('orders.*.attachments').optional().isArray(),
    body('orders.*.attachments.*.name').optional().isString(),
    body('orders.*.attachments.*.fileType').optional().isString(),
    body('orders.*.attachments.*.category').optional().isString(),
  ],
  validate,
  async (req, res, next) => {
    try {
      if (!req.body.materialRequestId && !req.body.purchaseRequestId) {
        return res.status(400).json({
          statusCode: 400,
          message: 'materialRequestId or purchaseRequestId required',
        });
      }

      const results = await createPurchaseOrdersFromWizardBatch({
        materialRequestId: req.body.materialRequestId,
        purchaseRequestId: req.body.purchaseRequestId,
        orders: req.body.orders,
        paymentTerms: req.body.paymentTerms,
        billingAddress: req.body.billingAddress,
        deliveryAddress: req.body.deliveryAddress,
        expectedDeliveryDate: req.body.expectedDeliveryDate,
        referenceNote: req.body.referenceNote,
        actorUserId: req.user._id,
      });

      const populated = await Promise.all(
        results.map((r) => PurchaseOrder.findById(r.po._id).populate(poPopulate))
      );

      res.status(201).json({
        data: populated.map(serializePurchaseOrder),
        count: populated.length,
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/wizard',
  requireCapability('CREATE_PO'),
  [
    body('vendorId').isMongoId(),
    body('paymentTerms').trim().notEmpty(),
    body('materialRequestId').optional().isMongoId(),
    body('purchaseRequestId').optional().isMongoId(),
    body('billingAddress').optional().isString(),
    body('deliveryAddress').optional().isString(),
    body('expectedDeliveryDate').optional().isISO8601(),
    body('referenceNote').optional().isString(),
    body('lineItems').optional().isArray(),
    body('lineItems.*.description').optional().isString(),
    body('lineItems.*.materialId').optional().isMongoId(),
    body('lineItems.*.hsnCode').optional().isString(),
    body('lineItems.*.quantity').optional().isFloat({ min: 0 }),
    body('lineItems.*.rate').optional().isFloat({ min: 0 }),
    body('lineItems.*.gstPercent').optional().isFloat({ min: 0 }),
    body('lineItems.*.amount').optional().isFloat({ min: 0 }),
    body('attachments').optional().isArray(),
    body('attachments.*.name').optional().isString(),
    body('attachments.*.fileType').optional().isString(),
    body('attachments.*.url').optional().isString(),
  ],
  validate,
  async (req, res, next) => {
    try {
      if (!req.body.materialRequestId && !req.body.purchaseRequestId) {
        return res.status(400).json({
          statusCode: 400,
          message: 'materialRequestId or purchaseRequestId required',
        });
      }

      const result = await createPurchaseOrderFromWizard({
        materialRequestId: req.body.materialRequestId,
        purchaseRequestId: req.body.purchaseRequestId,
        vendorId: req.body.vendorId,
        paymentTerms: req.body.paymentTerms,
        billingAddress: req.body.billingAddress,
        deliveryAddress: req.body.deliveryAddress,
        expectedDeliveryDate: req.body.expectedDeliveryDate,
        referenceNote: req.body.referenceNote,
        lineItems: req.body.lineItems,
        attachments: req.body.attachments,
        actorUserId: req.user._id,
      });

      req.auditEntityType = 'PurchaseOrder';
      req.auditEntityId = result.po._id;

      const populated = await PurchaseOrder.findById(result.po._id).populate(poPopulate);
      res.status(201).json({
        data: serializePurchaseOrder(populated),
        quotations: result.quotations.map(serializeQuotation),
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/verify',
  requireCapability('VERIFY_RECORDS'),
  [
    param('id').isMongoId(),
    body('action').isIn(['APPROVE', 'RETURN', 'CLARIFICATION']),
    body('note').optional().trim(),
    body('chairmanUnavailable').optional().isBoolean(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const po = await PurchaseOrder.findById(req.params.id).populate({
        path: 'purchaseRequestId',
        populate: { path: 'materialRequestId' },
      });
      if (!po) return res.status(404).json({ statusCode: 404, message: 'Not found' });
      if (!['PENDING_REVIEW', 'COORDINATOR_PENDING'].includes(po.status)) {
        return res.status(400).json({ statusCode: 400, message: 'PO not pending verification' });
      }

      const fromStatus = po.status;

      if (req.body.action === 'APPROVE') {
        await coordinatorVerifyPurchaseOrder(
          po,
          req.user._id,
          req.body.note || 'Coordinator verified',
          { chairmanUnavailable: req.body.chairmanUnavailable === true }
        );
      } else if (req.body.action === 'RETURN') {
        po.status = 'DRAFT';
        await po.save();
        await runSideEffect('PO status history', () =>
          recordPoStatusHistory(po, fromStatus, 'DRAFT', req.user._id, req.body.note || req.body.action)
        );
        await runSideEffect('Executive notification', () => notifyExecutivesReturned(po));
      } else {
        await runSideEffect('PO status history', () =>
          recordPoStatusHistory(po, fromStatus, po.status, req.user._id, req.body.note || req.body.action)
        );
      }

      req.auditEntityType = 'PurchaseOrder';
      req.auditEntityId = po._id;

      const populated = await PurchaseOrder.findById(po._id).populate(poPopulate);
      res.json({ data: serializePurchaseOrder(populated) });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
      }
      next(err);
    }
  }
);

router.post(
  '/:id/pm-approve',
  requireCapability('APPROVE_MATERIAL_REQUEST'),
  [param('id').isMongoId(), body('note').optional().trim()],
  validate,
  async (req, res, next) => {
    try {
      if (req.user.role !== UserRole.PROJECT_MANAGER) {
        return res.status(403).json({ statusCode: 403, message: 'Project Manager only' });
      }

      const po = await PurchaseOrder.findById(req.params.id).populate({
        path: 'purchaseRequestId',
        populate: [{ path: 'projectId' }, { path: 'materialRequestId' }],
      });
      if (!po) return res.status(404).json({ statusCode: 404, message: 'Not found' });

      const projectId =
        po.purchaseRequestId?.projectId?._id || po.purchaseRequestId?.projectId;
      if (!userCanAccessProject(req.user, projectId)) {
        return res.status(403).json({ statusCode: 403, message: 'Not your project' });
      }

      await pmApprovePurchaseOrder(po, req.user._id, req.body.note);
      const populated = await PurchaseOrder.findById(po._id).populate(poPopulate);
      res.json({ data: serializePurchaseOrder(populated) });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
      }
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
      const po = await PurchaseOrder.findById(req.params.id).populate({
        path: 'purchaseRequestId',
        populate: { path: 'materialRequestId' },
      });
      if (!po) return res.status(404).json({ statusCode: 404, message: 'Not found' });
      if (!['PENDING_APPROVAL', 'CHAIRMAN_PENDING'].includes(po.status)) {
        return res.status(400).json({ statusCode: 400, message: 'PO not awaiting final approval' });
      }

      const fromStatus = po.status;
      await finalizePurchaseOrder(
        po,
        req.user._id,
        delegationService.formatApprovalNote(req.body.note || 'Final approval', req.approvalContext),
        req.approvalContext
      );

      const populated = await PurchaseOrder.findById(po._id).populate(poPopulate);
      res.json({ data: serializePurchaseOrder(populated) });
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
      const po = await PurchaseOrder.findById(req.params.id);
      if (!po) return res.status(404).json({ statusCode: 404, message: 'Not found' });
      if (!['PENDING_APPROVAL', 'CHAIRMAN_PENDING'].includes(po.status)) {
        return res.status(400).json({ statusCode: 400, message: 'PO not awaiting chairman approval' });
      }

      const fromStatus = po.status;
      po.status = 'REJECTED';
      await po.save();

      const note = delegationService.formatApprovalNote(req.body.note, req.approvalContext);

      await statusHistoryService.record(
        'PurchaseOrder',
        po._id,
        fromStatus,
        'REJECTED',
        req.user._id,
        note
      );

      const populated = await PurchaseOrder.findById(po._id).populate(poPopulate);
      res.json({ data: serializePurchaseOrder(populated) });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
