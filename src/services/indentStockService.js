const { computeRequiredQty } = require('@afios/shared');
const { StockLedger, StockMovement } = require('../models');
const { getIndentLineItems } = require('./materialRequestHelpers');

async function getLedgerMap(siteId) {
  const ledgers = await StockLedger.find({ siteId }).lean();
  const map = new Map();
  for (const l of ledgers) {
    map.set(l.materialId.toString(), l);
  }
  return map;
}

function computeLineStockFields(item, ledger, receivedQty = 0, receipts = []) {
  const requestedQty = item.quantityRequested || 0;
  const issuedQty = item.quantityIssued || 0;
  const onHand = ledger?.quantityOnHand || 0;
  const reserved = ledger?.quantityReserved || 0;
  const availableQty = Math.max(0, onHand - reserved);
  const requiredQty = computeRequiredQty(requestedQty, availableQty);
  const quantityReceived = Math.max(0, Number(receivedQty) || 0);
  const remainingRequest = Math.max(0, requestedQty - issuedQty);
  // Ready to issue against this indent: remaining request capped by site stock
  // and/or indent-linked GRN balance (ledger already includes GRN stock).
  const receiptBalance = Math.max(0, quantityReceived - issuedQty);
  const availableToIssueQty = Math.min(
    remainingRequest,
    Math.max(availableQty, receiptBalance)
  );
  // Still need inbound receipt only for shortfall not covered by site stock or prior issues.
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

async function enrichIndentWithStock(mr) {
  const siteId = mr.siteId?._id || mr.siteId;
  const lineItems = getIndentLineItems(mr);
  const [ledgerMap, movements] = await Promise.all([
    getLedgerMap(siteId),
    StockMovement.find({ materialRequestId: mr._id, type: 'INCOMING' }).sort({ timestamp: 1 }).lean(),
  ]);
  const receivedByMaterialId = new Map();
  const receiptsByMaterialId = new Map();
  for (const movement of movements) {
    const materialId = movement.materialId?.toString();
    if (!materialId) continue;
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
        receiptsByMaterialId.get(materialId) || []
      ),
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
