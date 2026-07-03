const express = require('express');
const { body, param } = require('express-validator');
const { UserRole } = require('@afios/shared');
const {
  MaterialRequest,
  Material,
  Project,
  Site,
  User,
  StockLedger,
  StockMovement,
} = require('../models');
const { authenticate } = require('../middleware/auth');
const { requireCapability } = require('../middleware/rbac');
const { requirePmApproval } = require('../middleware/approvalAuth');
const delegationService = require('../services/delegationService');
const {
  createPurchaseRequestForIndent,
} = require('../services/purchaseRequestService');
const { validate } = require('../middleware/validate');
const statusHistoryService = require('../services/statusHistoryService');
const notificationService = require('../services/notificationService');
const { generateIndentNumber } = require('../services/indentService');
const { getIndentLineItems } = require('../services/materialRequestHelpers');
const {
  userCanAccessSite,
  userCanAccessProject,
  serializeMaterialRequest,
  resolveId,
} = require('../utils/serialize');

const router = express.Router();

const populateFields = [
  { path: 'items.materialId' },
  { path: 'materialId' },
  { path: 'siteId' },
  { path: 'projectId' },
  { path: 'requestedByUserId', select: 'name' },
];

router.use(authenticate);

function parseStatusFilter(status) {
  if (!status) return undefined;
  const statuses = String(status)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!statuses.length) return undefined;
  return statuses.length === 1 ? statuses[0] : { $in: statuses };
}

