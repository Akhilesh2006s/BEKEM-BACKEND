const express = require('express');
const { body, param } = require('express-validator');
const { UserRole } = require('@afios/shared');
const { BranchTransfer, Site, MaterialRequest, Project, User } = require('../models');
const { authenticate } = require('../middleware/auth');
const { requireCapability } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { assertCanAccessBranchTransfer } = require('../middleware/projectScope');
const { generateTransferNumber } = require('../services/documentNumberService');
const notificationService = require('../services/notificationService');
const statusHistoryService = require('../services/statusHistoryService');
const { executeBranchTransfer, dispatchBranchTransfer, receiveBranchTransfer } = require('../services/branchTransferExecutionService');
const {
  getProjectManagers,
  userManagesProject,
  serializeTransferRow,
  transferActionFlags,
  CLOSED_INDENT_BT_STATUSES,
  createIndentLinkedTransfers,
} = require('../services/branchTransferService');
const { handleIdempotent } = require('../utils/idempotentHandler');

const COORDINATOR_DECIDED_BT = ['COORDINATOR_DECIDED', 'RAISE_PO_INSTEAD', 'TRANSFERRED'];

async function btResponse(transferId, user) {
  const populated = await BranchTransfer.findById(transferId)
    .populate(transferPopulate)
    .populate('receiptGrnIds', 'grnNumber challanNo receivedAt receivedQuantity status createdAt');
  const row = serializeTransferRow({
    ...populated.toObject(),
    receiptGrns: populated.receiptGrnIds,
  });
  return {
    statusCode: 200,
    body: { data: { ...row, ...transferActionFlags(populated, user) } },
  };
}

const router = express.Router();
router.use(authenticate);

const transferPopulate =
  'fromProjectId toProjectId fromSiteId toSiteId items.materialId requestedByUserId pmApprovedByUserId coordinatorDecidedByUserId executedByUserId rejectedByUserId materialRequestId dispatchedByUserId executiveApprovedByUserId';

