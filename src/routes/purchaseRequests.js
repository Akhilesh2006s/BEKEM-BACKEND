const express = require('express');
const { body, param } = require('express-validator');
const { UserRole } = require('@afios/shared');
const { PurchaseRequest, MaterialRequest } = require('../models');
const { authenticate } = require('../middleware/auth');
const { requireCapability } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { userCanAccessProject } = require('../utils/serialize');
const { serializePurchaseRequest } = require('../utils/serializeProcurement');
const {
  createPurchaseRequestForIndent,
  estimateIndentAmount,
} = require('../services/purchaseRequestService');
const {
  listExecutivePendingPurchaseRequests,
  countExecutivePendingPurchaseRequests,
} = require('../services/executivePurchaseRequestQueueService');
const {
  serializeExecutivePurchaseRequestListItem,
  enrichPurchaseRequestDetail,
} = require('../services/purchaseRequestSerializeService');
const { executiveDecidePurchaseRequest } = require('../services/purchaseRequestExecutiveService');

const router = express.Router();
router.use(authenticate);

const populateFields = [
  { path: 'projectId' },
  { path: 'materialRequestId' },
];

const detailPopulateFields = [
  { path: 'projectId' },
  {
    path: 'materialRequestId',
    populate: [
      { path: 'projectId' },
      { path: 'requestedByUserId', select: 'name' },
      { path: 'items.materialId' },
      { path: 'materialId' },
    ],
  },
  { path: 'executiveRecommendedByUserId', select: 'name' },
];

router.get('/', async (req, res, next) => {
  try {
    const isExecutiveQueue =
      req.user.role === UserRole.EXECUTIVE &&
      (req.query.queue === 'pending-po' ||
        req.query.readyForPo === 'true' ||
        req.query.readyForPo === '1') &&
      !req.query.tab;

    if (isExecutiveQueue) {
      const items = await listExecutivePendingPurchaseRequests();
      const data = await Promise.all(items.map(serializeExecutivePurchaseRequestListItem));
      return res.json({
        data,
        meta: { count: await countExecutivePendingPurchaseRequests() },
      });
    }

    if (req.user.role === UserRole.EXECUTIVE && req.query.tab) {
      const tab = req.query.tab;
      const filter = {};
      if (tab === 'pending') {
        filter.executiveRecommendation = null;
        filter.status = { $nin: ['CANCELLED', 'CLOSED'] };
      } else if (tab === 'approved') {
        filter.executiveRecommendation = { $ne: null };
        filter.status = { $nin: ['CANCELLED', 'CLOSED'] };
      } else if (tab === 'completed') {
        filter.status = { $in: ['PO_CREATED', 'CLOSED', 'COMPLETED'] };
      }
      const items = await PurchaseRequest.find(filter)
        .sort({ createdAt: -1 })
        .populate(populateFields);
      const data = await Promise.all(items.map(serializeExecutivePurchaseRequestListItem));
      return res.json({ data, meta: { count: data.length } });
    }

    const filter = {};
    if (req.user.role === UserRole.PROJECT_MANAGER) {
      filter.projectId = { $in: req.user.assignedProjectIds };
    }
    if (req.query.status) {
      filter.status = req.query.status;
    }

    const items = await PurchaseRequest.find(filter)
      .sort({ createdAt: -1 })
      .populate(populateFields);

    res.json({ data: items.map(serializePurchaseRequest) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', param('id').isMongoId(), validate, async (req, res, next) => {
  try {
    const pr = await PurchaseRequest.findById(req.params.id).populate(detailPopulateFields);
    if (!pr) return res.status(404).json({ statusCode: 404, message: 'Not found' });
    if (req.user.role === UserRole.PROJECT_MANAGER && !userCanAccessProject(req.user, pr.projectId)) {
      return res.status(403).json({ statusCode: 403, message: 'Forbidden' });
    }
    res.json({ data: await enrichPurchaseRequestDetail(pr) });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/:id/executive-decide',
  requireCapability('CREATE_PO'),
  param('id').isMongoId(),
  body('method').isIn(['PURCHASE_ORDER', 'BRANCH_TRANSFER']),
  body('remark').optional().isString().trim(),
  validate,
  async (req, res, next) => {
    try {
      const pr = await PurchaseRequest.findById(req.params.id).populate(detailPopulateFields);
      if (!pr) return res.status(404).json({ statusCode: 404, message: 'Not found' });

      const updated = await executiveDecidePurchaseRequest(pr, req.user, {
        method: req.body.method,
        remark: req.body.remark || '',
      });

      req.auditEntityType = 'PurchaseRequest';
      req.auditEntityId = updated._id;

      const populated = await PurchaseRequest.findById(updated._id).populate(detailPopulateFields);
      res.json({ data: await enrichPurchaseRequestDetail(populated) });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
      next(err);
    }
  }
);

router.post(
  '/',
  requireCapability('CREATE_PURCHASE_REQUEST'),
  [
    body('materialRequestId').isMongoId(),
    body('amountEstimate').isFloat({ min: 0 }),
  ],
  validate,
  async (req, res, next) => {
    try {
      const mr = await MaterialRequest.findById(req.body.materialRequestId).populate('projectId');
      if (!mr) return res.status(404).json({ statusCode: 404, message: 'Material request not found' });

      if (req.user.role === UserRole.PROJECT_MANAGER && !userCanAccessProject(req.user, mr.projectId)) {
        return res.status(403).json({ statusCode: 403, message: 'Forbidden' });
      }

      if (mr.status !== 'PM_APPROVED') {
        return res.status(400).json({
          statusCode: 400,
          message: 'Material request must be PM approved before creating purchase request',
        });
      }

      const existing = await PurchaseRequest.findOne({ materialRequestId: mr._id });
      if (existing) {
        return res.status(400).json({ statusCode: 400, message: 'Purchase request already exists' });
      }

      const pr = await createPurchaseRequestForIndent(
        mr,
        req.user._id,
        req.body.amountEstimate ?? (await estimateIndentAmount(mr))
      );

      req.auditEntityType = 'PurchaseRequest';
      req.auditEntityId = pr._id;

      const populated = await PurchaseRequest.findById(pr._id).populate(populateFields);
      res.status(201).json({ data: serializePurchaseRequest(populated) });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
