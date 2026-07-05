const express = require('express');
const { body, param } = require('express-validator');
const { UserRole } = require('@afios/shared');
const { BranchTransfer, Site, MaterialRequest } = require('../models');
const { authenticate } = require('../middleware/auth');
const { requireCapability } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { assertCanAccessBranchTransfer } = require('../middleware/projectScope');
const { generateTransferNumber } = require('../services/documentNumberService');
const notificationService = require('../services/notificationService');
const statusHistoryService = require('../services/statusHistoryService');
const { executeBranchTransfer } = require('../services/branchTransferExecutionService');
const {
  getProjectManagers,
  userManagesProject,
  serializeTransferRow,
  transferActionFlags,
} = require('../services/branchTransferService');
const { handleIdempotent } = require('../utils/idempotentHandler');

const PM_APPROVED_BT = ['PM_APPROVED', 'COORDINATOR_DECIDED', 'RAISE_PO_INSTEAD', 'TRANSFERRED'];
const COORDINATOR_DECIDED_BT = ['COORDINATOR_DECIDED', 'RAISE_PO_INSTEAD', 'TRANSFERRED'];

async function btResponse(transferId) {
  const populated = await BranchTransfer.findById(transferId).populate(transferPopulate);
  return { statusCode: 200, body: { data: serializeTransferRow(populated) } };
}

const router = express.Router();
router.use(authenticate);

const transferPopulate =
  'fromProjectId toProjectId fromSiteId toSiteId items.materialId requestedByUserId pmApprovedByUserId coordinatorDecidedByUserId executedByUserId rejectedByUserId materialRequestId';

async function loadTransfer(req, res, next) {
  try {
    const t = await BranchTransfer.findById(req.params.id).populate(transferPopulate);
    if (!t) return res.status(404).json({ statusCode: 404, message: 'Not found' });
    assertCanAccessBranchTransfer(req.user, t);
    req.branchTransfer = t;
    next();
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
    next(err);
  }
}