async function loadTransfer(req, res, next) {
  try {
    const t = await BranchTransfer.findById(req.params.id)
      .populate(transferPopulate)
      .populate('receiptGrnIds', 'grnNumber challanNo receivedAt receivedQuantity status createdAt');
    if (!t) return res.status(404).json({ statusCode: 404, message: 'Not found' });
    assertCanAccessBranchTransfer(req.user, t);
    req.branchTransfer = t;
    next();
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
    }
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

    if (req.user.role === UserRole.STORE_INCHARGE) {
      return res.status(403).json({
        statusCode: 403,
        message: 'Store cannot access branch transfers — contact your Project Manager',
      });
    }

    const filter = {};
    if (req.user.role === UserRole.PROJECT_MANAGER) {
      filter.$or = [
        { fromProjectId: { $in: req.user.assignedProjectIds } },
        { toProjectId: { $in: req.user.assignedProjectIds } },
      ];
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
    const t = req.branchTransfer;
    const row = serializeTransferRow({
      ...t.toObject(),
      receiptGrns: t.receiptGrnIds,
    });
    res.json({
      data: { ...row, ...transferActionFlags(t, req.user) },
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
    body('fromSiteId').optional().isMongoId(),
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
      let { fromProjectId, toProjectId, fromSiteId, items, note, materialRequestId } = req.body;

      if (req.user.role === UserRole.STORE_INCHARGE) {
        return {
          statusCode: 403,
          body: {
            statusCode: 403,
            message: 'Store cannot initiate branch transfers — Project Manager must request a transfer',
          },
        };
      }

      if (req.user.role === UserRole.PROJECT_MANAGER) {
        if (!materialRequestId) {
          // Standalone stock move: PM pulls into a project they manage from any
          // company project that has stock (Head Office still approves).
          if (!toProjectId) {
            return {
              statusCode: 400,
              body: { statusCode: 400, message: 'Destination project is required' },
            };
          }
          if (!userManagesProject(req.user, toProjectId)) {
            return {
              statusCode: 403,
              body: {
                statusCode: 403,
                message: 'You must manage the destination project receiving the stock',
              },
            };
          }
          if (!userManagesProject(req.user, fromProjectId)) {
            const sourceExists = await Project.findById(fromProjectId).select('_id');
            if (!sourceExists) {
              return {
                statusCode: 400,
                body: { statusCode: 400, message: 'Source project not found' },
              };
            }
          }
        } else {
          const mr = await MaterialRequest.findById(materialRequestId);
          if (!mr) {
            return { statusCode: 404, body: { statusCode: 404, message: 'Linked indent not found' } };
          }
          if (!['FORWARDED_TO_PM', 'BRANCH_TRANSFER_REQUESTED'].includes(mr.status)) {
            return {
              statusCode: 400,
              body: { statusCode: 400, message: 'Indent is not awaiting PM review' },
            };
          }

          const destProjectId = (mr.projectId?._id || mr.projectId).toString();
          toProjectId = destProjectId;

          if (!userManagesProject(req.user, toProjectId)) {
            return {
              statusCode: 403,
              body: { statusCode: 403, message: 'You do not manage the requesting project' },
            };
          }
          // Source may belong to another PM — Executive still approves; source PM dispatches.
          const sourceExists = await Project.findById(fromProjectId).select('_id');
          if (!sourceExists) {
            return {
              statusCode: 400,
              body: { statusCode: 400, message: 'Source project not found' },
            };
          }
        }
      } else {
        return {
          statusCode: 403,
          body: { statusCode: 403, message: 'Only Project Managers can initiate branch transfers' },
        };
      }

      if (!toProjectId) {
        return { statusCode: 400, body: { statusCode: 400, message: 'Destination project is required' } };
      }
      if (fromProjectId === toProjectId) {
        return { statusCode: 400, body: { statusCode: 400, message: 'Source and destination projects must differ' } };
      }

      const { userCanAccessProject } = require('../utils/serialize');
      // Destination must be in PM scope; source may be another company project.
      if (!userCanAccessProject(req.user, toProjectId)) {
        return { statusCode: 403, body: { statusCode: 403, message: 'Forbidden — project out of scope' } };
      }

      const mr = materialRequestId ? await MaterialRequest.findById(materialRequestId) : null;
      if (materialRequestId && !mr) {
        return { statusCode: 404, body: { statusCode: 404, message: 'Linked indent not found' } };
      }

      let toSiteId = mr?.siteId || undefined;
      if (fromSiteId) {
        const sourceSite = await Site.findById(fromSiteId).select('projectId');
        if (!sourceSite || sourceSite.projectId.toString() !== String(fromProjectId)) {
          return {
            statusCode: 400,
            body: { statusCode: 400, message: 'Source site must belong to the source project' },
          };
        }
        const { StockLedger } = require('../models');
        for (const item of items) {
          const ledger = await StockLedger.findOne({
            siteId: fromSiteId,
            materialId: item.materialId,
          }).select('quantityOnHand quantityReserved');
          const available = Math.max(
            0,
            (ledger?.quantityOnHand || 0) - (ledger?.quantityReserved || 0)
          );
          if (available < Number(item.quantity)) {
            return {
              statusCode: 400,
              body: {
                statusCode: 400,
                message: 'Insufficient stock at the selected source site for this transfer',
              },
            };
          }
        }
      }

      // Dedupe per source site so one indent can pull from several projects.
      if (materialRequestId) {
        const existingFilter = {
          materialRequestId,
          status: { $nin: CLOSED_INDENT_BT_STATUSES },
        };
        if (fromSiteId) existingFilter.fromSiteId = fromSiteId;
        const existingBt = await BranchTransfer.findOne(existingFilter);
        if (existingBt) {
          return {
            statusCode: 409,
            body: {
              statusCode: 409,
              message: fromSiteId
                ? 'A branch transfer is already in progress from this site for this indent'
                : 'A branch transfer is already in progress for this indent',
              data: { id: existingBt._id.toString(), transferNumber: existingBt.transferNumber },
            },
          };
        }
      }

      const transferNumber = await generateTransferNumber();
      const transfer = await BranchTransfer.create({
        transferNumber,
        fromProjectId,
        fromSiteId: fromSiteId || undefined,
        toProjectId,
        toSiteId: toSiteId || undefined,
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
        note?.trim()
          ? `Branch transfer ${transferNumber} requested by PM: ${note.trim()}`
          : `Branch transfer ${transferNumber} requested by PM`
      );

      if (materialRequestId && mr) {
        const prev = mr.status;
        mr.status = 'BRANCH_TRANSFER_REQUESTED';
        mr.pendingWithRole = 'EXECUTIVE';
        await mr.save();
        await statusHistoryService.record(
          'MaterialRequest',
          mr._id,
          prev,
          'BRANCH_TRANSFER_REQUESTED',
          req.user._id,
          `Branch transfer ${transferNumber} requested — no purchase order`
        );
      }

      const destinationPms = await getProjectManagers(toProjectId);
      const { User } = require('../models');
      const coordinators = await User.find({ role: UserRole.COORDINATOR });
      for (const c of coordinators) {
        await notificationService.notifyUser(c._id, {
          title: 'Branch transfer request — Executive review',
          body: `${transferNumber}: PM requested stock from another project — awaiting Executive approval.`,
          relatedEntityType: 'BranchTransfer',
          relatedEntityId: transfer._id,
        });
      }
      const executives = await User.find({ role: UserRole.EXECUTIVE });
      for (const exec of executives) {
        await notificationService.notifyUser(exec._id, {
          title: 'Branch transfer awaiting your approval',
          body: `${transferNumber}: review and approve or reject — no modifications allowed.`,
          relatedEntityType: 'BranchTransfer',
          relatedEntityId: transfer._id,
        });
      }
      for (const pm of destinationPms) {
        await notificationService.notifyUser(pm._id, {
          title: 'Branch transfer submitted',
          body: `${transferNumber} sent to Head Office for approval — you will be notified when decided.`,
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
  '/batch',
  requireCapability('CREATE_BRANCH_TRANSFER'),
  [
    body('materialRequestId').isMongoId(),
    body('note').optional().trim(),
    body('sources').isArray({ min: 1 }),
    body('sources.*.fromProjectId').isMongoId(),
    body('sources.*.fromSiteId').isMongoId(),
    body('sources.*.items').isArray({ min: 1 }),
    body('sources.*.items.*.materialId').isMongoId(),
    body('sources.*.items.*.quantity').isFloat({ min: 0.01 }),
  ],
  validate,
  async (req, res, next) => {
    return handleIdempotent(req, res, `bt-batch:mr:${req.body.materialRequestId}`, async () => {
      const result = await createIndentLinkedTransfers(req.user, {
        materialRequestId: req.body.materialRequestId,
        note: req.body.note,
        sources: req.body.sources,
      });
      if (!result.ok) {
        return { statusCode: result.statusCode, body: result.body };
      }
      return {
        statusCode: 201,
        body: {
          data: {
            transfers: result.transfers.map((t) => ({
              id: t._id.toString(),
              transferNumber: t.transferNumber,
              status: t.status,
              fromSiteId: t.fromSiteId?.toString(),
              fromProjectId: t.fromProjectId?.toString(),
            })),
          },
        },
      };
    }, next);
  }
);

router.post(
  '/:id/pm-approve',
  [param('id').isMongoId()],
  validate,
  async (_req, res) => {
    return res.status(403).json({
      statusCode: 403,
      message: 'Branch transfer approval is a Head Office responsibility — Project Managers cannot approve',
    });
  }
);

router.post(
  '/:id/pm-reject',
  [param('id').isMongoId()],
  validate,
  async (_req, res) => {
    return res.status(403).json({
      statusCode: 403,
      message: 'Branch transfer rejection is a Head Office responsibility — Project Managers cannot reject',
    });
  }
);

router.post(
  '/:id/executive-approve',
  requireCapability('CREATE_PO'),
  [param('id').isMongoId(), body('note').optional().trim()],
  validate,
  loadTransfer,
  async (req, res, next) => {
    try {
      const transfer = req.branchTransfer;
      if (transfer.status === 'EXECUTIVE_APPROVED' || transfer.status === 'DISPATCHED' || transfer.status === 'TRANSFERRED') {
        return res.json({
          data: { id: transfer._id.toString(), status: transfer.status, stockUpdated: false },
        });
      }
      if (transfer.status !== 'REQUESTED') {
        return res.status(400).json({ statusCode: 400, message: 'Transfer not awaiting Executive review' });
      }

      const fromStatus = transfer.status;
      transfer.status = 'EXECUTIVE_APPROVED';
      transfer.coordinatorDecision = 'transfer';
      transfer.executiveApprovedByUserId = req.user._id;
      transfer.executiveApprovedAt = new Date();
      transfer.pmApprovedByUserId = req.user._id;
      transfer.pmApprovedAt = new Date();
      transfer.coordinatorDecidedByUserId = req.user._id;
      transfer.coordinatorDecidedAt = new Date();
      if (req.body.note?.trim()) transfer.note = req.body.note.trim();
      await transfer.save();

      await statusHistoryService.record(
        'BranchTransfer',
        transfer._id,
        fromStatus,
        'EXECUTIVE_APPROVED',
        req.user._id,
        req.body.note?.trim() ||
          'Executive approved — source Project Manager must dispatch with challan and expected arrival'
      );

      const fromProjectId = transfer.fromProjectId?._id || transfer.fromProjectId;
      const toProjectId = transfer.toProjectId?._id || transfer.toProjectId;
      const sourcePms = await getProjectManagers(fromProjectId);
      for (const pm of sourcePms) {
        await notificationService.notifyUser(pm._id, {
          title: 'Dispatch branch transfer',
          body: `${transfer.transferNumber}: Executive approved. Confirm challan no. and expected arrival, then dispatch stock.`,
          relatedEntityType: 'BranchTransfer',
          relatedEntityId: transfer._id,
        });
      }
      const requesterId = transfer.requestedByUserId?._id || transfer.requestedByUserId;
      if (requesterId) {
        await notificationService.notifyUser(requesterId, {
          title: 'Branch transfer approved by Executive',
          body: `${transfer.transferNumber}: awaiting source project dispatch (challan / ETA).`,
          relatedEntityType: 'BranchTransfer',
          relatedEntityId: transfer._id,
        });
      }
      const destPms = await getProjectManagers(toProjectId);
      for (const pm of destPms) {
        if (requesterId && pm._id.toString() === requesterId.toString()) continue;
        await notificationService.notifyUser(pm._id, {
          title: 'Branch transfer approved',
          body: `${transfer.transferNumber}: source PM will dispatch; you will receive and post GRN after arrival.`,
          relatedEntityType: 'BranchTransfer',
          relatedEntityId: transfer._id,
        });
      }

      res.json({
        data: { id: transfer._id.toString(), status: transfer.status, stockUpdated: false },
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/dispatch',
  [
    param('id').isMongoId(),
    body('challanNo').trim().notEmpty().withMessage('Challan number is required'),
    body('expectedArrivalDate').isISO8601().withMessage('Expected arrival date is required'),
    body('dispatchNote').optional().trim(),
  ],
  validate,
  loadTransfer,
  async (req, res, next) => {
    try {
      const transfer = req.branchTransfer;
      if (req.user.role !== UserRole.PROJECT_MANAGER) {
        return res.status(403).json({ statusCode: 403, message: 'Only Project Managers can dispatch' });
      }
      if (transfer.status !== 'EXECUTIVE_APPROVED') {
        return res.status(400).json({
          statusCode: 400,
          message: 'Transfer must be Executive-approved before source PM dispatch',
        });
      }
      if (!userManagesProject(req.user, transfer.fromProjectId?._id || transfer.fromProjectId)) {
        return res.status(403).json({
          statusCode: 403,
          message: 'Only the source project PM can dispatch this transfer',
        });
      }

      const fromStatus = transfer.status;
      try {
        await dispatchBranchTransfer(transfer, req.user._id, {
          challanNo: req.body.challanNo,
          expectedArrivalDate: req.body.expectedArrivalDate,
          dispatchNote: req.body.dispatchNote,
        });
      } catch (execErr) {
        if (execErr.statusCode) {
          return res.status(execErr.statusCode).json({
            statusCode: execErr.statusCode,
            message: execErr.message,
          });
        }
        throw execErr;
      }

      await statusHistoryService.record(
        'BranchTransfer',
        transfer._id,
        fromStatus,
        'DISPATCHED',
        req.user._id,
        `Dispatched — challan ${req.body.challanNo}, expected ${req.body.expectedArrivalDate}${
          req.body.dispatchNote ? ` · ${req.body.dispatchNote}` : ''
        }`
      );

      const toProjectId = transfer.toProjectId?._id || transfer.toProjectId;
      const destPms = await getProjectManagers(toProjectId);
      for (const pm of destPms) {
        await notificationService.notifyUser(pm._id, {
          title: 'Branch transfer dispatched — await receipt',
          body: `${transfer.transferNumber}: challan ${req.body.challanNo}. Submit receipt / GRN when material arrives.`,
          relatedEntityType: 'BranchTransfer',
          relatedEntityId: transfer._id,
        });
      }

      const payload = await btResponse(transfer._id, req.user);
      res.json(payload.body);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/receive',
  [
    param('id').isMongoId(),
    body('challanNo').optional().trim(),
    body('note').optional().trim(),
    body('deliveryDate').optional().isISO8601(),
    body('items').optional().isArray(),
    body('items.*.materialId').optional().isMongoId(),
    body('items.*.quantity').optional().isFloat({ gt: 0 }),
  ],
  validate,
  loadTransfer,
  async (req, res, next) => {
    try {
      const transfer = req.branchTransfer;
      if (req.user.role !== UserRole.PROJECT_MANAGER) {
        return res.status(403).json({ statusCode: 403, message: 'Only Project Managers can receive' });
      }
      if (!['DISPATCHED', 'PARTIALLY_RECEIVED'].includes(transfer.status)) {
        return res.status(400).json({
          statusCode: 400,
          message: 'Transfer must be dispatched before receipt',
        });
      }
      if (!userManagesProject(req.user, transfer.toProjectId?._id || transfer.toProjectId)) {
        return res.status(403).json({
          statusCode: 403,
          message: 'Only the requesting project PM can submit receipt',
        });
      }

      const fromStatus = transfer.status;
      let result;
      try {
        result = await receiveBranchTransfer(transfer, req.user._id, {
          challanNo: req.body.challanNo,
          note: req.body.note,
          deliveryDate: req.body.deliveryDate,
          items: req.body.items,
        });
      } catch (execErr) {
        if (execErr.statusCode) {
          return res.status(execErr.statusCode).json({
            statusCode: execErr.statusCode,
            message: execErr.message,
          });
        }
        throw execErr;
      }

      await statusHistoryService.record(
        'BranchTransfer',
        transfer._id,
        fromStatus,
        result.transfer.status,
        req.user._id,
        `Receipt posted — GRN ${result.grn.grnNumber}${
          result.transfer.status === 'PARTIALLY_RECEIVED' ? ' (partial)' : ' (complete)'
        }`
      );

      const fromProjectId = transfer.fromProjectId?._id || transfer.fromProjectId;
      const toProjectId = transfer.toProjectId?._id || transfer.toProjectId;
      const toSiteId = transfer.toSiteId?._id || transfer.toSiteId;
      const sourcePms = await getProjectManagers(fromProjectId);
      for (const pm of sourcePms) {
        await notificationService.notifyUser(pm._id, {
          title: 'Branch transfer receipt recorded',
          body: `${transfer.transferNumber}: GRN ${result.grn.grnNumber} created at destination.`,
          relatedEntityType: 'BranchTransfer',
          relatedEntityId: transfer._id,
        });
      }

      // Destination Store Incharge gets the GRN for this transfer (order name = BT number).
      const storeFilter = {
        role: UserRole.STORE_INCHARGE,
        $or: [{ assignedProjectIds: toProjectId }],
      };
      if (toSiteId) storeFilter.$or.push({ assignedSiteId: toSiteId });
      const storeUsers = await User.find(storeFilter).select('_id');
      const fromCode =
        transfer.fromProjectId?.code || transfer.fromProjectId?.toString?.() || 'source';
      for (const store of storeUsers) {
        await notificationService.notifyUser(store._id, {
          title: `GRN ${result.grn.grnNumber} — ${transfer.transferNumber}`,
          body: `Branch transfer receipt posted by PM. Order: ${transfer.transferNumber} (from ${fromCode}). Open Material receipt (GRN).`,
          relatedEntityType: 'GoodsReceiptNote',
          relatedEntityId: result.grn._id,
        });
      }

      const payload = await btResponse(transfer._id, req.user);
      res.json({
        ...payload.body,
        grn: {
          id: result.grn._id.toString(),
          grnNumber: result.grn.grnNumber,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/executive-reject',
  requireCapability('CREATE_PO'),
  [param('id').isMongoId(), body('note').trim().notEmpty()],
  validate,
  loadTransfer,
  async (req, res, next) => {
    try {
      const transfer = req.branchTransfer;
      if (transfer.status !== 'REQUESTED') {
        return res.status(400).json({ statusCode: 400, message: 'Transfer not awaiting Executive review' });
      }

      const fromStatus = transfer.status;
      transfer.status = 'REJECTED';
      transfer.rejectedByUserId = req.user._id;
      transfer.rejectionNote = req.body.note.trim();
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
        body: `${transfer.transferNumber} was rejected by Executive.`,
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
  '/:id/coordinator-reject',
  requireCapability('VERIFY_RECORDS'),
  [param('id').isMongoId(), body('note').optional().trim()],
  validate,
  loadTransfer,
  async (req, res, next) => {
    try {
      const transfer = req.branchTransfer;
      if (!['REQUESTED', 'PM_APPROVED'].includes(transfer.status)) {
        return res.status(400).json({ statusCode: 400, message: 'Transfer not awaiting Head Office review' });
      }

      const fromStatus = transfer.status;
      transfer.status = 'REJECTED';
      transfer.rejectedByUserId = req.user._id;
      transfer.rejectionNote = req.body.note?.trim() || 'Rejected by Head Office';
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
        body: `${transfer.transferNumber} was rejected by Head Office.`,
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
      if (!['PM_APPROVED'].includes(transfer.status)) {
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
        return { statusCode: 400, body: { statusCode: 400, message: 'Transfer not awaiting Head Office review' } };
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
