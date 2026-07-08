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
  PurchaseRequest,
  RFQ,
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
  serializeMaterialRequestEnriched,
  resolveId,
} = require('../utils/serialize');
const { enrichIndentWithStock } = require('../services/indentStockService');
const { allocateIndentStock } = require('../services/indentAllocationService');
const { estimateIndentAmount } = require('../services/purchaseRequestService');
const { queueForExecutiveDecision } = require('../services/procurementDecisionService');
const { resolveIndentCategory } = require('../services/indentCategoryService');
const {
  buildExecutiveIndentCategoryFilter,
  executiveCanAccessIndent,
  notifyExecutivesForIndent,
} = require('../services/executiveRoutingService');
const pmApprovalCapService = require('../services/pmApprovalCapService');
const { checkPmCanApprove, getPmDailyApprovedTotal } = pmApprovalCapService;
const { handleIdempotent } = require('../utils/idempotentHandler');

const router = express.Router();

function requireRemark(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    const err = new Error('Remark is required');
    err.statusCode = 400;
    throw err;
  }
  return trimmed;
}

const populateFields = [
  { path: 'items.materialId' },
  { path: 'materialId' },
  { path: 'siteId' },
  { path: 'projectId' },
  { path: 'requestedByUserId', select: 'name' },
  { path: 'indentCategoryId', select: 'name' },
];

async function mrEnrichedBody(mrId, viewerRole) {
  const populated = await MaterialRequest.findById(mrId).populate(populateFields);
  return { data: await serializeMaterialRequestEnriched(populated, viewerRole) };
}

const HIDE_HO_ORIGIN_ROLES = [UserRole.SITE_INCHARGE, UserRole.STORE_INCHARGE, UserRole.PROJECT_MANAGER];

function applySiteOriginFilter(filter, user) {
  if (HIDE_HO_ORIGIN_ROLES.includes(user.role)) {
    filter.origin = { $ne: 'EXECUTIVE' };
  }
}

const FORWARDED_STATUSES = ['FORWARDED_TO_PM', 'PM_APPROVED', 'PURCHASE_REQUESTED', 'PENDING_HO', 'PO_CREATED'];

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

const IN_PROGRESS_STATUSES = [
  'PENDING_STORE',
  'ALLOCATED',
  'FORWARDED_TO_PM',
  'PM_APPROVED',
  'PURCHASE_REQUESTED',
  'PENDING_HO',
  'PENDING_EXECUTIVE_DECISION',
  'EXECUTIVE_DECISION_PO',
  'EXECUTIVE_DECISION_BRANCH_TRANSFER',
  'BRANCH_TRANSFER_REQUESTED',
  'PO_CREATED',
  'COORDINATOR_VERIFIED',
  'CHAIRMAN_APPROVED',
  'RFQ_OPEN',
  'QUOTED',
  'VENDOR_SELECTED',
];

const COMPLETED_RECEIVED_STATUSES = ['MATERIAL_RECEIVED', 'ISSUED', 'COMPLETED', 'CLOSED'];

async function buildPmIndentNotification(mr) {
  const populated = await MaterialRequest.findById(mr._id)
    .populate('projectId', 'name code')
    .populate('requestedByUserId', 'name')
    .populate('items.materialId', 'name unit');
  const lines = getIndentLineItems(populated || mr);
  const materialSummary = lines
    .map((line) => {
      const name = line.materialId?.name || 'Material';
      return `${name} × ${line.quantityRequested}`;
    })
    .join(', ');
  const project = populated?.projectId?.code || populated?.projectId?.name || '';
  const requester = populated?.requestedByUserId?.name || 'Site';
  return {
    title: 'Indent awaiting PM approval',
    body: `${mr.indentNumber} · ${project} · ${materialSummary} · by ${requester}`,
    relatedEntityType: 'MaterialRequest',
    relatedEntityId: mr._id,
  };
}