router.get('/', async (req, res, next) => {
  try {
    const { status, tab, projectId } = req.query;
    const filter = {};

    if (projectId) {
      const canFilterByProject = [
        UserRole.PROJECT_MANAGER,
        UserRole.COORDINATOR,
        UserRole.CHAIRMAN,
        UserRole.EXECUTIVE,
      ].includes(req.user.role);
      if (canFilterByProject) {
        filter.projectId = projectId;
      }
    }

    if (req.user.role === UserRole.SITE_INCHARGE) {
      filter.requestedByUserId = req.user._id;
    } else if (req.user.role === UserRole.STORE_INCHARGE) {
      if (req.user.assignedProjectIds?.length) {
        filter.projectId = { $in: req.user.assignedProjectIds };
      } else {
        filter.siteId = req.user.assignedSiteId;
      }
      if (tab === 'pending') {
        filter.status = 'PENDING_STORE';
      }
    } else if ([UserRole.CHAIRMAN, UserRole.COORDINATOR, UserRole.EXECUTIVE].includes(req.user.role)) {
      // HQ roles see all site material requests (indents)
    } else if (req.user.role === UserRole.PROJECT_MANAGER) {
      if (!filter.projectId) {
        filter.projectId = { $in: req.user.assignedProjectIds };
      }
    }

    const statusFilter = parseStatusFilter(status);
    if (statusFilter) filter.status = statusFilter;

    if (tab === 'approved') {
      filter.status = {
        $in: ['ALLOCATED', 'FORWARDED_TO_PM', 'PM_APPROVED'],
      };
    } else if (tab === 'completed') {
      filter.status = {
        $in: ['COMPLETED', 'CLOSED'],
      };
    } else if (tab === 'rejected') {
      filter.status = 'REJECTED';
    } else if (tab === 'pending' && req.user.role === UserRole.SITE_INCHARGE) {
      filter.status = 'PENDING_STORE';
    }

    const requests = await MaterialRequest.find(filter)
      .sort({ createdAt: -1 })
      .populate(populateFields);

    res.json({ data: requests.map(serializeMaterialRequest) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', param('id').isMongoId(), validate, async (req, res, next) => {
  try {
    const mr = await MaterialRequest.findById(req.params.id).populate(populateFields);
    if (!mr) {
      return res.status(404).json({ statusCode: 404, message: 'Request not found' });
    }

    const siteId = mr.siteId._id || mr.siteId;
    const projectId = mr.projectId._id || mr.projectId;

    if (req.user.role === UserRole.SITE_INCHARGE) {
      const requesterId = resolveId(mr.requestedByUserId);
      if (requesterId !== req.user._id.toString()) {
        return res.status(403).json({ statusCode: 403, message: 'Forbidden' });
      }
    } else if (!userCanAccessSite(req.user, siteId)) {
      if (req.user.role === UserRole.PROJECT_MANAGER && !userCanAccessProject(req.user, projectId)) {
        return res.status(403).json({ statusCode: 403, message: 'Forbidden' });
      }
      if (![UserRole.EXECUTIVE, UserRole.COORDINATOR, UserRole.CHAIRMAN, UserRole.PROJECT_MANAGER].includes(req.user.role)) {
        return res.status(403).json({ statusCode: 403, message: 'Forbidden' });
      }
    }

    res.json({ data: serializeMaterialRequest(mr) });
  } catch (err) {
    next(err);
  }
});

async function resolveIndentLineItems(rawItems) {
  const { Material } = require('../models');
  const { materialCodeFromItem, ensureUniqueCode } = require('../services/codeGenerators');
  const resolved = [];
  const usedCodes = new Set(
    (await Material.find().select('code').lean()).map((m) => m.code.toUpperCase())
  );

  for (const item of rawItems) {
    const qty = Number(item.quantityRequested);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const unit = String(item.unit || 'Nos').trim() || 'Nos';

    if (item.materialId) {
      const catalog = await Material.findById(item.materialId).select('unit');
      resolved.push({
        materialId: item.materialId,
        quantityRequested: qty,
        unit: unit || catalog?.unit || 'Nos',
      });
      continue;
    }

    const name = String(item.customName || item.name || '').trim();
    if (!name) continue;

    let mat = await Material.findOne({
      name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
    });

    if (!mat) {
      const code = ensureUniqueCode(materialCodeFromItem(name, name).slice(0, 36) || 'SITE-REQ', usedCodes);
      mat = await Material.create({
        code,
        name,
        unit,
        category: 'Site request',
        description: 'Requested from site — not previously in catalog',
        isActive: true,
      });
    }

    resolved.push({ materialId: mat._id, quantityRequested: qty, unit });
  }

  return resolved;
}

router.post(
  '/',
  requireCapability('CREATE_MATERIAL_REQUEST'),
  [
    body('items').optional().isArray({ min: 1 }),
    body('items.*.materialId').optional().isMongoId(),
    body('items.*.customName').optional().trim().isLength({ min: 1, max: 200 }),
    body('items.*.unit').optional().trim(),
    body('items.*.quantityRequested').optional().isFloat({ min: 0.01 }),
    body('materialId').optional().isMongoId(),
    body('quantityRequested').optional().isFloat({ min: 0.01 }),
    body('purpose').optional().trim(),
    body('requiredByDate').optional().isISO8601(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const site = await Site.findById(req.user.assignedSiteId).populate('projectId');
      if (!site) {
        return res.status(400).json({ statusCode: 400, message: 'No site assigned to user' });
      }

      let items = req.body.items;
      if (!items?.length) {
        if (!req.body.materialId || !req.body.quantityRequested) {
          return res.status(400).json({
            statusCode: 400,
            message: 'At least one material item is required',
          });
        }
        items = [{ materialId: req.body.materialId, quantityRequested: req.body.quantityRequested }];
      }

      const resolvedItems = await resolveIndentLineItems(items);
      if (!resolvedItems.length) {
        return res.status(400).json({
          statusCode: 400,
          message: 'At least one material item is required (catalog or custom name)',
        });
      }

      const project = site.projectId;
      const indentNumber = await generateIndentNumber(project.code);

      const mr = await MaterialRequest.create({
        indentNumber,
        projectId: project._id,
        siteId: site._id,
        items: resolvedItems,
        requestedByUserId: req.user._id,
        status: 'PENDING_STORE',
        pendingWithRole: 'STORE_INCHARGE',
      });

      await statusHistoryService.record(
        'MaterialRequest',
        mr._id,
        null,
        'PENDING_STORE',
        req.user._id,
        `Indent ${indentNumber} submitted with ${resolvedItems.length} item(s)`
      );

      const storeUsers = await User.find({
        role: UserRole.STORE_INCHARGE,
        assignedSiteId: site._id,
      });

      await notificationService.notifyUsers(
        storeUsers.map((u) => u._id),
        {
          title: 'New material indent',
          body: `${req.user.name} raised ${indentNumber} with ${resolvedItems.length} item(s).`,
          relatedEntityType: 'MaterialRequest',
          relatedEntityId: mr._id,
        }
      );

      req.auditEntityType = 'MaterialRequest';
      req.auditEntityId = mr._id;

      const populated = await MaterialRequest.findById(mr._id).populate(populateFields);
      res.status(201).json({ data: serializeMaterialRequest(populated) });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/allocate',
  requireCapability('ALLOCATE_MATERIAL_REQUEST'),
  [
    param('id').isMongoId(),
    body('allocations').optional().isArray({ min: 1 }),
    body('allocations.*.itemId').optional().isMongoId(),
    body('allocations.*.quantityAllocated').optional().isFloat({ min: 0 }),
    body('quantityAllocated').optional().isFloat({ min: 0 }),
  ],
  validate,
  async (req, res, next) => {
    try {
      const mr = await MaterialRequest.findById(req.params.id);
      if (!mr) {
        return res.status(404).json({ statusCode: 404, message: 'Request not found' });
      }

      if (!userCanAccessSite(req.user, mr.siteId)) {
        return res.status(403).json({ statusCode: 403, message: 'Forbidden: not your site' });
      }

      if (mr.status !== 'PENDING_STORE') {
        return res.status(400).json({ statusCode: 400, message: 'Request is not pending store action' });
      }

      const lineItems = getIndentLineItems(mr);
      const allocations = req.body.allocations?.length
        ? req.body.allocations
        : lineItems.length === 1
          ? [{ itemId: lineItems[0]._id.toString(), quantityAllocated: req.body.quantityAllocated }]
          : null;

      if (!allocations?.length) {
        return res.status(400).json({
          statusCode: 400,
          message: 'allocations array required for multi-item indents',
        });
      }

      for (const alloc of allocations) {
        const item = mr.items.id(alloc.itemId) || lineItems.find((i) => i._id.toString() === alloc.itemId);
        if (!item) {
          return res.status(400).json({ statusCode: 400, message: 'Invalid line item' });
        }
        const materialId = item.materialId._id || item.materialId;
        const ledger = await StockLedger.findOne({ siteId: mr.siteId, materialId });
        const available = ledger?.quantityOnHand || 0;
        const qty = alloc.quantityAllocated;
        if (qty > available) {
          const mat = await Material.findById(materialId);
          return res.status(400).json({
            statusCode: 400,
            message: `Insufficient stock for ${mat?.name || 'material'}. Available: ${available}`,
          });
        }
      }

      const fromStatus = mr.status;
      for (const alloc of allocations) {
        const item = mr.items.id(alloc.itemId);
        if (!item) continue;
        const qty = alloc.quantityAllocated;
        item.quantityAllocated = qty;

        const ledger = await StockLedger.findOne({
          siteId: mr.siteId,
          materialId: item.materialId,
        });
        if (ledger && qty > 0) {
          ledger.quantityOnHand -= qty;
          ledger.lastMovementAt = new Date();
          await ledger.save();
          await StockMovement.create({
            siteId: mr.siteId,
            materialId: item.materialId,
            materialRequestId: mr._id,
            quantityDelta: -qty,
            type: 'ALLOCATION',
            actorUserId: req.user._id,
          });
        }
      }

      mr.status = 'ALLOCATED';
      mr.pendingWithRole = 'STORE_INCHARGE';
      await mr.save();

      await statusHistoryService.record(
        'MaterialRequest',
        mr._id,
        fromStatus,
        'ALLOCATED',
        req.user._id,
        `Store allocated materials for ${mr.indentNumber}`
      );

      await notificationService.notifyUser(mr.requestedByUserId, {
        title: 'Indent accepted by store',
        body: `Your indent ${mr.indentNumber} has been accepted by store.`,
        relatedEntityType: 'MaterialRequest',
        relatedEntityId: mr._id,
      });

      req.auditEntityType = 'MaterialRequest';
      req.auditEntityId = mr._id;

      const populated = await MaterialRequest.findById(mr._id).populate(populateFields);
      res.json({ data: serializeMaterialRequest(populated) });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/forward',
  requireCapability('FORWARD_MATERIAL_REQUEST'),
  [
    param('id').isMongoId(),
    body('reason').trim().notEmpty().withMessage('Reason required'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const mr = await MaterialRequest.findById(req.params.id);
      if (!mr) {
        return res.status(404).json({ statusCode: 404, message: 'Request not found' });
      }

      if (!userCanAccessSite(req.user, mr.siteId) && req.user.role !== UserRole.PROJECT_MANAGER) {
        if (req.user.role === UserRole.PROJECT_MANAGER && !userCanAccessProject(req.user, mr.projectId)) {
          return res.status(403).json({ statusCode: 403, message: 'Forbidden' });
        }
        if (req.user.role !== UserRole.PROJECT_MANAGER) {
          return res.status(403).json({ statusCode: 403, message: 'Forbidden: not your site' });
        }
      }

      if (!['ALLOCATED', 'PENDING_STORE'].includes(mr.status)) {
        return res.status(400).json({
          statusCode: 400,
          message: 'Request cannot be forwarded in current status',
        });
      }

      const fromStatus = mr.status;
      mr.status = 'FORWARDED_TO_PM';
      await mr.save();

      await statusHistoryService.record(
        'MaterialRequest',
        mr._id,
        fromStatus,
        'FORWARDED_TO_PM',
        req.user._id,
        req.body.reason
      );

      const pmUsers = await User.find({
        role: UserRole.PROJECT_MANAGER,
        assignedProjectIds: mr.projectId,
      });

      await notificationService.notifyUsers(
        pmUsers.map((u) => u._id),
        {
          title: 'Request forwarded to PM',
          body: `Request ${mr.indentNumber} forwarded for PM review.`,
          relatedEntityType: 'MaterialRequest',
          relatedEntityId: mr._id,
        }
      );

      req.auditEntityType = 'MaterialRequest';
      req.auditEntityId = mr._id;

      const populated = await MaterialRequest.findById(mr._id).populate(populateFields);
      res.json({ data: serializeMaterialRequest(populated) });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/approve',
  requirePmApproval(),
  param('id').isMongoId(),
  validate,
  async (req, res, next) => {
    try {
      const mr = req._materialRequest || (await MaterialRequest.findById(req.params.id));
      if (!mr) {
        return res.status(404).json({ statusCode: 404, message: 'Request not found' });
      }

      const actingRole = req.approvalContext.principal.role;

      if (actingRole === UserRole.PROJECT_MANAGER && mr.status !== 'FORWARDED_TO_PM') {
        return res.status(400).json({ statusCode: 400, message: 'Request not awaiting PM approval' });
      }

      const fromStatus = mr.status;
      const toStatus = actingRole === UserRole.CHAIRMAN ? 'CHAIRMAN_APPROVED' : 'PM_APPROVED';
      mr.status = toStatus;
      await mr.save();

      const note = delegationService.formatApprovalNote('Approved', req.approvalContext);

      await statusHistoryService.record(
        'MaterialRequest',
        mr._id,
        fromStatus,
        toStatus,
        req.user._id,
        note
      );

      await notificationService.notifyUser(mr.requestedByUserId, {
        title: 'Request approved',
        body: `Your request ${mr.indentNumber} has been approved.`,
        relatedEntityType: 'MaterialRequest',
        relatedEntityId: mr._id,
      });

      if (toStatus === 'PM_APPROVED') {
        const mrForPr = await MaterialRequest.findById(mr._id)
          .populate('projectId')
          .populate('items.materialId');
        await createPurchaseRequestForIndent(mrForPr, req.user._id);
      }

      const populated = await MaterialRequest.findById(mr._id).populate(populateFields);
      res.json({ data: serializeMaterialRequest(populated) });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/reject',
  requirePmApproval(),
  [
    param('id').isMongoId(),
    body('reason').trim().notEmpty().withMessage('Reason required'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const mr = req._materialRequest || (await MaterialRequest.findById(req.params.id));
      if (!mr) {
        return res.status(404).json({ statusCode: 404, message: 'Request not found' });
      }

      const actingRole = req.approvalContext.principal.role;
      if (actingRole === UserRole.PROJECT_MANAGER && mr.status !== 'FORWARDED_TO_PM') {
        return res.status(400).json({ statusCode: 400, message: 'Request not awaiting PM action' });
      }

      const fromStatus = mr.status;
      mr.status = 'REJECTED';
      await mr.save();

      const note = delegationService.formatApprovalNote(req.body.reason, req.approvalContext);

      await statusHistoryService.record(
        'MaterialRequest',
        mr._id,
        fromStatus,
        'REJECTED',
        req.user._id,
        note
      );

      await notificationService.notifyUser(mr.requestedByUserId, {
        title: 'Request not approved',
        body: `Your request ${mr.indentNumber} was not approved: ${req.body.reason}`,
        relatedEntityType: 'MaterialRequest',
        relatedEntityId: mr._id,
      });

      const populated = await MaterialRequest.findById(mr._id).populate(populateFields);
      res.json({ data: serializeMaterialRequest(populated) });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/confirm-receipt',
  requireCapability('CERTIFY_WO_WORK'),
  [param('id').isMongoId(), body('note').optional().trim()],
  validate,
  async (req, res, next) => {
    try {
      const mr = await MaterialRequest.findById(req.params.id);
      if (!mr) return res.status(404).json({ statusCode: 404, message: 'Request not found' });
      if (mr.status !== 'ISSUED') {
        return res.status(400).json({ statusCode: 400, message: 'Materials not yet issued' });
      }
      if (mr.requestedByUserId.toString() !== req.user._id.toString()) {
        return res.status(403).json({ statusCode: 403, message: 'Only the requester can confirm receipt' });
      }

      const fromStatus = mr.status;
      mr.status = 'COMPLETED';
      mr.pendingWithRole = null;
      await mr.save();

      await statusHistoryService.record(
        'MaterialRequest',
        mr._id,
        fromStatus,
        'COMPLETED',
        req.user._id,
        req.body.note || 'Site confirmed material receipt'
      );

      const populated = await MaterialRequest.findById(mr._id).populate(populateFields);
      res.json({ data: serializeMaterialRequest(populated) });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
