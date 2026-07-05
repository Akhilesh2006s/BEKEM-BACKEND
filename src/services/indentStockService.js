const { computeRequiredQty } = require('@afios/shared');
const { StockLedger } = require('../models');
const { getIndentLineItems } = require('./materialRequestHelpers');

async function getLedgerMap(siteId) {
  const ledgers = await StockLedger.find({ siteId }).lean();
  const map = new Map();
  for (const l of ledgers) {
    map.set(l.materialId.toString(), l);
  }
  return map;
}

function computeLineStockFields(item, ledger) {
  const requestedQty = item.quantityRequested || 0;
  const onHand = ledger?.quantityOnHand || 0;
  const reserved = ledger?.quantityReserved || 0;
  const availableQty = Math.max(0, onHand - reserved);
  const requiredQty = computeRequiredQty(requestedQty, availableQty);
  return { requestedQty, availableQty, requiredQty };
}

async function enrichIndentWithStock(mr) {
  const siteId = mr.siteId?._id || mr.siteId;
  const lineItems = getIndentLineItems(mr);
  const ledgerMap = await getLedgerMap(siteId);

  const stockByLine = lineItems.map((item) => {
    const materialId = (item.materialId?._id || item.materialId).toString();
    const ledger = ledgerMap.get(materialId);
    return {
      itemId: item._id.toString(),
      materialId,
      ...computeLineStockFields(item, ledger),
    };
  });

  const canFullyIssue = stockByLine.every((s) => s.availableQty >= s.requestedQty);
  const hasShortfall = stockByLine.some((s) => s.requiredQty > 0);

  return { stockByLine, canFullyIssue, hasShortfall };
}

module.exports = {
  getLedgerMap,
  computeLineStockFields,
  enrichIndentWithStock,
};