async function forwardIndentToPm(mr, actorUserId, remark, { storeStockVerified = false } = {}) {
  const fromStatus = mr.status;
  mr.status = 'FORWARDED_TO_PM';
  mr.pendingWithRole = 'PROJECT_MANAGER';
  mr.storeStockVerified = Boolean(storeStockVerified);
  mr.estimatedValue = await estimateIndentAmount(mr);
  await mr.save();

  await statusHistoryService.record(
    'MaterialRequest',
    mr._id,
    fromStatus,
    'FORWARDED_TO_PM',
    actorUserId,
    remark
  );

  const pmUsers = await User.find({
    role: UserRole.PROJECT_MANAGER,
    assignedProjectIds: mr.projectId,
  });
  const notification = await buildPmIndentNotification(mr);
  await notificationService.notifyUsers(pmUsers.map((u) => u._id), notification);

  return mr;
}

router.get('/', async (req, res, next) => {
  try {
    const { status, tab, projectId } = req.query;
    const filter = {};
    const statusFilter = parseStatusFilter(status);

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
    } else if ([UserRole.CHAIRMAN, UserRole.COORDINATOR, UserRole.EXECUTIVE].includes(req.user.role)) {
      // HQ roles see all site material requests (indents)
      if (req.user.role === UserRole.EXECUTIVE) {
        Object.assign(filter, buildExecutiveIndentCategoryFilter(req.user));
      }
    } else if (req.user.role === UserRole.PROJECT_MANAGER) {
      if (!filter.projectId) {
        filter.projectId = { $in: req.user.assignedProjectIds };
      }
      if (statusFilter === 'FORWARDED_TO_PM' || status === 'FORWARDED_TO_PM') {
        filter.escalatedToHo = { $ne: true };
      }
    }

    if (statusFilter) filter.status = statusFilter;

    if (tab === 'pending') {
      if (req.user.role === UserRole.STORE_INCHARGE) {
        filter.status = 'PENDING_STORE';
      } else {
        filter.status = { $in: IN_PROGRESS_STATUSES };
      }
    } else if (tab === 'approved') {
      if (req.user.role === UserRole.STORE_INCHARGE) {
        filter.status = {
          $in: IN_PROGRESS_STATUSES.filter((s) => s !== 'PENDING_STORE'),
        };
      } else {
        filter.status = { $in: IN_PROGRESS_STATUSES };
      }
    } else if (tab === 'completed') {
      filter.status = { $in: COMPLETED_RECEIVED_STATUSES };
    } else     if (tab === 'rejected') {
      filter.status = 'REJECTED';
    }

    applySiteOriginFilter(filter, req.user);

    const requests = await MaterialRequest.find(filter)
      .sort({ createdAt: -1 })
      .populate(populateFields);

    const data = await Promise.all(
      requests.map((mr) => serializeMaterialRequestEnriched(mr, req.user.role))
    );
    res.json({ data });
  } catch (err) {
    next(err);
  }
});


