const { computeRequiredQty } = require('@afios/shared');
const { StockLedger, StockMovement } = require('../models');
const { getIndentLineItems } = require('./materialRequestHelpers');

async function getLedgerMap(siteId, session = null) {
  const ledgers = await StockLedger.find({ siteId }).session(session).lean();
  const map = new Map();
  for (const l of ledgers) {
    map.set(l.materialId.toString(), l);
  }
  return map;
}

function computeLineStockFields(item, ledger, receivedQty = 0, receipts = [], allocatedDebits = 0) {
  const requestedQty = item.quantityRequested || 0;
  const issuedQty = item.quantityIssued || 0;
  const onHand = ledger?.quantityOnHand || 0;
  const reserved = ledger?.quantityReserved || 0;
  const availableQty = Math.max(0, onHand - reserved);
  const requiredQty = computeRequiredQty(requestedQty, availableQty);
  const quantityReceived = Math.max(0, Number(receivedQty) || 0);
  const remainingRequest = Math.max(0, requestedQty - issuedQty);
  // Stock debited for this indent is reserved for it; a GRN or an allocated
  // quantity alone does not prove that stock is still available.
  const allocatedBalance = Math.max(0, Number(allocatedDebits || 0) - issuedQty);
  const availableToIssueQty = Math.min(
    remainingRequest,
    availableQty + allocatedBalance
  );
  const pendingReceiptQty = Math.max(0, remainingRequest - availableQty);
  return {
    requestedQty,
    availableQty,
    requiredQty,
    quantityReceived,
    availableToIssueQty,
    remainingToIssueQty: remainingRequest,
    pendingReceiptQty,
    receipts,
  };
}

async function enrichIndentWithStock(mr, session = null) {
  const siteId = mr.siteId?._id || mr.siteId;
  const lineItems = getIndentLineItems(mr);
  const ledgerMap = await getLedgerMap(siteId, session);
  const movements = await StockMovement.find({ materialRequestId: mr._id, type: { $in: ['INCOMING', 'ALLOCATION'] } }).session(session).sort({ timestamp: 1 }).lean();
  const receivedByMaterialId = new Map();
  const receiptsByMaterialId = new Map();
  const allocatedByMaterialId = new Map();
  for (const movement of movements) {
    const materialId = movement.materialId?.toString();
    if (!materialId) continue;
    if (movement.type === 'ALLOCATION') {
      allocatedByMaterialId.set(materialId, (allocatedByMaterialId.get(materialId) || 0) + Math.max(0, -Number(movement.quantityDelta || 0)));
      continue;
    }
    receivedByMaterialId.set(
      materialId,
      (receivedByMaterialId.get(materialId) || 0) + Math.max(0, movement.quantityDelta || 0)
    );
    const quantity = Math.max(0, movement.quantityDelta || 0);
    if (quantity > 0) {
      const receipts = receiptsByMaterialId.get(materialId) || [];
      receipts.push({
        quantity,
        receivedAt: movement.timestamp,
      });
      receiptsByMaterialId.set(materialId, receipts);
    }
  }

  const stockByLine = lineItems.map((item) => {
    const materialId = (item.materialId?._id || item.materialId).toString();
    const ledger = ledgerMap.get(materialId);
    return {
      itemId: item._id.toString(),
      materialId,
      ...computeLineStockFields(
        item,
        ledger,
        receivedByMaterialId.get(materialId) || 0,
        receiptsByMaterialId.get(materialId) || [],
        allocatedByMaterialId.get(materialId) || 0
      ),
    };
  });

  const canFullyIssue = stockByLine.every(
    (s) => s.availableToIssueQty >= s.remainingToIssueQty
  );
  const hasShortfall = stockByLine.some((s) => s.requiredQty > 0);

  return { stockByLine, canFullyIssue, hasShortfall };
}

module.exports = {
  getLedgerMap,
  computeLineStockFields,
  enrichIndentWithStock,
};
