const express = require('express');
const { body, param } = require('express-validator');
const { UserRole } = require('@afios/shared');
const {
  BranchTransfer,
  StockLedger,
  StockMovement,
  Site,
} = require('../models');
const { authenticate } = require('../middleware/auth');
const { requireCapability } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { generateTransferNumber } = require('../services/documentNumberService');
const notificationService = require('../services/notificationService');
const {
  getProjectManagers,
  userManagesProject,
  serializeTransferRow,
} = require('../services/branchTransferService');

const router = express.Router();
router.use(authenticate);

const transferPopulate =
  'fromProjectId toProjectId fromSiteId toSiteId items.materialId requestedByUserId destinationApprovedByUserId sourceFinalApprovedByUserId';

async function resolveDefaultSiteForProject(projectId) {
  if (!projectId) return null;
  const site = await Site.findOne({ projectId }).sort({ createdAt: 1 });
  return site?._id || null;
}

router.get('/', async (req, res, next) => {
  try {
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
    }
    const transfers = await BranchTransfer.find(filter)
      .sort({ createdAt: -1 })
      .populate(transferPopulate)
      .limit(50);
    res.json({
      data: transfers.map((t) => {
        const row = serializeTransferRow(t);
        const toId = row.toProjectId;
        const fromId = row.fromProjectId;
        row.canDestinationAccept =
          req.user.role === UserRole.PROJECT_MANAGER &&
          t.status === 'PENDING_DESTINATION_PM' &&
          userManagesProject(req.user, toId);
        row.canDestinationReject = row.canDestinationAccept;
        row.canSourceFinalAccept =
          req.user.role === UserRole.PROJECT_MANAGER &&
          t.status === 'PENDING_SOURCE_FINAL' &&
          userManagesProject(req.user, fromId);
        return row;
      }),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', param('id').isMongoId(), validate, async (req, res, next) => {
  try {
    const t = await BranchTransfer.findById(req.params.id).populate(transferPopulate);
    if (!t) return res.status(404).json({ statusCode: 404, message: 'Not found' });
    res.json({ data: serializeTransferRow(t) });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/',
  requireCapability('CREATE_BRANCH_TRANSFER'),
  [
    body('fromProjectId').isMongoId(),
    body('toProjectId').isMongoId(),
    body('items').isArray({ min: 1 }),
    body('items.*.materialId').isMongoId(),
    body('items.*.quantity').isFloat({ min: 0.01 }),
    body('note').optional().trim(),
  ],
  validate,
  async (req, res, next) => {
    try {
      if (req.body.fromProjectId === req.body.toProjectId) {
        return res.status(400).json({ statusCode: 400, message: 'From and to project must differ' });
      }

      if (req.user.role === UserRole.PROJECT_MANAGER) {
        const allowed = (req.user.assignedProjectIds || []).map((id) => id.toString());
        if (!allowed.includes(req.body.fromProjectId)) {
          return res.status(403).json({
            statusCode: 403,
            message: 'From project must be your assigned project',
          });
        }
      }

      const isCoordinator = req.user.role === UserRole.COORDINATOR;
      const transferNumber = await generateTransferNumber();
      const transfer = await BranchTransfer.create({
        transferNumber,
        fromProjectId: req.body.fromProjectId,
        toProjectId: req.body.toProjectId,
        items: req.body.items,
        note: req.body.note || '',
        requestedByUserId: req.user._id,
        status: isCoordinator ? 'APPROVED' : 'PENDING_DESTINATION_PM',
        sourceFinalApprovedByUserId: isCoordinator ? req.user._id : undefined,
        approvedByUserId: isCoordinator ? req.user._id : undefined,
      });

      if (!isCoordinator) {
        const destinationPms = await getProjectManagers(req.body.toProjectId);
        const notifyIds = destinationPms
          .map((u) => u._id)
          .filter((id) => id.toString() !== req.user._id.toString());
        if (notifyIds.length) {
          await notificationService.notifyUsers(notifyIds, {
            title: 'Branch transfer awaiting your approval',
            body: `${transferNumber}: incoming transfer to your project — accept or reject.`,
            relatedEntityType: 'BranchTransfer',
            relatedEntityId: transfer._id,
          });
        }
      }

      res.status(201).json({
        data: {
          id: transfer._id.toString(),
          transferNumber: transfer.transferNumber,
          status: transfer.status,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/destination-accept',
  requireCapability('APPROVE_MATERIAL_REQUEST'),
  [param('id').isMongoId(), body('note').optional().trim()],
  validate,
  async (req, res, next) => {
    try {
      const transfer = await BranchTransfer.findById(req.params.id);
      if (!transfer) return res.status(404).json({ statusCode: 404, message: 'Not found' });
      if (transfer.status !== 'PENDING_DESTINATION_PM') {
        return res.status(400).json({ statusCode: 400, message: 'Not awaiting destination PM approval' });
      }
      if (!userManagesProject(req.user, transfer.toProjectId)) {
        return res.status(403).json({ statusCode: 403, message: 'Only destination project PM can accept' });
      }

      transfer.status = 'PENDING_SOURCE_FINAL';
      transfer.destinationApprovedByUserId = req.user._id;
      await transfer.save();

      await notificationService.notifyUser(transfer.requestedByUserId, {
        title: 'Destination PM accepted transfer',
        body: `${transfer.transferNumber}: destination project accepted — waiting for your final approval.`,
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
  '/:id/destination-reject',
  requireCapability('APPROVE_MATERIAL_REQUEST'),
  [param('id').isMongoId(), body('note').optional().trim()],
  validate,
  async (req, res, next) => {
    try {
      const transfer = await BranchTransfer.findById(req.params.id);
      if (!transfer) return res.status(404).json({ statusCode: 404, message: 'Not found' });
      if (transfer.status !== 'PENDING_DESTINATION_PM') {
        return res.status(400).json({ statusCode: 400, message: 'Not awaiting destination PM approval' });
      }
      if (!userManagesProject(req.user, transfer.toProjectId)) {
        return res.status(403).json({ statusCode: 403, message: 'Only destination project PM can reject' });
      }

      transfer.status = 'REJECTED';
      transfer.rejectedByUserId = req.user._id;
      transfer.rejectionNote = req.body.note || 'Rejected by destination project manager';
      await transfer.save();

      await notificationService.notifyUser(transfer.requestedByUserId, {
        title: 'Branch transfer rejected',
        body: `${transfer.transferNumber} was rejected by the destination project manager.`,
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
  '/:id/source-final-accept',
  requireCapability('APPROVE_MATERIAL_REQUEST'),
  [param('id').isMongoId(), body('note').optional().trim()],
  validate,
  async (req, res, next) => {
    try {
      const transfer = await BranchTransfer.findById(req.params.id);
      if (!transfer) return res.status(404).json({ statusCode: 404, message: 'Not found' });
      if (transfer.status !== 'PENDING_SOURCE_FINAL') {
        return res.status(400).json({ statusCode: 400, message: 'Not awaiting source PM final approval' });
      }
      if (!userManagesProject(req.user, transfer.fromProjectId)) {
        return res.status(403).json({ statusCode: 403, message: 'Only source project PM can give final approval' });
      }

      transfer.status = 'APPROVED';
      transfer.sourceFinalApprovedByUserId = req.user._id;
      transfer.approvedByUserId = req.user._id;
      await transfer.save();

      res.json({ data: { id: transfer._id.toString(), status: transfer.status } });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/dispatch',
  requireCapability('CREATE_BRANCH_TRANSFER'),
  param('id').isMongoId(),
  validate,
  async (req, res, next) => {
    try {
      const transfer = await BranchTransfer.findById(req.params.id);
      if (!transfer) return res.status(404).json({ statusCode: 404, message: 'Not found' });
      if (transfer.status !== 'APPROVED') {
        return res.status(400).json({ statusCode: 400, message: 'Transfer must be fully approved first' });
      }

      let siteId = transfer.fromSiteId;
      if (!siteId) {
        siteId = await resolveDefaultSiteForProject(transfer.fromProjectId);
        if (siteId) transfer.fromSiteId = siteId;
      }
      if (!siteId) {
        return res.status(400).json({ statusCode: 400, message: 'No store site found on source project' });
      }

      for (const item of transfer.items) {
        const ledger = await StockLedger.findOne({ siteId, materialId: item.materialId });
        if (!ledger || ledger.quantityOnHand < item.quantity) {
          return res.status(400).json({ statusCode: 400, message: 'Insufficient stock at source' });
        }
        ledger.quantityOnHand -= item.quantity;
        ledger.lastMovementAt = new Date();
        await ledger.save();
        await StockMovement.create({
          siteId,
          materialId: item.materialId,
          quantityDelta: -item.quantity,
          type: 'ADJUSTMENT',
          actorUserId: req.user._id,
        });
      }

      transfer.status = 'DISPATCHED';
      transfer.dispatchedByUserId = req.user._id;
      await transfer.save();
      res.json({ data: { id: transfer._id.toString(), status: transfer.status } });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/receive',
  requireCapability('RECEIVE_MATERIAL'),
  param('id').isMongoId(),
  validate,
  async (req, res, next) => {
    try {
      const transfer = await BranchTransfer.findById(req.params.id);
      if (!transfer) return res.status(404).json({ statusCode: 404, message: 'Not found' });
      if (transfer.status !== 'DISPATCHED') {
        return res.status(400).json({ statusCode: 400, message: 'Transfer must be dispatched first' });
      }

      let siteId = transfer.toSiteId;
      if (!siteId) {
        siteId = await resolveDefaultSiteForProject(transfer.toProjectId);
        if (siteId) transfer.toSiteId = siteId;
      }
      if (!siteId) {
        return res.status(400).json({ statusCode: 400, message: 'No store site found on destination project' });
      }

      for (const item of transfer.items) {
        let ledger = await StockLedger.findOne({ siteId, materialId: item.materialId });
        if (!ledger) {
          ledger = await StockLedger.create({
            siteId,
            materialId: item.materialId,
            quantityOnHand: 0,
            lowStockThreshold: 10,
          });
        }
        ledger.quantityOnHand += item.quantity;
        item.quantityReceived = item.quantity;
        ledger.lastMovementAt = new Date();
        await ledger.save();
        await StockMovement.create({
          siteId,
          materialId: item.materialId,
          quantityDelta: item.quantity,
          type: 'INCOMING',
          actorUserId: req.user._id,
        });
      }

      transfer.status = 'RECEIVED';
      transfer.receivedByUserId = req.user._id;
      await transfer.save();
      res.json({ data: { id: transfer._id.toString(), status: transfer.status } });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
