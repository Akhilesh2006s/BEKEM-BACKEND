const mongoose = require('mongoose');
const {
  BranchTransfer,
  StockLedger,
  StockMovement,
  Site,
  GoodsReceiptNote,
  MaterialRequest,
} = require('../models');
const { generateGrnNumber } = require('./documentNumberService');

async function resolveDefaultSiteForProject(projectId, session) {
  const site = await Site.findOne({ projectId }).sort({ createdAt: 1 }).session(session || null);
  return site?._id || null;
}

function asId(value) {
  if (!value) return value;
  return value._id || value;
}

async function ensureSites(transfer, session) {
  let fromSiteId = asId(transfer.fromSiteId);
  let toSiteId = asId(transfer.toSiteId);

  if (!fromSiteId) {
    fromSiteId = await resolveDefaultSiteForProject(asId(transfer.fromProjectId), session);
    if (fromSiteId) transfer.fromSiteId = fromSiteId;
  }
  if (!toSiteId) {
    toSiteId = await resolveDefaultSiteForProject(asId(transfer.toProjectId), session);
    if (toSiteId) transfer.toSiteId = toSiteId;
  }

  if (!fromSiteId || !toSiteId) {
    const err = new Error('Source and destination store sites are required for transfer');
    err.statusCode = 400;
    throw err;
  }
  return { fromSiteId, toSiteId };
}

/**
 * Source PM dispatch: debit source project stock and mark in-transit (DISPATCHED).
 * Destination stock is NOT credited until receive.
 */
async function dispatchBranchTransfer(transfer, actorUserId, dispatch = {}) {
  const session = await mongoose.startSession();
  const run = async (sess) => {
    const { fromSiteId } = await ensureSites(transfer, sess);
    for (const item of transfer.items) {
      const materialId = asId(item.materialId);
      const qty = Number(item.quantity || 0);
      if (!(qty > 0)) continue;

      const sourceLedger = await StockLedger.findOne({
        siteId: fromSiteId,
        materialId,
      }).session(sess || null);

      if (!sourceLedger || sourceLedger.quantityOnHand < qty) {
        const err = new Error('Insufficient stock at source project');
        err.statusCode = 400;
        throw err;
      }

      sourceLedger.quantityOnHand -= qty;
      sourceLedger.lastMovementAt = new Date();
      await sourceLedger.save(sess ? { session: sess } : undefined);

      await StockMovement.create(
        [
          {
            siteId: fromSiteId,
            materialId,
            quantityDelta: -qty,
            type: 'ADJUSTMENT',
            actorUserId,
          },
        ],
        sess ? { session: sess } : undefined
      );
    }

    transfer.challanNo = String(dispatch.challanNo || '').trim();
    transfer.expectedArrivalDate = dispatch.expectedArrivalDate
      ? new Date(dispatch.expectedArrivalDate)
      : undefined;
    transfer.dispatchNote = String(dispatch.dispatchNote || '').trim();
    transfer.dispatchedByUserId = actorUserId;
    transfer.dispatchedAt = new Date();
    transfer.status = 'DISPATCHED';
    await transfer.save(sess ? { session: sess } : undefined);
    return transfer;
  };

  try {
    session.startTransaction();
    const result = await run(session);
    await session.commitTransaction();
    return result;
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    if (err.code === 20 || err.codeName === 'IllegalOperation') {
      return run(null);
    }
    throw err;
  } finally {
    session.endSession();
  }
}

/**
 * Destination PM receive: credit destination stock + create a GRN for this receipt.
 * Supports partial receives → multiple GRNs until all items are fully received.
 */
