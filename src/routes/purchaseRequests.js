const express = require('express');
const { body, param } = require('express-validator');
const { UserRole } = require('@afios/shared');
const { PurchaseRequest, MaterialRequest, PurchaseOrder } = require('../models');
const { authenticate } = require('../middleware/auth');
const { requireCapability } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { userCanAccessProject } = require('../utils/serialize');
const { serializePurchaseRequest } = require('../utils/serializeProcurement');
const {
  createPurchaseRequestForIndent,
  estimateIndentAmount,
} = require('../services/purchaseRequestService');

const router = express.Router();
router.use(authenticate);

const populateFields = [
  { path: 'projectId' },
  { path: 'materialRequestId' },
];

router.get('/', async (req, res, next) => {
  try {
    const filter = {};
    if (req.user.role === UserRole.PROJECT_MANAGER) {
      filter.projectId = { $in: req.user.assignedProjectIds };
    }
    if (req.query.status) {
      filter.status = req.query.status;
    }
    let items = await PurchaseRequest.find(filter)
      .sort({ createdAt: -1 })
      .populate(populateFields);

    // Exclude PRs that already have a non-rejected PO (prevents duplicate orders)
    if (req.query.readyForPo === 'true' || req.query.readyForPo === '1') {
      const prIds = items.map((pr) => pr._id);
      const orderedPrIds = await PurchaseOrder.distinct('purchaseRequestId', {
        purchaseRequestId: { $in: prIds },
        status: { $ne: 'REJECTED' },
      });
      const orderedSet = new Set(orderedPrIds.map((id) => id.toString()));
      items = items.filter((pr) => !orderedSet.has(pr._id.toString()));
    }

    res.json({ data: items.map(serializePurchaseRequest) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', param('id').isMongoId(), validate, async (req, res, next) => {
  try {
    const pr = await PurchaseRequest.findById(req.params.id).populate(populateFields);
    if (!pr) return res.status(404).json({ statusCode: 404, message: 'Not found' });
    if (req.user.role === UserRole.PROJECT_MANAGER && !userCanAccessProject(req.user, pr.projectId)) {
      return res.status(403).json({ statusCode: 403, message: 'Forbidden' });
    }
    res.json({ data: serializePurchaseRequest(pr) });
  } catch (err) {
    next(err);
  }
});

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
        req.body.amountEstimate ?? estimateIndentAmount(mr)
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
