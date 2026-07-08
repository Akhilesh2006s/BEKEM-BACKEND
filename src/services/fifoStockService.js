const { StockBatch, StockLedger, StockMovement } = require('../models');

/**
 * Create FIFO batches from a GRN and sync StockLedger.
 */
async function createBatchesFromGrn(grn, actorUserId, materialRequestId = null) {
  const receivedAt = grn.receivedAt || grn.deliveryDate || new Date();

  for (const item of grn.items || []) {
    const qty = Number(item.quantityReceived) || 0;
    if (qty <= 0) continue;

    await StockBatch.create({
      siteId: grn.siteId,
      materialId: item.materialId,
      grnId: grn._id,
      grnNumber: grn.grnNumber || '',
      receivedAt,
      qtyReceived: qty,
      qtyRemaining: qty,
    });

    let ledger = await StockLedger.findOne({ siteId: grn.siteId, materialId: item.materialId });
    if (!ledger) {
      ledger = await StockLedger.create({
        siteId: grn.siteId,
        materialId: item.materialId,
        quantityOnHand: 0,
        lowStockThreshold: 10,
      });
    }
    ledger.quantityOnHand += qty;
    ledger.lastMovementAt = new Date();
    await ledger.save();

    await StockMovement.create({
      siteId: grn.siteId,
      materialId: item.materialId,
      materialRequestId,
      quantityDelta: qty,
      type: 'INCOMING',
      actorUserId,
    });
  }
}

/**
 * Consume stock FIFO across oldest batches. Updates ledger + movements.
 * @returns {{ consumed: Array<{ batchId, grnNumber, qty }> }}
 */
async function consumeFifo({ siteId, materialId, quantity, actorUserId, materialRequestId }) {
  const qtyNeeded = Number(quantity);
  if (qtyNeeded <= 0) {
    const err = new Error('Issue quantity must be greater than zero');
    err.statusCode = 400;
    throw err;
  }

  const batches = await StockBatch.find({
    siteId,
    materialId,
    qtyRemaining: { $gt: 0 },
  }).sort({ receivedAt: 1, createdAt: 1 });

  const totalAvailable = batches.reduce((s, b) => s + b.qtyRemaining, 0);
  const ledger = await StockLedger.findOne({ siteId, materialId });
  const ledgerAvailable = ledger?.quantityOnHand ?? 0;

  if (totalAvailable < qtyNeeded && ledgerAvailable < qtyNeeded) {
    const err = new Error('Insufficient stock to issue');
    err.statusCode = 400;
    throw err;
  }

  let remaining = qtyNeeded;
  const consumed = [];

  for (const batch of batches) {
    if (remaining <= 0) break;
    const take = Math.min(batch.qtyRemaining, remaining);
    batch.qtyRemaining -= take;
    await batch.save();
    consumed.push({
      batchId: batch._id.toString(),
      grnNumber: batch.grnNumber,
      qty: take,
    });
    remaining -= take;
  }

  // Opening / non-batched stock fallback
  if (remaining > 0 && ledger && ledger.quantityOnHand >= remaining) {
    consumed.push({ batchId: null, grnNumber: 'OPENING', qty: remaining });
    remaining = 0;
  }

  if (remaining > 0) {
    const err = new Error('Insufficient FIFO stock to issue');
    err.statusCode = 400;
    throw err;
  }

  if (ledger) {
    ledger.quantityOnHand -= qtyNeeded;
    ledger.lastMovementAt = new Date();
    await ledger.save();
  }

  await StockMovement.create({
    siteId,
    materialId,
    materialRequestId: materialRequestId || null,
    quantityDelta: -qtyNeeded,
    type: 'ALLOCATION',
    actorUserId,
  });

  return { consumed };
}

/**
 * Aging rows: Item / Batch / GRN / Received Date / Available Qty / Aging Days
 */
async function getStockAging({ siteId } = {}) {
  const filter = { qtyRemaining: { $gt: 0 } };
  if (siteId) filter.siteId = siteId;

  const batches = await StockBatch.find(filter)
    .sort({ receivedAt: 1 })
    .populate('materialId', 'code name unit')
    .limit(500)
    .lean();

  const now = Date.now();
  return batches.map((b) => {
    const receivedAt = b.receivedAt ? new Date(b.receivedAt) : null;
    const agingDays = receivedAt
      ? Math.max(0, Math.floor((now - receivedAt.getTime()) / (24 * 60 * 60 * 1000)))
      : 0;
    return {
      id: b._id.toString(),
      itemCode: b.materialId?.code || '',
      itemDescription: b.materialId?.name || '',
      unit: b.materialId?.unit || '',
      batchId: b._id.toString(),
      grnNumber: b.grnNumber || '—',
      receivedAt: receivedAt?.toISOString?.() || null,
      availableQuantity: b.qtyRemaining,
      agingDays,
    };
  });
}

/**
 * Slim inventory: Item Code, Description, Unit, Total Received, Total Issued, Current Balance
 */
async function getSlimInventory({ siteId } = {}) {
  const mongoose = require('mongoose');
  const match = siteId ? { siteId: new mongoose.Types.ObjectId(String(siteId)) } : {};

  const received = await StockMovement.aggregate([
    { $match: { ...match, quantityDelta: { $gt: 0 } } },
    { $group: { _id: { siteId: '$siteId', materialId: '$materialId' }, totalReceived: { $sum: '$quantityDelta' } } },
  ]);
  const issued = await StockMovement.aggregate([
    { $match: { ...match, quantityDelta: { $lt: 0 } } },
    {
      $group: {
        _id: { siteId: '$siteId', materialId: '$materialId' },
        totalIssued: { $sum: { $abs: '$quantityDelta' } },
      },
    },
  ]);

  const ledgerFilter = siteId ? { siteId } : {};
  const ledgers = await StockLedger.find(ledgerFilter).populate('materialId', 'code name unit').lean();

  const recvMap = new Map(
    received.map((r) => [`${r._id.siteId}:${r._id.materialId}`, r.totalReceived])
  );
  const issMap = new Map(
    issued.map((r) => [`${r._id.siteId}:${r._id.materialId}`, r.totalIssued])
  );

  return ledgers
    .filter((l) => l.materialId)
    .map((l) => {
      const key = `${l.siteId}:${l.materialId._id}`;
      const totalReceived = recvMap.get(key) || 0;
      const totalIssued = issMap.get(key) || 0;
      return {
        id: l._id.toString(),
        itemCode: l.materialId.code || '',
        itemDescription: l.materialId.name || '',
        unit: l.materialId.unit || '',
        totalReceived,
        totalIssued,
        currentBalance: l.quantityOnHand,
      };
    });
}

module.exports = {
  createBatchesFromGrn,
  consumeFifo,
  getStockAging,
  getSlimInventory,
};
