const { StockLedger, StockMovement, Material } = require('../models');
const { getIndentLineItems } = require('./materialRequestHelpers');
const { enrichIndentWithStock } = require('./indentStockService');

async function allocateIndentStock(mr, actorUserId) {
  const stockContext = await enrichIndentWithStock(mr);
  if (!stockContext.canFullyIssue) {
    const err = new Error('Insufficient stock to allocate this indent');
    err.statusCode = 400;
    throw err;
  }

  const lineItems = getIndentLineItems(mr);
  for (const item of lineItems) {
    const qty = item.quantityRequested;
    item.quantityAllocated = qty;

    const materialId = item.materialId._id || item.materialId;
    const ledger = await StockLedger.findOne({ siteId: mr.siteId, materialId });
    if (!ledger || ledger.quantityOnHand < qty) {
      const mat = await Material.findById(materialId);
      const err = new Error(`Insufficient stock for ${mat?.name || 'material'}`);
      err.statusCode = 400;
      throw err;
    }

    ledger.quantityOnHand -= qty;
    ledger.lastMovementAt = new Date();
    await ledger.save();
    await StockMovement.create({
      siteId: mr.siteId,
      materialId,
      materialRequestId: mr._id,
      quantityDelta: -qty,
      type: 'ALLOCATION',
      actorUserId,
    });
  }

  await mr.save();
  return mr;
}

module.exports = {
  allocateIndentStock,
};
