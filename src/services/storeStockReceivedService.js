const { UserRole } = require('@afios/shared');
const statusHistoryService = require('./statusHistoryService');
const { getIndentLineItems } = require('./materialRequestHelpers');

const RECEIVABLE_STATUSES = new Set(['CHAIRMAN_APPROVED', 'ALLOCATED']);

function assertStoreCanRecordStockReceived(mr, actor) {
  if (actor.role !== UserRole.STORE_INCHARGE) {
    const err = new Error('Only Store Incharge can record stock received');
    err.statusCode = 403;
    throw err;
  }
  if (mr.status === 'MATERIAL_RECEIVED') {
    return;
  }
  if (!RECEIVABLE_STATUSES.has(mr.status)) {
    const err = new Error(
      'Indent must be approved and yet to be received before a Stock Received entry'
    );
    err.statusCode = 400;
    throw err;
  }
}

function applyReceivedQuantities(mr, items = []) {
  if (!Array.isArray(items) || !items.length) return;
  const qtyByMaterial = new Map();
  for (const item of items) {
    const materialId = String(item.materialId || '');
    const qty = Number(item.quantityReceived);
    if (!materialId || !Number.isFinite(qty) || qty < 0) continue;
    qtyByMaterial.set(materialId, (qtyByMaterial.get(materialId) || 0) + qty);
  }
  if (!qtyByMaterial.size) return;

  for (const line of getIndentLineItems(mr)) {
    const materialId = String(line.materialId?._id || line.materialId || '');
    if (!qtyByMaterial.has(materialId)) continue;
    const qty = qtyByMaterial.get(materialId);
    line.quantityAllocated = Math.max(Number(line.quantityAllocated || 0), qty);
  }
  if (mr.quantityRequested) {
    const first = getIndentLineItems(mr)[0];
    mr.quantityAllocated = first?.quantityAllocated || mr.quantityAllocated || mr.quantityRequested;
  }
}

async function recordStoreStockReceived(mr, actor, { remark, receivedAt, items } = {}) {
  assertStoreCanRecordStockReceived(mr, actor);
  if (mr.status === 'MATERIAL_RECEIVED') {
    return mr;
  }

  const fromStatus = mr.status;
  applyReceivedQuantities(mr, items);
  mr.status = 'MATERIAL_RECEIVED';
  mr.pendingWithRole = UserRole.STORE_INCHARGE;
  mr.storeStockReceivedAt = receivedAt ? new Date(receivedAt) : new Date();
  mr.storeStockReceivedByUserId = actor._id;
  mr.storeStockReceivedRemark = String(remark || '').trim();
  await mr.save();

  await statusHistoryService.record(
    'MaterialRequest',
    mr._id,
    fromStatus,
    'MATERIAL_RECEIVED',
    actor._id,
    mr.storeStockReceivedRemark
      ? `Store stock received: ${mr.storeStockReceivedRemark}`
      : 'Store recorded stock received'
  );

  return mr;
}

module.exports = {
  RECEIVABLE_STATUSES,
  assertStoreCanRecordStockReceived,
  recordStoreStockReceived,
};
