const { StockLedger, StockMovement, Material } = require('../models');
const { getIndentLineItems } = require('./materialRequestHelpers');
const { enrichIndentWithStock } = require('./indentStockService');

async function allocateIndentStock(mr, actorUserId, options = {}) {
  const { session } = options;
  const stockContext = session ? null : await enrichIndentWithStock(mr);
  if (stockContext && !stockContext.canFullyIssue) {
    const err = new Error('Insufficient stock to allocate this indent');
    err.statusCode = 400;
    throw err;
  }

  const lineItems = getIndentLineItems(mr);
  for (const item of lineItems) {
    const qty = item.quantityRequested;
    item.quantityAllocated = qty;

    const materialId = item.materialId._id || item.materialId;
    const ledger = await StockLedger.findOne({ siteId: mr.siteId, materialId }).session(session || null);
    if (!ledger || ledger.quantityOnHand - (ledger.quantityReserved || 0) < qty) {
      const mat = await Material.findById(materialId);
      const err = new Error(`Insufficient stock for ${mat?.name || 'material'}`);
      err.statusCode = 400;
      throw err;
    }

    ledger.quantityOnHand -= qty;
    ledger.lastMovementAt = new Date();
    await ledger.save(session ? { session } : {});
    const movement = {
      siteId: mr.siteId,
      materialId,
      materialRequestId: mr._id,
      quantityDelta: -qty,
      type: 'ALLOCATION',
      actorUserId,
    };
    if (session) await StockMovement.create([movement], { session });
    else await StockMovement.create(movement);
  }

  if (typeof mr.markModified === 'function') {
    mr.markModified('items');
  }
  if (lineItems[0] && mr.materialId) {
    mr.quantityAllocated = lineItems[0].quantityAllocated;
  }
  await mr.save(session ? { session } : {});
  return mr;
}

module.exports = {
  allocateIndentStock,
};