async function receiveBranchTransfer(transfer, actorUserId, receipt = {}) {
  const session = await mongoose.startSession();
  const run = async (sess) => {
    const { toSiteId } = await ensureSites(transfer, sess);
    const receiptItems = Array.isArray(receipt.items) ? receipt.items : [];
    if (!receiptItems.length) {
      // Default: receive all remaining qty
      for (const item of transfer.items) {
        const remaining = Math.max(0, Number(item.quantity || 0) - Number(item.quantityReceived || 0));
        if (remaining > 0) {
          receiptItems.push({
            materialId: asId(item.materialId).toString(),
            quantity: remaining,
          });
        }
      }
    }
    if (!receiptItems.length) {
      const err = new Error('Nothing left to receive on this branch transfer');
      err.statusCode = 400;
      throw err;
    }

    const grnLines = [];
    let totalReceived = 0;

    for (const line of receiptItems) {
      const materialId = String(line.materialId || '');
      const qty = Number(line.quantity || 0);
      if (!materialId || !(qty > 0)) continue;

      const item = transfer.items.find(
        (i) => asId(i.materialId).toString() === materialId
      );
      if (!item) {
        const err = new Error('Receipt includes a material not on this transfer');
        err.statusCode = 400;
        throw err;
      }
      const remaining = Math.max(0, Number(item.quantity || 0) - Number(item.quantityReceived || 0));
      if (qty > remaining + 1e-9) {
        const err = new Error(
          `Cannot receive ${qty} — only ${remaining} remaining for this material`
        );
        err.statusCode = 400;
        throw err;
      }

      let destLedger = await StockLedger.findOne({
        siteId: toSiteId,
        materialId,
      }).session(sess || null);

      if (!destLedger) {
        const created = await StockLedger.create(
          [
            {
              siteId: toSiteId,
              materialId,
              quantityOnHand: 0,
              lowStockThreshold: 10,
            },
          ],
          sess ? { session: sess } : undefined
        );
        destLedger = created[0];
      }

      destLedger.quantityOnHand += qty;
      destLedger.lastMovementAt = new Date();
      await destLedger.save(sess ? { session: sess } : undefined);

      item.quantityReceived = Number(item.quantityReceived || 0) + qty;
      totalReceived += qty;

      await StockMovement.create(
        [
          {
            siteId: toSiteId,
            materialId,
            quantityDelta: qty,
            type: 'INCOMING',
            actorUserId,
          },
        ],
        sess ? { session: sess } : undefined
      );

      grnLines.push({
        materialId,
        quantityOrdered: item.quantity,
        quantityReceived: qty,
        lineStatus: qty >= remaining ? 'RECEIVED' : 'PARTIAL',
      });
    }

    if (!grnLines.length) {
      const err = new Error('Enter at least one quantity to receive');
      err.statusCode = 400;
      throw err;
    }

    let indentNumber = '';
    if (transfer.materialRequestId) {
      const mr = await MaterialRequest.findById(asId(transfer.materialRequestId))
        .select('indentNumber')
        .session(sess || null)
        .lean();
      indentNumber = mr?.indentNumber || '';
    }

    const grnNumber = await generateGrnNumber();
    const isPartial = transfer.items.some(
      (i) => Number(i.quantityReceived || 0) < Number(i.quantity || 0)
    );
    const challanNo = String(receipt.challanNo || transfer.challanNo || '').trim();

    const created = await GoodsReceiptNote.create(
      [
        {
          grnNumber,
          purchaseOrderId: null,
          branchTransferId: transfer._id,
          transferNumber: transfer.transferNumber,
          indentNumber,
          siteId: toSiteId,
          items: grnLines,
          receivedQuantity: totalReceived,
          status: 'RECEIVED',
          approvalStage: 'NONE',
          receiveType: isPartial ? 'PARTIAL' : 'FULL',
          isPartialGrn: isPartial,
          challanNo,
          note: String(receipt.note || '').trim(),
          deliveryDate: receipt.deliveryDate ? new Date(receipt.deliveryDate) : new Date(),
          receivedAt: new Date(),
          receivedByUserId: actorUserId,
          approvedAt: new Date(),
          approvedByUserId: actorUserId,
        },
      ],
      sess ? { session: sess } : undefined
    );
    const grn = created[0];

    if (!transfer.receiptGrnIds) transfer.receiptGrnIds = [];
    transfer.receiptGrnIds.push(grn._id);
    transfer.receivedByUserId = actorUserId;

    const fullyReceived = transfer.items.every(
      (i) => Number(i.quantityReceived || 0) >= Number(i.quantity || 0)
    );
    if (fullyReceived) {
      transfer.status = 'TRANSFERRED';
      transfer.transferredAt = new Date();
      transfer.executedByUserId = actorUserId;
    } else {
      transfer.status = 'PARTIALLY_RECEIVED';
    }

    await transfer.save(sess ? { session: sess } : undefined);
    return { transfer, grn };
  };

  try {
    session.startTransaction();
    const result = await run(session);
    await session.commitTransaction();
    return result;
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    if (err.code === 20 || err.codeName === 'IllegalOperation') {
      return run(null);
    }
    throw err;
  } finally {
    session.endSession();
  }
}

