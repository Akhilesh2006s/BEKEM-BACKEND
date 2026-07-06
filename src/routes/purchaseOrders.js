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
  coordinatorOverrideApprove,
  pmApprovePurchaseOrder,
  finalizePurchaseOrder,
} = require('../services/poVerifySideEffects');
const { userCanAccessProject } = require('../utils/serialize');
const {
  ensureRfqAndQuotations,
  createPurchaseOrderFromWizard,
  createPurchaseOrdersFromWizardBatch,
  buildLineItemsFromIndent,
} = require('../services/procurementService');
const { buildConsigneeAddress } = require('../services/consigneeAddressService');
const { BEKEM_BUYER_ADDRESS } = require('../constants/bekemAddresses');
const {
  serializePurchaseOrder,
  serializeQuotation,
} = require('../utils/serializeProcurement');
const { updatePurchaseOrderDraft, canEditPurchaseOrder, getPoEditGrnWarnings } = require('../services/poEditService');
const { getPoTimeline } = require('../services/poTimelineService');
const { listPoGrns, canViewGrnVariance } = require('../services/grnFulfillmentService');
const { StatusHistory } = require('../models');
const {
  rejectSitePoAccess,
  requirePoEditRole,
  assertCanViewPurchaseOrder,
  assertCanListPurchaseOrders,
  purchaseOrderListFilter,
  filterPurchaseOrdersForUser,
} = require('../middleware/poAccess');

const router = express.Router();
router.use(authenticate);
router.use(rejectSitePoAccess);

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
    assertCanListPurchaseOrders(req.user, { queue });
    const filter = {};

    if (queue === 'coordinator') {
      const {
        listCoordinatorVerifyPos,
        countCoordinatorVerifyPos,
      } = require('../services/coordinatorPoQueueService');
      const orders = await listCoordinatorVerifyPos();
      return res.json({
        data: orders.map(serializePurchaseOrder),
        meta: { count: await countCoordinatorVerifyPos() },
      });
    } else if (queue === 'chairman') {
      filter.status = 'CHAIRMAN_PENDING';
    } else if (queue === 'pm') {
      filter.status = 'PM_PENDING';
    } else if (queue === 'executive') {
      filter.status = {
        $in: ['DRAFT', 'PENDING_REVIEW', 'PM_PENDING', 'COORDINATOR_PENDING', 'CHAIRMAN_PENDING'],
      };
    } else if (status) {
      filter.status = status;
    }

    const scopedFilter = await purchaseOrderListFilter(req.user, filter);

    let orders = await PurchaseOrder.find(scopedFilter)
      .sort({ createdAt: -1 })
      .populate(poPopulate);

    orders = await filterPurchaseOrdersForUser(req.user, orders);

    res.json({ data: orders.map(serializePurchaseOrder) });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
    next(err);
  }
});

router.get('/:id/timeline', param('id').isMongoId(), validate, async (req, res, next) => {
  try {
    const po = await PurchaseOrder.findById(req.params.id).populate(poPopulate);
    if (!po) return res.status(404).json({ statusCode: 404, message: 'Not found' });
    await assertCanViewPurchaseOrder(req.user, po);
    const timeline = await getPoTimeline(po._id);
    res.json({ data: timeline });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
    next(err);
  }
});

router.get('/:id/grn-counter', param('id').isMongoId(), validate, async (req, res, next) => {
  try {
    const po = await PurchaseOrder.findById(req.params.id);
    if (!po) return res.status(404).json({ statusCode: 404, message: 'Not found' });
    await assertCanViewPurchaseOrder(req.user, po);
    const { peekNextPoGrnNumber } = require('../services/grnCounterService');
    const { getPoGrnReceiptLines } = require('../services/grnFulfillmentService');
    const preview = await peekNextPoGrnNumber(po._id);
    const lines = await getPoGrnReceiptLines(po);
    res.json({
      data: {
        purchaseOrderId: po._id.toString(),
        nextNumber: preview.nextNumber,
        grnNumber: preview.grnNumber,
        lines,
      },
    });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
    next(err);
  }
});

router.get('/:id/grns', param('id').isMongoId(), validate, async (req, res, next) => {
  try {
    const po = await PurchaseOrder.findById(req.params.id).populate(poPopulate);
    if (!po) return res.status(404).json({ statusCode: 404, message: 'Not found' });
    await assertCanViewPurchaseOrder(req.user, po);
    const payload = await listPoGrns(po._id);
    if (!payload) return res.status(404).json({ statusCode: 404, message: 'Not found' });
    if (!canViewGrnVariance(req.user.role)) {
      payload.grns = payload.grns.map((g) => {
        const { varianceDetails, isPartialGrn, ...rest } = g;
        return rest;
      });
    }
    res.json({ data: payload });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
    next(err);
  }
});

