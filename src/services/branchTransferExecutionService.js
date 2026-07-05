const mongoose = require('mongoose');
const { BranchTransfer, StockLedger, StockMovement, Site } = require('../models');

async function resolveDefaultSiteForProject(projectId, session) {
  const site = await Site.findOne({ projectId }).sort({ createdAt: 1 }).session(session || null);
  return site?._id || null;
}

async function applyStockMovements(transfer, actorUserId, session) {
  let fromSiteId = transfer.fromSiteId;
  let toSiteId = transfer.toSiteId;

  if (!fromSiteId) {
    fromSiteId = await resolveDefaultSiteForProject(transfer.fromProjectId, session);
    if (fromSiteId) transfer.fromSiteId = fromSiteId;
  }
  if (!toSiteId) {
    toSiteId = await resolveDefaultSiteForProject(transfer.toProjectId, session);
    if (toSiteId) transfer.toSiteId = toSiteId;
  }

  if (!fromSiteId || !toSiteId) {
    const err = new Error('Source and destination store sites are required for transfer');
    err.statusCode = 400;
    throw err;
  }

  for (const item of transfer.items) {
    const sourceLedger = await StockLedger.findOne({
      siteId: fromSiteId,
      materialId: item.materialId,
    }).session(session || null);

    if (!sourceLedger || sourceLedger.quantityOnHand < item.quantity) {
      const err = new Error('Insufficient stock at source project');
      err.statusCode = 400;
      throw err;
    }

    sourceLedger.quantityOnHand -= item.quantity;
    sourceLedger.lastMovementAt = new Date();
    await sourceLedger.save(session ? { session } : undefined);

    let destLedger = await StockLedger.findOne({
      siteId: toSiteId,
      materialId: item.materialId,
    }).session(session || null);

    if (!destLedger) {
      const created = await StockLedger.create(
        [
          {
            siteId: toSiteId,
            materialId: item.materialId,
            quantityOnHand: 0,
            lowStockThreshold: 10,
          },
        ],
        session ? { session } : undefined
      );
      destLedger = created[0];
    }

    destLedger.quantityOnHand += item.quantity;
    destLedger.lastMovementAt = new Date();
    await destLedger.save(session ? { session } : undefined);

    item.quantityReceived = item.quantity;

    await StockMovement.create(
      [
        {
          siteId: fromSiteId,
          materialId: item.materialId,
          quantityDelta: -item.quantity,
          type: 'ADJUSTMENT',
          actorUserId,
        },
        {
          siteId: toSiteId,
          materialId: item.materialId,
          quantityDelta: item.quantity,
          type: 'INCOMING',
          actorUserId,
        },
      ],
      session ? { session } : undefined
    );
  }

  transfer.status = 'TRANSFERRED';
  transfer.transferredAt = new Date();
  transfer.executedByUserId = actorUserId;
  await transfer.save(session ? { session } : undefined);
  return transfer;
}

async function executeBranchTransfer(transfer, actorUserId) {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const result = await applyStockMovements(transfer, actorUserId, session);
    await session.commitTransaction();
    return result;
  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    if (err.code === 20 || err.codeName === 'IllegalOperation') {
      return applyStockMovements(transfer, actorUserId, null);
    }
    throw err;
  } finally {
    session.endSession();
  }
}

module.exports = { executeBranchTransfer, resolveDefaultSiteForProject };