/**
 * Legacy full execute (debit source + credit dest in one step). Kept for older
 * COORDINATOR_DECIDED → execute path; new flow uses dispatch + receive.
 */
async function applyStockMovements(transfer, actorUserId, session) {
  await dispatchBranchTransfer(transfer, actorUserId, {
    challanNo: transfer.challanNo || 'LEGACY-EXECUTE',
    dispatchNote: 'Legacy execute — stock moved in one step',
  });
  // reload after dispatch mutated status
  const fresh = await BranchTransfer.findById(transfer._id).session(session || null);
  const { transfer: done } = await receiveBranchTransfer(fresh, actorUserId, {});
  return done;
}

async function executeBranchTransfer(transfer, actorUserId) {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    // Inline one-shot for coordinator legacy path without nested sessions
    const { fromSiteId, toSiteId } = await ensureSites(transfer, session);
    for (const item of transfer.items) {
      const materialId = asId(item.materialId);
      const qty = Number(item.quantity || 0);
      const sourceLedger = await StockLedger.findOne({
        siteId: fromSiteId,
        materialId,
      }).session(session);
      if (!sourceLedger || sourceLedger.quantityOnHand < qty) {
        const err = new Error('Insufficient stock at source project');
        err.statusCode = 400;
        throw err;
      }
      sourceLedger.quantityOnHand -= qty;
      sourceLedger.lastMovementAt = new Date();
      await sourceLedger.save({ session });

      let destLedger = await StockLedger.findOne({
        siteId: toSiteId,
        materialId,
      }).session(session);
      if (!destLedger) {
        const created = await StockLedger.create(
          [{ siteId: toSiteId, materialId, quantityOnHand: 0, lowStockThreshold: 10 }],
          { session }
        );
        destLedger = created[0];
      }
      destLedger.quantityOnHand += qty;
      destLedger.lastMovementAt = new Date();
      await destLedger.save({ session });
      item.quantityReceived = qty;

      await StockMovement.create(
        [
          { siteId: fromSiteId, materialId, quantityDelta: -qty, type: 'ADJUSTMENT', actorUserId },
          { siteId: toSiteId, materialId, quantityDelta: qty, type: 'INCOMING', actorUserId },
        ],
        { session }
      );
    }

    const grnNumber = await generateGrnNumber();
    let indentNumber = '';
    if (transfer.materialRequestId) {
      const mr = await MaterialRequest.findById(asId(transfer.materialRequestId))
        .select('indentNumber')
        .session(session)
        .lean();
      indentNumber = mr?.indentNumber || '';
    }
    const created = await GoodsReceiptNote.create(
      [
        {
          grnNumber,
          branchTransferId: transfer._id,
          transferNumber: transfer.transferNumber,
          indentNumber,
          siteId: toSiteId,
          items: transfer.items.map((item) => ({
            materialId: asId(item.materialId),
            quantityOrdered: item.quantity,
            quantityReceived: item.quantity,
            lineStatus: 'RECEIVED',
          })),
          receivedQuantity: transfer.items.reduce((s, i) => s + Number(i.quantity || 0), 0),
          status: 'RECEIVED',
          receiveType: 'FULL',
          challanNo: transfer.challanNo || '',
          receivedAt: new Date(),
          receivedByUserId: actorUserId,
          approvedAt: new Date(),
          approvedByUserId: actorUserId,
        },
      ],
      { session }
    );
    transfer.receiptGrnIds = [created[0]._id];
    transfer.status = 'TRANSFERRED';
    transfer.transferredAt = new Date();
    transfer.executedByUserId = actorUserId;
    await transfer.save({ session });
    await session.commitTransaction();
    return transfer;
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    if (err.code === 20 || err.codeName === 'IllegalOperation') {
      // fallback without transaction — use dispatch+receive
      await dispatchBranchTransfer(transfer, actorUserId, {
        challanNo: transfer.challanNo || 'LEGACY',
      });
      const fresh = await BranchTransfer.findById(transfer._id);
      const { transfer: done } = await receiveBranchTransfer(fresh, actorUserId, {});
      return done;
    }
    throw err;
  } finally {
    session.endSession();
  }
}

module.exports = {
  executeBranchTransfer,
  dispatchBranchTransfer,
  receiveBranchTransfer,
  resolveDefaultSiteForProject,
};