router.get('/:id', param('id').isMongoId(), validate, async (req, res, next) => {
  try {
    const po = await PurchaseOrder.findById(req.params.id).populate(poPopulate);
    if (!po) return res.status(404).json({ statusCode: 404, message: 'Not found' });
    await assertCanViewPurchaseOrder(req.user, po);

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
    if (err.statusCode) return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
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
      const { quotations, rfq } = await ensureRfqAndQuotations(
        pr,
        pr.projectId.code,
        req.user._id,
        materialIds
      );

      const { buildComparisonTable } = require('../services/quotationComparisonService');
      const { buildPurchaseHistoryRows } = require('../services/materialPricingService');
      const { getIndentLineItems } = require('../services/materialRequestHelpers');

      let quantity = 1;
      let purchaseHistory = [];
      if (pr.materialRequestId) {
        const mr = await require('../models').MaterialRequest.findById(pr.materialRequestId).populate(
          'items.materialId'
        );
        if (mr) {
          const lines = getIndentLineItems(mr);
          quantity = lines.reduce((s, l) => s + (l.quantityRequested || 0), 0) || 1;
          purchaseHistory = await buildPurchaseHistoryRows(lines);
        }
      }

      const comparison = buildComparisonTable(quotations, quantity);

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
        comparison,
        purchaseHistory,
        rfqId: rfq?._id?.toString(),
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
    body('additionalTerms').optional().isString(),
    body('materialRequestId').optional().isMongoId(),
    body('purchaseRequestId').optional().isMongoId(),
    body('billingAddress').optional().isString(),
    body('billingAddressType').optional().isIn(['registered_office', 'project_billing']),
    body('deliveryAddress').optional().isString(),
    body('deliveryAddressType').optional().isIn(['site', 'workshop', 'global', 'other']),
    body('deliveryAddressOtherText').optional().isString(),
    body('expectedDeliveryDate').optional().isISO8601(),
    body('referenceNote').optional().isString(),
    body('whyWeChoseThisVendor').optional().isString(),
    body('vendorSelectionReasons').optional().isObject(),
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
        additionalTerms: req.body.additionalTerms,
        billingAddress: req.body.billingAddress,
        billingAddressType: req.body.billingAddressType,
        deliveryAddress: req.body.deliveryAddress,
        deliveryAddressType: req.body.deliveryAddressType,
        deliveryAddressOtherText: req.body.deliveryAddressOtherText,
        expectedDeliveryDate: req.body.expectedDeliveryDate,
        referenceNote: req.body.referenceNote,
        whyWeChoseThisVendor: req.body.whyWeChoseThisVendor,
        vendorSelectionReasons: req.body.vendorSelectionReasons,
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
    body('additionalTerms').optional().isString(),
    body('materialRequestId').optional().isMongoId(),
    body('purchaseRequestId').optional().isMongoId(),
    body('billingAddress').optional().isString(),
    body('billingAddressType').optional().isIn(['registered_office', 'project_billing']),
    body('deliveryAddress').optional().isString(),
    body('deliveryAddressType').optional().isIn(['site', 'workshop', 'global', 'other']),
    body('deliveryAddressOtherText').optional().isString(),
    body('expectedDeliveryDate').optional().isISO8601(),
    body('referenceNote').optional().isString(),
    body('whyWeChoseThisVendor').optional().isString(),
    body('vendorSelectionReason').optional().isString(),
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

      const { validatePoVendorSelection } = require('../services/rfqService');
      await validatePoVendorSelection(req.body.purchaseRequestId, [req.body.vendorId], {
        vendorSelectionReasons: req.body.vendorSelectionReason
          ? { [req.body.vendorId]: req.body.vendorSelectionReason }
          : {},
        whyWeChoseThisVendor: req.body.whyWeChoseThisVendor,
        actorUserId: req.user._id,
      });

      const result = await createPurchaseOrderFromWizard({
        materialRequestId: req.body.materialRequestId,
        purchaseRequestId: req.body.purchaseRequestId,
        vendorId: req.body.vendorId,
        paymentTerms: req.body.paymentTerms,
        additionalTerms: req.body.additionalTerms,
        billingAddress: req.body.billingAddress,
        billingAddressType: req.body.billingAddressType,
        deliveryAddress: req.body.deliveryAddress,
        deliveryAddressType: req.body.deliveryAddressType,
        deliveryAddressOtherText: req.body.deliveryAddressOtherText,
        expectedDeliveryDate: req.body.expectedDeliveryDate,
        referenceNote: req.body.referenceNote,
        vendorSelectionReason: req.body.vendorSelectionReason,
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

router.get('/:id/approval-history', param('id').isMongoId(), validate, async (req, res, next) => {
  try {
    const po = await PurchaseOrder.findById(req.params.id).populate(poPopulate);
    if (!po) return res.status(404).json({ statusCode: 404, message: 'Not found' });
    await assertCanViewPurchaseOrder(req.user, po);

    const history = await StatusHistory.find({
      entityType: 'PurchaseOrder',
      entityId: po._id,
      toStatus: { $in: ['APPROVED', 'CHAIRMAN_PENDING', 'COORDINATOR_PENDING', 'DRAFT', 'REJECTED'] },
    })
      .populate('actorUserId', 'name role')
      .sort({ timestamp: -1 });

    res.json({
      data: history.map((h) => ({
        id: h._id.toString(),
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        note: h.note,
        timestamp: h.timestamp?.toISOString?.(),
        actorName: h.actorUserId?.name || 'System',
        actorRole: h.actorUserId?.role || null,
        isChairmanOverride: !!po.approvedAsChairmanOverride && h.toStatus === 'APPROVED',
        overrideRemark: po.approvedAsChairmanOverride ? po.overrideRemark : null,
      })),
      meta: {
        approvedAsChairmanOverride: !!po.approvedAsChairmanOverride,
        overrideRemark: po.overrideRemark || null,
        finalApprovedAt: po.finalApprovedAt?.toISOString?.() || null,
        emailStatus: po.emailStatus,
        emailSentAt: po.emailSentAt?.toISOString?.() || null,
      },
    });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
    next(err);
  }
});

router.patch(
  '/:id',
  requirePoEditRole,
  [
    param('id').isMongoId(),
    body('paymentTerms').optional().trim(),
    body('additionalTerms').optional().trim(),
    body('billingAddress').optional().isString(),
    body('billingAddressType').optional().isIn(['registered_office', 'project_billing']),
    body('deliveryAddress').optional().isString(),
    body('deliveryAddressType').optional().isIn(['site', 'workshop', 'global', 'other']),
    body('deliveryAddressOtherText').optional().isString(),
    body('referenceNote').optional().isString(),
    body('expectedDeliveryDate').optional().isISO8601(),
    body('lineItems').optional().isArray(),
    body('acknowledgeGrnWarnings').optional().isBoolean(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const po = await PurchaseOrder.findById(req.params.id);
      if (!po) return res.status(404).json({ statusCode: 404, message: 'Not found' });

      const isCoordinator = req.user.role === UserRole.COORDINATOR;
      const isChairman = req.user.role === UserRole.CHAIRMAN;
      const isStore = req.user.role === UserRole.STORE_INCHARGE;
      const isExecutive = req.user.role === UserRole.EXECUTIVE;

      if (isStore || isExecutive) {
        return res.status(403).json({ statusCode: 403, message: 'Forbidden' });
      }
      if (!canEditPurchaseOrder(req.user.role, po)) {
        return res.status(403).json({
          statusCode: 403,
          message: 'You do not have permission to edit this PO',
        });
      }
      if (!isCoordinator && !isChairman) {
        return res.status(403).json({ statusCode: 403, message: 'Forbidden' });
      }

      const warnings = await getPoEditGrnWarnings(po, req.body);
      if (warnings.length && !req.body.acknowledgeGrnWarnings) {
        return res.status(409).json({
          statusCode: 409,
          message: 'Edits may conflict with recorded GRNs',
          warnings,
        });
      }

      await updatePurchaseOrderDraft(po, req.body, {
        acknowledgeGrnWarnings: !!req.body.acknowledgeGrnWarnings,
      });
      const populated = await PurchaseOrder.findById(po._id).populate(poPopulate);
      res.json({
        data: serializePurchaseOrder(populated),
        warnings: warnings.length ? warnings : undefined,
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({
          statusCode: err.statusCode,
          message: err.message,
          warnings: err.warnings,
        });
      }
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
  ],
  validate,
  async (req, res, next) => {
    const { handleIdempotent } = require('../utils/idempotentHandler');
    return handleIdempotent(req, res, `po-verify:${req.params.id}:${req.body.action}`, async () => {
      const po = await PurchaseOrder.findById(req.params.id).populate({
        path: 'purchaseRequestId',
        populate: { path: 'materialRequestId' },
      });
      if (!po) return { statusCode: 404, body: { statusCode: 404, message: 'Not found' } };
      if (!['PENDING_REVIEW', 'COORDINATOR_PENDING'].includes(po.status)) {
        if (req.body.action === 'APPROVE' && !['DRAFT', 'REJECTED'].includes(po.status)) {
          const populated = await PurchaseOrder.findById(po._id).populate(poPopulate);
          return { statusCode: 200, body: { data: serializePurchaseOrder(populated) } };
        }
        return { statusCode: 400, body: { statusCode: 400, message: 'PO not pending verification' } };
      }

      const fromStatus = po.status;

      if (req.body.action === 'APPROVE') {
        await coordinatorVerifyPurchaseOrder(po, req.user._id, req.body.note || 'Coordinator verified');
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
      return { statusCode: 200, body: { data: serializePurchaseOrder(populated) } };
    }, next);
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
  '/:id/return',
  requireCapability('VERIFY_RECORDS'),
  [param('id').isMongoId(), body('reason').trim().notEmpty()],
  validate,
  async (req, res, next) => {
    try {
      if (req.user.role !== UserRole.COORDINATOR) {
        return res.status(403).json({ statusCode: 403, message: 'Coordinator only' });
      }
      const po = await PurchaseOrder.findById(req.params.id);
      if (!po) return res.status(404).json({ statusCode: 404, message: 'Not found' });
      if (!['PENDING_REVIEW', 'COORDINATOR_PENDING'].includes(po.status)) {
        return res.status(400).json({ statusCode: 400, message: 'PO not pending verification' });
      }
      const fromStatus = po.status;
      po.status = 'DRAFT';
      await po.save();
      await runSideEffect('PO status history', () =>
        recordPoStatusHistory(po, fromStatus, 'DRAFT', req.user._id, req.body.reason)
      );
      await runSideEffect('Executive notification', () => notifyExecutivesReturned(po));
      const populated = await PurchaseOrder.findById(po._id).populate(poPopulate);
      res.json({ data: serializePurchaseOrder(populated) });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/approve-override',
  requireCapability('VERIFY_RECORDS'),
  [param('id').isMongoId(), body('remark').trim().isLength({ min: 30, max: 300 })],
  validate,
  async (req, res, next) => {
    try {
      if (req.user.role !== UserRole.COORDINATOR) {
        return res.status(403).json({ statusCode: 403, message: 'Coordinator only' });
      }
      const po = await PurchaseOrder.findById(req.params.id).populate({
        path: 'purchaseRequestId',
        populate: { path: 'materialRequestId' },
      });
      if (!po) return res.status(404).json({ statusCode: 404, message: 'Not found' });
      if (po.status === 'APPROVED') {
        const { runPostApprovalDispatch } = require('../services/poVerifySideEffects');
        await runPostApprovalDispatch(po);
        const populated = await PurchaseOrder.findById(po._id).populate(poPopulate);
        return res.json({ data: serializePurchaseOrder(populated) });
      }
      await coordinatorOverrideApprove(po, req.user._id, req.body.remark);
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
    const { withIdempotency, sendIdempotent } = require('../services/idempotencyService');
    try {
      const outcome = await withIdempotency(req, `po-chairman-approve:${req.params.id}`, async () => {
      const po = await PurchaseOrder.findById(req.params.id).populate({
        path: 'purchaseRequestId',
        populate: { path: 'materialRequestId' },
      });
      if (!po) return { statusCode: 404, body: { statusCode: 404, message: 'Not found' } };
      if (po.status === 'APPROVED') {
        const { runPostApprovalDispatch } = require('../services/poVerifySideEffects');
        await runPostApprovalDispatch(po);
        const populated = await PurchaseOrder.findById(po._id).populate(poPopulate);
        return { statusCode: 200, body: { data: serializePurchaseOrder(populated) } };
      }
      if (!['PENDING_APPROVAL', 'CHAIRMAN_PENDING'].includes(po.status)) {
        return { statusCode: 400, body: { statusCode: 400, message: 'PO not awaiting final approval' } };
      }

      await finalizePurchaseOrder(
        po,
        req.user._id,
        req.body.note || 'Final approval',
        req.approvalContext,
        { chairmanOverride: false }
      );

      const populated = await PurchaseOrder.findById(po._id).populate(poPopulate);
      return { statusCode: 200, body: { data: serializePurchaseOrder(populated) } };
      });
      return sendIdempotent(res, outcome);
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