router.get('/targets/search', async (req, res, next) => {
  try {
    const { searchBranchTransferTargets } = require('../services/searchService');
    const data = await searchBranchTransferTargets(req.query.q, req.user, {
      fromProjectId: req.query.fromProjectId,
      excludeProjectId: req.query.excludeProjectId,
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    if (req.user.role === UserRole.SITE_INCHARGE) {
      return res.status(403).json({
        statusCode: 403,
        message: 'Site role cannot access branch transfers',
      });
    }

    const filter = {};
    if (req.user.role === UserRole.PROJECT_MANAGER) {
      filter.$or = [
        { fromProjectId: { $in: req.user.assignedProjectIds } },
        { toProjectId: { $in: req.user.assignedProjectIds } },
      ];
    } else if (req.user.role === UserRole.STORE_INCHARGE && req.user.assignedSiteId) {
      const site = await Site.findById(req.user.assignedSiteId).select('projectId');
      if (site?.projectId) {
        filter.$or = [{ fromProjectId: site.projectId }, { toProjectId: site.projectId }];
      }
    } else if (req.query.status) {
      filter.status = req.query.status;
    }

    const transfers = await BranchTransfer.find(filter)
      .sort({ createdAt: -1 })
      .populate(transferPopulate)
      .limit(100);

    res.json({
      data: transfers.map((t) => {
        const row = serializeTransferRow(t);
        return { ...row, ...transferActionFlags(t, req.user) };
      }),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', param('id').isMongoId(), validate, loadTransfer, async (req, res, next) => {
  try {
    const row = serializeTransferRow(req.branchTransfer);
    res.json({
      data: { ...row, ...transferActionFlags(req.branchTransfer, req.user) },
    });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/',
  requireCapability('CREATE_BRANCH_TRANSFER'),
  [
    body('fromProjectId').isMongoId(),
    body('toProjectId').optional().isMongoId(),
    body('items').isArray({ min: 1 }),
    body('items.*.materialId').isMongoId(),
    body('items.*.quantity').isFloat({ min: 0.01 }),
    body('note').optional().trim(),
    body('materialRequestId').optional().isMongoId(),
  ],
  validate,
  async (req, res, next) => {
    const scopeKey = req.body.materialRequestId
      ? `bt-create:mr:${req.body.materialRequestId}`
      : `bt-create:${req.body.fromProjectId}:${req.body.toProjectId}`;
    return handleIdempotent(req, res, scopeKey, async () => {
      let { fromProjectId, toProjectId, items, note, materialRequestId } = req.body;

      if (req.user.role === UserRole.STORE_INCHARGE) {
        if (!req.user.assignedSiteId) {
          return { statusCode: 400, body: { statusCode: 400, message: 'Store user has no assigned site' } };
        }
        const site = await Site.findById(req.user.assignedSiteId).select('projectId');
        if (!site?.projectId) {
          return { statusCode: 400, body: { statusCode: 400, message: 'Store site has no project' } };
        }
        toProjectId = site.projectId.toString();
      } else {
        return {
          statusCode: 403,
          body: { statusCode: 403, message: 'Only store users can initiate branch transfers' },
        };
      }

      if (!toProjectId) {
        return { statusCode: 400, body: { statusCode: 400, message: 'Destination project is required' } };
      }
      if (fromProjectId === toProjectId) {
        return { statusCode: 400, body: { statusCode: 400, message: 'Source and destination projects must differ' } };
      }

      const { userCanAccessProject } = require('../utils/serialize');
      if (!userCanAccessProject(req.user, toProjectId)) {
        return { statusCode: 403, body: { statusCode: 403, message: 'Forbidden — project out of scope' } };
      }

      if (materialRequestId) {
        const mr = await MaterialRequest.findById(materialRequestId);
        if (!mr) return { statusCode: 404, body: { statusCode: 404, message: 'Linked indent not found' } };
      }

      const transferNumber = await generateTransferNumber();
      const transfer = await BranchTransfer.create({
        transferNumber,
        fromProjectId,
        toProjectId,
        items,
        note: note || '',
        materialRequestId: materialRequestId || undefined,
        requestedByUserId: req.user._id,
        status: 'REQUESTED',
      });

      await statusHistoryService.record(
        'BranchTransfer',
        transfer._id,
        null,
        'REQUESTED',
        req.user._id,
        `Branch transfer ${transferNumber} requested`
      );

      const destinationPms = await getProjectManagers(toProjectId);
      for (const pm of destinationPms) {
        await notificationService.notifyUser(pm._id, {
          title: 'Branch transfer awaiting PM approval',
          body: `${transferNumber}: stock requested from another project — review and approve.`,
          relatedEntityType: 'BranchTransfer',
          relatedEntityId: transfer._id,
        });
      }

      return {
        statusCode: 201,
        body: {
          data: {
            id: transfer._id.toString(),
            transferNumber: transfer.transferNumber,
            status: transfer.status,
          },
        },
      };
    }, next);
  }
);

router.post(
  '/:id/pm-approve',
  requireCapability('APPROVE_MATERIAL_REQUEST'),
  [param('id').isMongoId(), body('note').optional().trim()],
  validate,
  loadTransfer,
  async (req, res, next) => {
    return handleIdempotent(req, res, `bt-pm-approve:${req.params.id}`, async () => {
      const transfer = req.branchTransfer;
      if (transfer.status !== 'REQUESTED') {
        if (PM_APPROVED_BT.includes(transfer.status)) {
          return { statusCode: 200, body: { data: { id: transfer._id.toString(), status: transfer.status } } };
        }
        return { statusCode: 400, body: { statusCode: 400, message: 'Transfer not awaiting PM approval' } };
      }
      if (!userManagesProject(req.user, transfer.toProjectId)) {
        return { statusCode: 403, body: { statusCode: 403, message: 'Only destination project PM can approve' } };
      }

      const fromStatus = transfer.status;
      transfer.status = 'PM_APPROVED';
      transfer.pmApprovedByUserId = req.user._id;
      transfer.pmApprovedAt = new Date();
      await transfer.save();

      await statusHistoryService.record(
        'BranchTransfer',
        transfer._id,
        fromStatus,
        transfer.status,
        req.user._id,
        req.body.note || 'PM approved branch transfer'
      );

      const { User } = require('../models');
      const coordinators = await User.find({ role: UserRole.COORDINATOR });
      for (const c of coordinators) {
        await notificationService.notifyUser(c._id, {
          title: 'Branch transfer decision required',
          body: `${transfer.transferNumber}: PM approved — confirm transfer or raise PO instead.`,
          relatedEntityType: 'BranchTransfer',
          relatedEntityId: transfer._id,
        });
      }

      return { statusCode: 200, body: { data: { id: transfer._id.toString(), status: transfer.status } } };
    }, next);
  }
);

router.post(
  '/:id/pm-reject',
  requireCapability('APPROVE_MATERIAL_REQUEST'),
  [param('id').isMongoId(), body('note').optional().trim()],
  validate,
  loadTransfer,
  async (req, res, next) => {
    try {
      const transfer = req.branchTransfer;
      if (transfer.status !== 'REQUESTED') {
        return res.status(400).json({ statusCode: 400, message: 'Transfer not awaiting PM approval' });
      }
      if (!userManagesProject(req.user, transfer.toProjectId)) {
        return res.status(403).json({ statusCode: 403, message: 'Only destination project PM can reject' });
      }

      const fromStatus = transfer.status;
      transfer.status = 'REJECTED';
      transfer.rejectedByUserId = req.user._id;
      transfer.rejectionNote = req.body.note || 'Rejected by project manager';
      await transfer.save();

      await statusHistoryService.record(
        'BranchTransfer',
        transfer._id,
        fromStatus,
        transfer.status,
        req.user._id,
        transfer.rejectionNote
      );

      await notificationService.notifyUser(transfer.requestedByUserId, {
        title: 'Branch transfer rejected',
        body: `${transfer.transferNumber} was rejected by the project manager.`,
        relatedEntityType: 'BranchTransfer',
        relatedEntityId: transfer._id,
      });

      res.json({ data: { id: transfer._id.toString(), status: transfer.status } });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/coordinator-decide',
  requireCapability('VERIFY_RECORDS'),
  [
    param('id').isMongoId(),
    body('decision').isIn(['transfer', 'raise_po_instead']),
    body('note').optional().trim(),
    body('fromProjectId').optional().isMongoId(),
    body('toProjectId').optional().isMongoId(),
    body('items').optional().isArray({ min: 1 }),
    body('items.*.materialId').optional().isMongoId(),
    body('items.*.quantity').optional().isFloat({ min: 0.01 }),
  ],
  validate,
  loadTransfer,
  async (req, res, next) => {
    return handleIdempotent(req, res, `bt-coordinator-decide:${req.params.id}:${req.body.decision}`, async () => {
      const transfer = req.branchTransfer;
      if (transfer.status !== 'PM_APPROVED') {
        if (COORDINATOR_DECIDED_BT.includes(transfer.status)) {
          let redirect = null;
          if (transfer.status === 'RAISE_PO_INSTEAD' && transfer.materialRequestId) {
            redirect = {
              type: 'indent',
              materialRequestId: transfer.materialRequestId.toString(),
              path: `/requests/${transfer.materialRequestId}`,
            };
          } else if (transfer.status === 'RAISE_PO_INSTEAD') {
            redirect = { type: 'po', path: '/executive/po/new' };
          }
          return {
            statusCode: 200,
            body: {
              data: {
                id: transfer._id.toString(),
                status: transfer.status,
                coordinatorDecision: transfer.coordinatorDecision,
                redirect,
              },
            },
          };
        }
        return { statusCode: 400, body: { statusCode: 400, message: 'Transfer not awaiting coordinator decision' } };
      }

      if (req.body.fromProjectId) transfer.fromProjectId = req.body.fromProjectId;
      if (req.body.toProjectId) transfer.toProjectId = req.body.toProjectId;
      if (req.body.items?.length) transfer.items = req.body.items;

      const fromStatus = transfer.status;
      transfer.coordinatorDecidedByUserId = req.user._id;
      transfer.coordinatorDecidedAt = new Date();
      transfer.coordinatorDecision = req.body.decision;

      let redirect = null;

      if (req.body.decision === 'transfer') {
        transfer.status = 'COORDINATOR_DECIDED';
      } else {
        transfer.status = 'RAISE_PO_INSTEAD';
        if (transfer.materialRequestId) {
          const mr = await MaterialRequest.findById(transfer.materialRequestId);
          if (mr && !['FORWARDED_TO_PM', 'PM_APPROVED', 'PO_CREATED'].includes(mr.status)) {
            const prev = mr.status;
            mr.status = 'FORWARDED_TO_PM';
            await mr.save();
            await statusHistoryService.record(
              'MaterialRequest',
              mr._id,
              prev,
              'FORWARDED_TO_PM',
              req.user._id,
              'Coordinator chose PO instead of branch transfer'
            );
          }
          redirect = {
            type: 'indent',
            materialRequestId: transfer.materialRequestId.toString(),
            path: `/requests/${transfer.materialRequestId}`,
          };
        } else {
          redirect = { type: 'po', path: '/executive/po/new' };
        }
      }

      await transfer.save();

      await statusHistoryService.record(
        'BranchTransfer',
        transfer._id,
        fromStatus,
        transfer.status,
        req.user._id,
        req.body.note || `Coordinator decision: ${req.body.decision}`
      );

      return {
        statusCode: 200,
        body: {
          data: {
            id: transfer._id.toString(),
            status: transfer.status,
            coordinatorDecision: transfer.coordinatorDecision,
            redirect,
          },
        },
      };
    }, next);
  }
);

router.post(
  '/:id/execute',
  requireCapability('VERIFY_RECORDS'),
  [param('id').isMongoId(), body('note').optional().trim()],
  validate,
  loadTransfer,
  async (req, res, next) => {
    return handleIdempotent(req, res, `bt-execute:${req.params.id}`, async () => {
      const transfer = req.branchTransfer;
      if (transfer.status === 'TRANSFERRED') return btResponse(transfer._id);
      if (transfer.status !== 'COORDINATOR_DECIDED' || transfer.coordinatorDecision !== 'transfer') {
        return {
          statusCode: 400,
          body: { statusCode: 400, message: 'Transfer must be coordinator-confirmed before execution' },
        };
      }

      const fromStatus = transfer.status;
      await executeBranchTransfer(transfer, req.user._id);

      await statusHistoryService.record(
        'BranchTransfer',
        transfer._id,
        fromStatus,
        'TRANSFERRED',
        req.user._id,
        req.body.note || 'Stock transferred between projects'
      );

      await notificationService.notifyUser(transfer.requestedByUserId, {
        title: 'Branch transfer completed',
        body: `${transfer.transferNumber}: stock has been transferred.`,
        relatedEntityType: 'BranchTransfer',
        relatedEntityId: transfer._id,
      });

      return btResponse(transfer._id);
    }, next);
  }
);

module.exports = router;
