const mongoose = require('mongoose');
const { PurchaseOrder } = require('../models');

const APPROVED_PO_STATUSES = ['APPROVED'];

/**
 * Latest approved purchase rate per material from PO line items.
 * @param {string[]} materialIds
 * @returns {Promise<Map<string, number>>}
 */
async function getLatestApprovedRates(materialIds) {
  const ids = [...new Set((materialIds || []).map((id) => id?.toString()).filter(Boolean))];
  const rateByMaterial = new Map();
  if (!ids.length) return rateByMaterial;

  const rows = await PurchaseOrder.aggregate([
    { $match: { status: { $in: APPROVED_PO_STATUSES } } },
    { $sort: { finalApprovedAt: -1, updatedAt: -1 } },
    { $unwind: '$lineItems' },
    {
      $match: {
        'lineItems.materialId': {
          $in: ids
            .filter((id) => mongoose.Types.ObjectId.isValid(id))
            .map((id) => new mongoose.Types.ObjectId(id)),
        },
      },
    },
    {
      $group: {
        _id: '$lineItems.materialId',
        rate: { $first: '$lineItems.rate' },
      },
    },
  ]);

  for (const row of rows) {
    const mid = row._id?.toString();
    if (mid && row.rate != null) rateByMaterial.set(mid, Number(row.rate));
  }

  return rateByMaterial;
}

async function getLatestApprovedRate(materialId) {
  if (!materialId) return null;
  const map = await getLatestApprovedRates([materialId.toString()]);
  return map.get(materialId.toString()) ?? null;
}

function attachUnitPrices(materials, rateByMaterial) {
  return materials.map((m) => {
    const id = m.id || m._id?.toString();
    const unitPrice = id ? rateByMaterial.get(id) ?? null : null;
    return { ...m, unitPrice };
  });
}

/**
 * Min / max approved PO line rate per material.
 * @param {string[]} materialIds
 * @returns {Promise<Map<string, { minRate: number|null, maxRate: number|null }>>}
 */
async function getMaterialPurchaseRateRange(materialIds) {
  const ids = [...new Set((materialIds || []).map((id) => id?.toString()).filter(Boolean))];
  const rangeByMaterial = new Map();
  if (!ids.length) return rangeByMaterial;

  const objectIds = ids
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const rows = await PurchaseOrder.aggregate([
    { $match: { status: { $in: APPROVED_PO_STATUSES } } },
    { $unwind: '$lineItems' },
    { $match: { 'lineItems.materialId': { $in: objectIds } } },
    {
      $group: {
        _id: '$lineItems.materialId',
        minRate: { $min: '$lineItems.rate' },
        maxRate: { $max: '$lineItems.rate' },
      },
    },
  ]);

  for (const row of rows) {
    const mid = row._id?.toString();
    if (mid) {
      rangeByMaterial.set(mid, {
        minRate: row.minRate != null ? Number(row.minRate) : null,
        maxRate: row.maxRate != null ? Number(row.maxRate) : null,
      });
    }
  }
  return rangeByMaterial;
}

/**
 * Purchase history rows for RFQ / PO wizard (min, max, latest approved rates).
 * @param {Array<{ materialId?: unknown, materialId?: { _id?: unknown, name?: string }, quantityRequested?: number }>} lineItems
 */
async function buildPurchaseHistoryRows(lineItems) {
  const rows = [];
  const materialIds = [];
  for (const line of lineItems || []) {
    const mid = (line.materialId?._id || line.materialId)?.toString?.() || line.materialId?.toString?.();
    if (mid) materialIds.push(mid);
  }
  const uniqueIds = [...new Set(materialIds)];
  const rateRange = await getMaterialPurchaseRateRange(uniqueIds);
  const latestRates = await getLatestApprovedRates(uniqueIds);

  for (const line of lineItems || []) {
    const mid = (line.materialId?._id || line.materialId)?.toString?.() || line.materialId?.toString?.();
    const mat = line.materialId && typeof line.materialId === 'object' ? line.materialId : null;
    const range = mid ? rateRange.get(mid) : null;
    rows.push({
      materialId: mid,
      materialName: mat?.name || line.description || 'Material',
      minPurchaseRate: range?.minRate ?? null,
      maxPurchaseRate: range?.maxRate ?? null,
      latestPurchaseRate: mid ? latestRates.get(mid) ?? null : null,
    });
  }
  if (!rows.length) {
    return [{ materialName: 'All materials', minPurchaseRate: null, maxPurchaseRate: null, latestPurchaseRate: null }];
  }
  return rows;
}

module.exports = {
  getLatestApprovedRate,
  getLatestApprovedRates,
  getMaterialPurchaseRateRange,
  attachUnitPrices,
  buildPurchaseHistoryRows,
};