router.get('/pm/daily-cap', async (req, res, next) => {
  try {
    if (req.user.role !== UserRole.PROJECT_MANAGER) {
      return res.status(403).json({ statusCode: 403, message: 'Forbidden' });
    }
    const { getApprovalLimits } = require('../services/orgSettingsService');
    const limits = getApprovalLimits();
    const dailyApprovedTotal = await getPmDailyApprovedTotal(req.user._id);
    res.json({
      data: {
        dailyApprovedTotal,
        dailyCap: limits.mrPmDailyMaxInr,
        remaining: Math.max(0, limits.mrPmDailyMaxInr - dailyApprovedTotal),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/ho-indents', async (req, res, next) => {
  try {
    const { HO_ROLES } = require('../services/executiveIndentService');
    if (!HO_ROLES.includes(req.user.role)) {
      return res.status(403).json({ statusCode: 403, message: 'Forbidden' });
    }
    const filter = { origin: 'EXECUTIVE' };
    if (req.query.status) filter.status = req.query.status;
    const requests = await MaterialRequest.find(filter)
      .sort({ createdAt: -1 })
      .populate(populateFields);
    const data = await Promise.all(
      requests.map(async (mr) => {
        const row = await serializeMaterialRequestEnriched(mr, req.user.role);
        if (mr.status === 'RFQ_OPEN') {
          const pr = await PurchaseRequest.findOne({ materialRequestId: mr._id }).select('_id');
          if (pr) {
            const rfq = await RFQ.findOne({ purchaseRequestId: pr._id }).select('_id rfqNumber');
            if (rfq) {
              row.rfqId = rfq._id.toString();
              row.rfqNumber = rfq.rfqNumber;
            }
          }
        }
        return row;
      })
    );
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/ho-indents',
  [
    body('projectId').isMongoId(),
    body('items').isArray({ min: 1 }),
    body('items.*.materialId').isMongoId(),
    body('items.*.quantityRequested').isFloat({ min: 0.01 }),
    body('purpose').trim().notEmpty().isLength({ max: 500 }),
    body('requiredByDate').optional().isISO8601(),
  ],
  validate,
  async (req, res, next) => {
    try {
      if (req.user.role !== UserRole.EXECUTIVE) {
        return res.status(403).json({ statusCode: 403, message: 'Only Executive can generate HO indents' });
      }
      const { createExecutiveIndent } = require('../services/executiveIndentService');
      const mr = await createExecutiveIndent(req.user, req.body);
      const populated = await MaterialRequest.findById(mr._id).populate(populateFields);
      res.status(201).json({ data: await serializeMaterialRequestEnriched(populated, req.user.role) });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
      next(err);
    }
  }
);

router.post(
  '/ho-indents/:id/coordinator-approve',
  param('id').isMongoId(),
  validate,
  async (req, res, next) => {
    try {
      const { approveExecutiveIndent } = require('../services/executiveIndentService');
      const { mr, rfq } = await approveExecutiveIndent(req.user, req.params.id);
      const populated = await MaterialRequest.findById(mr._id).populate(populateFields);
      res.json({
        data: {
          indent: await serializeMaterialRequestEnriched(populated, req.user.role),
          rfqId: rfq._id.toString(),
          rfqNumber: rfq.rfqNumber,
        },
      });
    } catch (err) {
      if (err.statusCode) return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
      next(err);
    }
  }
);

router.post(
  '/pm-procurement',
  [
    body('projectId').isMongoId(),
    body('items').isArray({ min: 1 }),
    body('items.*.materialId').isMongoId(),
    body('items.*.quantityRequested').isFloat({ min: 0.01 }),
    body('purpose').trim().notEmpty().isLength({ max: 500 }),
    body('indentCategoryId').isMongoId().withMessage('Indent category is required'),
  ],
  validate,
  async (req, res, next) => {
    try {
      if (req.user.role !== UserRole.PROJECT_MANAGER) {
        return res.status(403).json({ statusCode: 403, message: 'Forbidden' });
      }
      if (!userCanAccessProject(req.user, req.body.projectId)) {
        return res.status(403).json({ statusCode: 403, message: 'Project not in your scope' });
      }
      const site = await Site.findOne({ projectId: req.body.projectId }).sort({ createdAt: 1 });
      if (!site) {
        return res.status(400).json({ statusCode: 400, message: 'No site for project' });
      }
      const project = await Project.findById(req.body.projectId);
      const resolvedItems = await resolveIndentLineItems(req.body.items, req.user._id);
      await resolveIndentCategory(req.body.indentCategoryId);
      const indentNumber = await generateIndentNumber(project.code);
      const mr = await MaterialRequest.create({
        indentNumber,
        projectId: project._id,
        siteId: site._id,
        items: resolvedItems,
        materialId: resolvedItems[0].materialId,
        quantityRequested: resolvedItems[0].quantityRequested,
        purpose: req.body.purpose.trim(),
        requestedByUserId: req.user._id,
        indentCategoryId: req.body.indentCategoryId,
        status: 'PENDING_HO',
        pendingWithRole: 'EXECUTIVE',
        escalatedToHo: true,
        escalatedAt: new Date(),
        origin: 'SITE',
      });
      mr.estimatedValue = await estimateIndentAmount(mr);
      await mr.save();
      await statusHistoryService.record(
        'MaterialRequest',
        mr._id,
        null,
        'PENDING_HO',
        req.user._id,
        `PM procurement request ${indentNumber}`
      );
      await notifyExecutivesForIndent(mr.indentCategoryId, notificationService, {
        title: 'New procurement request',
        body: `${indentNumber} — PM requested new procurement.`,
        relatedEntityType: 'ProcurementDecision',
        relatedEntityId: mr._id,
      });
      const populated = await MaterialRequest.findById(mr._id).populate(populateFields);
      res.status(201).json({ data: await serializeMaterialRequestEnriched(populated, req.user.role) });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/:id', param('id').isMongoId(), validate, async (req, res, next) => {
  try {
    const mr = await MaterialRequest.findById(req.params.id).populate(populateFields);
    if (!mr) {
      return res.status(404).json({ statusCode: 404, message: 'Request not found' });
    }

    if (mr.origin === 'EXECUTIVE' && HIDE_HO_ORIGIN_ROLES.includes(req.user.role)) {
      return res.status(404).json({ statusCode: 404, message: 'Request not found' });
    }

    if (!executiveCanAccessIndent(req.user, mr)) {
      return res.status(403).json({ statusCode: 403, message: 'Forbidden' });
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

    const data = await serializeMaterialRequestEnriched(mr, req.user.role);
    if (req.user.role === UserRole.PROJECT_MANAGER) {
      const { enrichIndentWithCrossProjectStock } = require('../services/pmCrossProjectStockService');
      const cross = await enrichIndentWithCrossProjectStock(mr, req.user);
      const lineItems = data.items || [];
      data.crossProjectStock = (cross || []).map((row) => {
        const item = lineItems.find((l) => l.materialId === row.materialId);
        return { ...row, materialName: item?.material?.name || row.materialName };
      });
    }

    res.json({ data });
  } catch (err) {
    next(err);
  }
});

async function resolveIndentLineItems(rawItems, createdByUserId) {
  const { resolveIndentLineItems: resolveItems } = require('../services/siteMaterialService');
  return resolveItems(rawItems, { createdByUserId });
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
    body('purpose').trim().notEmpty().withMessage('Reason for request is required').isLength({ max: 500 }),
    body('requestedByName').trim().notEmpty().withMessage('Request by name is required').isLength({ max: 120 }),
    body('indentCategoryId').isMongoId().withMessage('Indent category is required'),
    body('indentRequestType').isIn(['BELOW_5000', 'ABOVE_5000']),
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

      const resolvedItems = await resolveIndentLineItems(items, req.user._id);
      if (!resolvedItems.length) {
        return res.status(400).json({
          statusCode: 400,
          message: 'At least one material item is required (catalog or custom name)',
        });
      }

      const { validateIndentRequestTypeForCreate } = require('../services/indentRequestTypeService');
      await validateIndentRequestTypeForCreate(req.body.indentRequestType, resolvedItems);
      await resolveIndentCategory(req.body.indentCategoryId);

      const project = site.projectId;
      const indentNumber = await generateIndentNumber(project.code);

      const mr = await MaterialRequest.create({
        indentNumber,
        projectId: project._id,
        siteId: site._id,
        items: resolvedItems,
        requestedByUserId: req.user._id,
        purpose: req.body.purpose.trim(),
        requestedByName: req.body.requestedByName.trim(),
        indentCategoryId: req.body.indentCategoryId,
        indentRequestType: req.body.indentRequestType,
        requiredByDate: req.body.requiredByDate ? new Date(req.body.requiredByDate) : undefined,
        status: 'PENDING_STORE',
        pendingWithRole: 'STORE_INCHARGE',
      });

      mr.estimatedValue = await estimateIndentAmount(mr);
      await mr.save();

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
      res.status(201).json({
        data: await serializeMaterialRequestEnriched(populated, req.user.role),
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
      }
      next(err);
    }
  }
);

router.post(
  '/:id/allocate',
  requireCapability('ALLOCATE_MATERIAL_REQUEST'),
  [
    param('id').isMongoId(),
    body('decision').isIn(['issue', 'forward']).withMessage('decision must be issue or forward'),
    body('remark').trim().notEmpty().withMessage('Remark is required'),
  ],
  validate,
  async (req, res, next) => {
    return handleIdempotent(req, res, `mr-allocate:${req.params.id}:${req.body.decision}`, async () => {
      const mr = await MaterialRequest.findById(req.params.id);
      if (!mr) return { statusCode: 404, body: { statusCode: 404, message: 'Request not found' } };

      if (!userCanAccessSite(req.user, mr.siteId)) {
        return { statusCode: 403, body: { statusCode: 403, message: 'Forbidden: not your site' } };
      }

      const { decision } = req.body;
      if (mr.status !== 'PENDING_STORE') {
        if (decision === 'forward' && FORWARDED_STATUSES.includes(mr.status)) {
          return { statusCode: 200, body: await mrEnrichedBody(mr._id, req.user.role) };
        }
        if (decision === 'issue' && mr.status === 'ALLOCATED') {
          return { statusCode: 200, body: await mrEnrichedBody(mr._id, req.user.role) };
        }
        return { statusCode: 400, body: { statusCode: 400, message: 'Request is not pending store action' } };
      }

      const remark = requireRemark(req.body.remark);
      const stockContext = await enrichIndentWithStock(mr);

      if (decision === 'forward' || decision === 'issue') {
        if (decision === 'issue' && !stockContext.canFullyIssue) {
          return {
            statusCode: 400,
            body: {
              statusCode: 400,
              message:
                'Cannot verify partial indent — one or more lines are short on stock. Forward the entire indent to PM instead.',
            },
          };
        }

        await forwardIndentToPm(mr, req.user._id, remark, {
          storeStockVerified: decision === 'issue' && stockContext.canFullyIssue,
        });

        req.auditEntityType = 'MaterialRequest';
        req.auditEntityId = mr._id;

        return { statusCode: 200, body: await mrEnrichedBody(mr._id, req.user.role) };
      }

      return { statusCode: 400, body: { statusCode: 400, message: 'Invalid decision' } };
    }, next);
  }
);

router.post(
  '/:id/forward',
  requireCapability('FORWARD_MATERIAL_REQUEST'),
  [
    param('id').isMongoId(),
    body('remark').optional().trim(),
    body('reason').optional().trim(),
  ],
  validate,
  async (req, res, next) => {
    return handleIdempotent(req, res, `mr-forward:${req.params.id}`, async () => {
      const remark = String(req.body.remark || req.body.reason || '').trim();
      if (!remark) {
        return {
          statusCode: 400,
          body: { statusCode: 400, message: 'Remark is required before forwarding this indent' },
        };
      }

      const mr = await MaterialRequest.findById(req.params.id);
      if (!mr) return { statusCode: 404, body: { statusCode: 404, message: 'Request not found' } };

      if (!userCanAccessSite(req.user, mr.siteId) && req.user.role !== UserRole.PROJECT_MANAGER) {
        if (req.user.role === UserRole.PROJECT_MANAGER && !userCanAccessProject(req.user, mr.projectId)) {
          return { statusCode: 403, body: { statusCode: 403, message: 'Forbidden' } };
        }
        if (req.user.role !== UserRole.PROJECT_MANAGER) {
          return { statusCode: 403, body: { statusCode: 403, message: 'Forbidden: not your site' } };
        }
      }

      if (mr.status === 'FORWARDED_TO_PM') {
        return { statusCode: 200, body: { ...(await mrEnrichedBody(mr._id, req.user.role)), message: 'Already forwarded to PM' } };
      }

      if (!['ALLOCATED', 'PENDING_STORE'].includes(mr.status)) {
        return {
          statusCode: 400,
          body: { statusCode: 400, message: 'Request cannot be forwarded in current status' },
        };
      }

      const fromStatus = mr.status;
      mr.status = 'FORWARDED_TO_PM';
      mr.pendingWithRole = 'PROJECT_MANAGER';
      mr.estimatedValue = await estimateIndentAmount(mr);
      await mr.save();

      try {
        await statusHistoryService.record(
          'MaterialRequest',
          mr._id,
          fromStatus,
          'FORWARDED_TO_PM',
          req.user._id,
          remark
        );
      } catch (histErr) {
        console.error('Forward status history failed:', histErr.message);
      }

      try {
        const pmUsers = await User.find({
          role: UserRole.PROJECT_MANAGER,
          assignedProjectIds: mr.projectId,
        });
        await notificationService.notifyUsers(
          pmUsers.map((u) => u._id),
          await buildPmIndentNotification(mr)
        );
      } catch (notifyErr) {
        console.error('Forward notification failed:', notifyErr.message);
      }

      req.auditEntityType = 'MaterialRequest';
      req.auditEntityId = mr._id;

      return { statusCode: 200, body: await mrEnrichedBody(mr._id, req.user.role) };
    }, next);
  }
);

router.post(
  '/:id/store-reject',
  requireCapability('ALLOCATE_MATERIAL_REQUEST'),
  [
    param('id').isMongoId(),
    body('remark').trim().notEmpty().withMessage('Remark is required'),
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

      const remark = requireRemark(req.body.remark);
      const fromStatus = mr.status;
      mr.status = 'REJECTED';
      mr.pendingWithRole = null;
      await mr.save();

      await statusHistoryService.record(
        'MaterialRequest',
        mr._id,
        fromStatus,
        'REJECTED',
        req.user._id,
        remark
      );

      await notificationService.notifyUser(mr.requestedByUserId, {
        title: 'Indent rejected by store',
        body: `${mr.indentNumber} was not approved: ${remark}`,
        relatedEntityType: 'MaterialRequest',
        relatedEntityId: mr._id,
      });

      const populated = await MaterialRequest.findById(mr._id).populate(populateFields);
      res.json({ data: await serializeMaterialRequestEnriched(populated, req.user.role) });
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
  requirePmApproval(),
  param('id').isMongoId(),
  validate,
  async (req, res, next) => {
    return handleIdempotent(req, res, `mr-approve:${req.params.id}`, async () => {
      const mr = req._materialRequest || (await MaterialRequest.findById(req.params.id));
      if (!mr) {
        return { statusCode: 404, body: { statusCode: 404, message: 'Request not found' } };
      }

      const actingRole = req.approvalContext.principal.role;
      const pmId = req.approvalContext.principal._id;

      if (actingRole === UserRole.PROJECT_MANAGER) {
        if (mr.status !== 'FORWARDED_TO_PM') {
          if (['PM_APPROVED', 'PURCHASE_REQUESTED', 'PENDING_HO', 'PENDING_EXECUTIVE_DECISION'].includes(mr.status)) {
            return { statusCode: 200, body: await mrEnrichedBody(mr._id, req.user.role) };
          }
          return { statusCode: 400, body: { statusCode: 400, message: 'Request not awaiting PM approval' } };
        }

        if (!mr.estimatedValue) mr.estimatedValue = await estimateIndentAmount(mr);
        const capCheck = await checkPmCanApprove(pmId, mr);

        if (capCheck.wouldExceed) {
          const fromStatus = mr.status;
          mr.status = 'PENDING_HO';
          mr.escalatedToHo = true;
          mr.escalatedAt = new Date();
          mr.pendingWithRole = 'EXECUTIVE';
          await mr.save();

          await statusHistoryService.record(
            'MaterialRequest',
            mr._id,
            fromStatus,
            'PENDING_HO',
            req.user._id,
            `Escalated: exceeds ₹${pmApprovalCapService.MR_PM_DAILY_MAX_INR.toLocaleString('en-IN')} daily limit`
          );

          await notifyExecutivesForIndent(mr.indentCategoryId, notificationService, {
            title: 'New Procurement Decision Pending',
            body: `${mr.indentNumber} exceeds PM daily approval cap.`,
            relatedEntityType: 'ProcurementDecision',
            relatedEntityId: mr._id,
          });

          const enriched = await mrEnrichedBody(mr._id, req.user.role);
          return {
            statusCode: 409,
            body: {
              statusCode: 409,
              message: `Escalated: exceeds ₹${pmApprovalCapService.MR_PM_DAILY_MAX_INR.toLocaleString('en-IN')} daily limit`,
              escalated: true,
              dailyApprovedTotal: capCheck.dailyApprovedTotal,
              dailyCap: capCheck.dailyCap,
              ...enriched,
            },
          };
        }
      } else if ([UserRole.EXECUTIVE, UserRole.COORDINATOR].includes(actingRole)) {
        return {
          statusCode: 400,
          body: {
            statusCode: 400,
            message: 'Use Procurement Decisions to review indents forwarded to Head Office',
          },
        };
      } else if (actingRole === UserRole.CHAIRMAN) {
        // Chairman final approval path (legacy)
      } else {
        return { statusCode: 403, body: { statusCode: 403, message: 'Forbidden' } };
      }

      const fromStatus = mr.status;
      const toStatus = actingRole === UserRole.CHAIRMAN ? 'CHAIRMAN_APPROVED' : 'PM_APPROVED';
      mr.status = toStatus;
      if (!mr.estimatedValue) mr.estimatedValue = await estimateIndentAmount(mr);
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

      const dailyApprovedTotal =
        actingRole === UserRole.PROJECT_MANAGER
          ? await getPmDailyApprovedTotal(pmId)
          : undefined;

      const enriched = await mrEnrichedBody(mr._id, req.user.role);
      return {
        statusCode: 200,
        body: {
          ...enriched,
          escalated: false,
          dailyApprovedTotal,
          dailyCap: pmApprovalCapService.MR_PM_DAILY_MAX_INR,
        },
      };
    }, next);
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
      if (
        [UserRole.EXECUTIVE, UserRole.COORDINATOR].includes(actingRole) &&
        mr.status !== 'PENDING_HO'
      ) {
        return res.status(400).json({ statusCode: 400, message: 'Request not in Head Office queue' });
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
  '/:id/pm-local-close',
  requirePmApproval(),
  [
    param('id').isMongoId(),
    body('remark').trim().notEmpty().withMessage('Remark is required'),
  ],
  validate,
  async (req, res, next) => {
    return handleIdempotent(req, res, `mr-pm-close:${req.params.id}`, async () => {
      const mr = req._materialRequest || (await MaterialRequest.findById(req.params.id));
      if (!mr) {
        return { statusCode: 404, body: { statusCode: 404, message: 'Request not found' } };
      }

      if (req.approvalContext.principal.role !== UserRole.PROJECT_MANAGER) {
        return { statusCode: 403, body: { statusCode: 403, message: 'Only Project Managers can approve locally' } };
      }

      if (mr.status !== 'FORWARDED_TO_PM') {
        return { statusCode: 400, body: { statusCode: 400, message: 'Indent is not awaiting PM review' } };
      }

      if (!mr.estimatedValue) mr.estimatedValue = await estimateIndentAmount(mr);
      const pmId = req.approvalContext.principal._id;
      const stockContext = await enrichIndentWithStock(mr);
      const canIssueFromStock = stockContext.canFullyIssue;

      if (!canIssueFromStock) {
        const capCheck = await checkPmCanApprove(pmId, mr);
        if (capCheck.wouldExceed) {
          return {
            statusCode: 409,
            body: {
              statusCode: 409,
              message: `Cannot close locally — exceeds ₹${pmApprovalCapService.MR_PM_DAILY_MAX_INR.toLocaleString('en-IN')} daily limit. Forward to Head Office instead.`,
              escalated: true,
            },
          };
        }
      }

      const remark = requireRemark(req.body.remark);
      const fromStatus = mr.status;

      if (canIssueFromStock) {
        try {
          await allocateIndentStock(mr, req.user._id);
          mr.status = 'ALLOCATED';
          mr.pendingWithRole = 'STORE_INCHARGE';
        } catch (allocErr) {
          if (allocErr.statusCode) {
            return {
              statusCode: allocErr.statusCode,
              body: { statusCode: allocErr.statusCode, message: allocErr.message },
            };
          }
          throw allocErr;
        }
      } else {
        mr.status = 'PM_APPROVED';
        mr.pendingWithRole = 'STORE_INCHARGE';
      }

      mr.pmForwardRemark = remark;
      await mr.save();

      await statusHistoryService.record(
        'MaterialRequest',
        mr._id,
        fromStatus,
        mr.status,
        req.user._id,
        `PM approved & closed locally (no HO escalation): ${remark}`
      );

      const storeUsers = await User.find({
        role: UserRole.STORE_INCHARGE,
        assignedSiteId: mr.siteId,
      });
      await notificationService.notifyUsers(
        storeUsers.map((u) => u._id),
        {
          title: 'Indent approved by PM — ready to issue',
          body: `${mr.indentNumber} approved — ${mr.status === 'ALLOCATED' ? 'stock reserved, issue material' : 'proceed with fulfillment'}.`,
          relatedEntityType: 'MaterialRequest',
          relatedEntityId: mr._id,
        }
      );

      await notificationService.notifyUser(mr.requestedByUserId, {
        title: 'Indent approved',
        body: `Your request ${mr.indentNumber} was approved by the Project Manager.`,
        relatedEntityType: 'MaterialRequest',
        relatedEntityId: mr._id,
      });

      return { statusCode: 200, body: await mrEnrichedBody(mr._id, req.user.role) };
    }, next);
  }
);

router.post(
  '/:id/forward-to-ho',
  requirePmApproval(),
  [
    param('id').isMongoId(),
    body('remark').trim().notEmpty().withMessage('Remark is required'),
  ],
  validate,
  async (req, res, next) => {
    return handleIdempotent(req, res, `mr-forward-ho:${req.params.id}`, async () => {
      const mr = req._materialRequest || (await MaterialRequest.findById(req.params.id));
      if (!mr) {
        return { statusCode: 404, body: { statusCode: 404, message: 'Request not found' } };
      }

      if (req.approvalContext.principal.role !== UserRole.PROJECT_MANAGER) {
        return { statusCode: 403, body: { statusCode: 403, message: 'Only Project Managers can forward to Head Office' } };
      }

      if (mr.status !== 'FORWARDED_TO_PM') {
        if (
          [
            'PURCHASE_REQUESTED',
            'PENDING_HO',
            'PENDING_EXECUTIVE_DECISION',
            'EXECUTIVE_DECISION_PO',
            'EXECUTIVE_DECISION_BRANCH_TRANSFER',
            'PM_APPROVED',
          ].includes(mr.status)
        ) {
          return { statusCode: 200, body: await mrEnrichedBody(mr._id, req.user.role) };
        }
        return {
          statusCode: 400,
          body: { statusCode: 400, message: 'Indent is not awaiting PM review' },
        };
      }

      const remark = requireRemark(req.body.remark);
      if (!mr.estimatedValue) mr.estimatedValue = await estimateIndentAmount(mr);

      await queueForExecutiveDecision(
        mr,
        req.user._id,
        remark,
        `Forwarded to Head Office (insufficient stock): ${remark}`
      );

      await notificationService.notifyUser(mr.requestedByUserId, {
        title: 'Indent forwarded to Head Office',
        body: `${mr.indentNumber} — awaiting executive procurement decision.`,
        relatedEntityType: 'MaterialRequest',
        relatedEntityId: mr._id,
      });

      const enriched = await mrEnrichedBody(mr._id, req.user.role);
      return {
        statusCode: 200,
        body: {
          ...enriched,
          message: 'Forwarded to Head Office — awaiting executive procurement decision',
        },
      };
    }, next);
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
