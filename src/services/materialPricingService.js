const mongoose = require('mongoose');
const { PurchaseOrder, Material, StockInventoryRecord, Quotation } = require('../models');

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
    if (mid && row.rate != null && Number(row.rate) > 0) {
      rateByMaterial.set(mid, Number(row.rate));
    }
  }

  return rateByMaterial;
}

/**
 * Material Master reference rates for items missing approved PO rates.
 * @param {string[]} materialIds
 * @returns {Promise<Map<string, number>>}
 */
async function getReferenceUnitPrices(materialIds) {
  const ids = [...new Set((materialIds || []).map((id) => id?.toString()).filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;

  const objectIds = ids
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const materials = await Material.find({ _id: { $in: objectIds } })
    .select('referenceUnitPrice code name')
    .lean();

  for (const m of materials) {
    const rate = Number(m.referenceUnitPrice);
    if (Number.isFinite(rate) && rate > 0) {
      map.set(m._id.toString(), rate);
    }
  }
  return map;
}

/**
 * Latest positive quotation item rate per material (RFQ responses).
 * @param {string[]} materialIds
 * @returns {Promise<Map<string, number>>}
 */
async function getLatestQuotationRates(materialIds) {
  const ids = [...new Set((materialIds || []).map((id) => id?.toString()).filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;

  const objectIds = ids
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const rows = await Quotation.aggregate([
    { $sort: { submittedAt: -1, updatedAt: -1 } },
    { $unwind: '$itemQuotes' },
    {
      $match: {
        'itemQuotes.materialId': { $in: objectIds },
        'itemQuotes.rate': { $gt: 0 },
      },
    },
    {
      $group: {
        _id: '$itemQuotes.materialId',
        rate: { $first: '$itemQuotes.rate' },
      },
    },
  ]);

  for (const row of rows) {
    const mid = row._id?.toString();
    const rate = Number(row.rate);
    if (mid && rate > 0) map.set(mid, rate);
  }
  return map;
}

/**
 * Latest positive unitRate from Stock Inventory by material code / name.
 * Used when neither PO rate nor Material Master reference exists.
 * @param {Array<{ id?: string, _id?: unknown, code?: string, name?: string }>} materials
 * @returns {Promise<Map<string, number>>}
 */
async function getInventoryUnitRates(materials) {
  const map = new Map();
  const list = (materials || []).filter(Boolean);
  if (!list.length) return map;

  const codes = [
    ...new Set(list.map((m) => String(m.code || m.itemCode || '').trim()).filter(Boolean)),
  ];
  const names = [...new Set(list.map((m) => String(m.name || '').trim()).filter(Boolean))];

  const or = [];
  if (codes.length) or.push({ itemCode: { $in: codes } });
  if (names.length) or.push({ itemDescription: { $in: names } });
  if (!or.length) return map;

  const records = await StockInventoryRecord.find({
    unitRate: { $gt: 0 },
    $or: or,
  })
    .sort({ poDate: -1, updatedAt: -1 })
    .select('itemCode itemDescription unitRate')
    .limit(2000)
    .lean();

  const byCode = new Map();
  const byName = new Map();
  for (const row of records) {
    const rate = Number(row.unitRate);
    if (!(rate > 0)) continue;
    const code = String(row.itemCode || '').trim().toUpperCase();
    const name = String(row.itemDescription || '').trim().toUpperCase();
    if (code && !byCode.has(code)) byCode.set(code, rate);
    if (name && !byName.has(name)) byName.set(name, rate);
  }

  for (const m of list) {
    const id = (m.id || m._id?.toString?.() || m._id)?.toString?.();
    if (!id || map.has(id)) continue;
    const code = String(m.code || m.itemCode || '').trim().toUpperCase();
    const name = String(m.name || '').trim().toUpperCase();
    const rate = (code && byCode.get(code)) || (name && byName.get(name)) || null;
    if (rate > 0) map.set(id, rate);
  }

  return map;
}

/**
 * Resolved display/purchase unit price:
 * 1) latest approved PO rate
 * 2) Material Master referenceUnitPrice
 * 3) latest quotation item rate
 * 4) latest Stock Inventory unitRate
 */
async function resolveUnitPricesForMaterials(materials) {
  const list = (materials || []).map((m) => ({
    ...m,
    id: m.id || m._id?.toString?.() || m._id?.toString?.(),
  }));
  const ids = list.map((m) => m.id).filter(Boolean);

  const [poRates, refRates, quoteRates, inventoryRates] = await Promise.all([
    getLatestApprovedRates(ids),
    getReferenceUnitPrices(ids),
    getLatestQuotationRates(ids),
    getInventoryUnitRates(list),
  ]);

  const resolved = new Map();
  for (const id of ids) {
    const rate =
      (poRates.has(id) && poRates.get(id) > 0 ? poRates.get(id) : null) ??
      (refRates.has(id) && refRates.get(id) > 0 ? refRates.get(id) : null) ??
      (quoteRates.has(id) && quoteRates.get(id) > 0 ? quoteRates.get(id) : null) ??
      (inventoryRates.has(id) && inventoryRates.get(id) > 0 ? inventoryRates.get(id) : null) ??
      null;
    if (rate != null) resolved.set(id, rate);
  }
  return resolved;
}

async function getLatestApprovedRate(materialId) {
  if (!materialId) return null;
  const map = await getLatestApprovedRates([materialId.toString()]);
  return map.get(materialId.toString()) ?? null;
}

function attachUnitPrices(materials, rateByMaterial) {
  return materials.map((m) => {
    const id = m.id || m._id?.toString();
    const fromMap = id && rateByMaterial?.get?.(id);
    const existing = m.unitPrice ?? m.referenceUnitPrice ?? null;
    const unitPrice =
      fromMap != null && Number(fromMap) > 0
        ? Number(fromMap)
        : existing != null && Number(existing) > 0
          ? Number(existing)
          : fromMap ?? existing ?? null;
    return {
      ...m,
      unitPrice,
      referenceUnitPrice: m.referenceUnitPrice ?? (unitPrice != null ? unitPrice : undefined),
    };
  });
}

/**
 * @param {Array<object>} materials serialized or lean material docs
 */
async function attachResolvedUnitPrices(materials) {
  const rateByMaterial = await resolveUnitPricesForMaterials(materials);
  return attachUnitPrices(materials, rateByMaterial);
}

/**
 * Min / max approved PO line rate per material.
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

async function buildPurchaseHistoryRows(lineItems) {
  const rows = [];
  const materialIds = [];
  for (const line of lineItems || []) {
    const mid = (line.materialId?._id || line.materialId)?.toString?.() || line.materialId?.toString?.();
    if (mid) materialIds.push(mid);
  }
  const uniqueIds = [...new Set(materialIds)];
  const rateRange = await getMaterialPurchaseRateRange(uniqueIds);
  const latestRates = await resolveUnitPricesForMaterials(
    uniqueIds.map((id) => ({ id }))
  );

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
  getReferenceUnitPrices,
  getLatestQuotationRates,
  getInventoryUnitRates,
  resolveUnitPricesForMaterials,
  getMaterialPurchaseRateRange,
  attachUnitPrices,
  attachResolvedUnitPrices,
  buildPurchaseHistoryRows,
};
