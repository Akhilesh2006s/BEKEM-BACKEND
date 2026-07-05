const { StockLedger, MaterialIssue } = require('../models');
const { getIndentLineItems } = require('./materialRequestHelpers');

async function getLedgerMap(siteId) {
  const ledgers = await StockLedger.find({ siteId }).lean();
  const map = new Map();
  for (const l of ledgers) {
    map.set(l.materialId.toString(), l);
  }
  return map;
}

async function getExistingSiteStockMap(siteId, excludeRequestId) {
  const issues = await MaterialIssue.find({ siteId }).select('items materialRequestId').lean();
  const map = new Map();
  for (const issue of issues) {
    if (excludeRequestId && issue.materialRequestId?.toString() === excludeRequestId.toString()) {
      continue;
    }
    for (const item of issue.items || []) {
      const mid = item.materialId.toString();
      map.set(mid, (map.get(mid) || 0) + (item.quantity || 0));
    }
  }
  return map;
}

function computeLineStockFields(item, ledger, existingStock) {
  const requestedQty = item.quantityRequested || 0;
  const onHand = ledger?.quantityOnHand || 0;
  const reserved = ledger?.quantityReserved || 0;
  const availableQty = Math.max(0, onHand - reserved);
  const existing = existingStock || 0;
  const requiredQty = Math.max(0, requestedQty - availableQty - existing);
  return { requestedQty, availableQty, existingStock: existing, requiredQty };
}

async function enrichIndentWithStock(mr) {
  const siteId = mr.siteId?._id || mr.siteId;
  const lineItems = getIndentLineItems(mr);
  const [ledgerMap, existingMap] = await Promise.all([
    getLedgerMap(siteId),
    getExistingSiteStockMap(siteId, mr._id),
  ]);

  const stockByLine = lineItems.map((item) => {
    const materialId = (item.materialId?._id || item.materialId).toString();
    const ledger = ledgerMap.get(materialId);
    const existing = existingMap.get(materialId) || 0;
    return {
      itemId: item._id.toString(),
      materialId,
      ...computeLineStockFields(item, ledger, existing),
    };
  });

  const canFullyIssue = stockByLine.every((s) => s.availableQty >= s.requestedQty);
  const hasShortfall = stockByLine.some((s) => s.requiredQty > 0);

  return { stockByLine, canFullyIssue, hasShortfall };
}

module.exports = {
  getLedgerMap,
  getExistingSiteStockMap,
  computeLineStockFields,
  enrichIndentWithStock,
};
