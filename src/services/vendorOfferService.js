const mongoose = require('mongoose');
const { Vendor, Material, Quotation, PurchaseOrder } = require('../models');
const { serializeVendor } = require('../utils/serializeProcurement');

const APPROVED_PO_STATUSES = ['APPROVED'];

function toId(value) {
  return (value?._id || value)?.toString?.() || '';
}

async function vendorsForMaterial(materialId, { strict = false } = {}) {
  const material = await Material.findById(materialId);
  if (!material) {
    return Vendor.find({
      isActive: { $ne: false },
      authorizationStatus: { $in: ['AUTHORIZED', null] },
    })
      .sort({ name: 1 })
      .lean();
  }

  const baseFilter = {
    isActive: { $ne: false },
    authorizationStatus: { $in: ['AUTHORIZED', null] },
  };

  if (strict) {
    return Vendor.find({ ...baseFilter, materialIds: materialId }).sort({ name: 1 }).lean();
  }

  return Vendor.find({
    ...baseFilter,
    $or: [
      { materialIds: materialId },
      { suppliedCategories: material.category },
      { category: material.category },
      { materialIds: { $size: 0 } },
      { materialIds: { $exists: false } },
    ],
  })
    .sort({ name: 1 })
    .lean();
}

/**
 * Latest quoted/purchased unit rate per vendor + material (quotations first, then approved POs).
 */
async function getLastQuotedRatesByVendorMaterial(materialIds) {
  const objectIds = [...new Set((materialIds || []).map((id) => id?.toString()).filter(Boolean))]
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const map = new Map();

  if (!objectIds.length) return map;

  const quoteRows = await Quotation.aggregate([
    { $unwind: '$itemQuotes' },
    {
      $match: {
        'itemQuotes.materialId': { $in: objectIds },
        'itemQuotes.rate': { $gt: 0 },
      },
    },
    { $sort: { submittedAt: -1 } },
    {
      $group: {
        _id: { vendorId: '$vendorId', materialId: '$itemQuotes.materialId' },
        rate: { $first: '$itemQuotes.rate' },
        gstPercent: { $first: '$itemQuotes.gstPercent' },
        quotedAt: { $first: '$submittedAt' },
      },
    },
  ]);

  for (const row of quoteRows) {
    const vendorId = row._id.vendorId?.toString();
    const materialId = row._id.materialId?.toString();
    if (!vendorId || !materialId) continue;
    map.set(`${vendorId}:${materialId}`, {
      rate: Number(row.rate),
      gstPercent: Number(row.gstPercent ?? 18),
      quotedAt: row.quotedAt,
    });
  }

  const poRows = await PurchaseOrder.aggregate([
    { $match: { status: { $in: APPROVED_PO_STATUSES } } },
    { $unwind: '$lineItems' },
    {
      $match: {
        'lineItems.materialId': { $in: objectIds },
        'lineItems.rate': { $gt: 0 },
      },
    },
    { $sort: { finalApprovedAt: -1, updatedAt: -1 } },
    {
      $group: {
        _id: { vendorId: '$vendorId', materialId: '$lineItems.materialId' },
        rate: { $first: '$lineItems.rate' },
        gstPercent: { $first: '$lineItems.gstPercent' },
        quotedAt: { $first: '$finalApprovedAt' },
      },
    },
  ]);

  for (const row of poRows) {
    const vendorId = row._id.vendorId?.toString();
    const materialId = row._id.materialId?.toString();
    if (!vendorId || !materialId) continue;
    const key = `${vendorId}:${materialId}`;
    const next = { rate: Number(row.rate), gstPercent: Number(row.gstPercent ?? 18), quotedAt: row.quotedAt };
    const existing = map.get(key);
    if (!existing) {
      map.set(key, next);
      continue;
    }
    const existingTime = existing.quotedAt ? new Date(existing.quotedAt).getTime() : 0;
    const nextTime = next.quotedAt ? new Date(next.quotedAt).getTime() : 0;
    if (nextTime > existingTime) map.set(key, next);
  }

  return map;
}

function overlayCurrentQuotations(rateMap, currentQuotations = []) {
  for (const q of currentQuotations) {
    const vendorId = toId(q.vendorId);
    const quotedAt = q.submittedAt || q.updatedAt || new Date();
    for (const iq of q.itemQuotes || []) {
      const materialId = toId(iq.materialId);
      const rate = Number(iq.rate || 0);
      if (!vendorId || !materialId || rate <= 0) continue;
      const key = `${vendorId}:${materialId}`;
      const existing = rateMap.get(key);
      const next = { rate, gstPercent: Number(iq.gstPercent ?? 18), quotedAt };
      if (!existing) {
        rateMap.set(key, next);
        continue;
      }
      const existingTime = existing.quotedAt ? new Date(existing.quotedAt).getTime() : 0;
      const nextTime = new Date(quotedAt).getTime();
      if (nextTime >= existingTime) rateMap.set(key, next);
    }
  }
}

async function buildVendorOffersForMaterials(materialIds, { strict = true, currentQuotations = [] } = {}) {
  const uniqueIds = [...new Set((materialIds || []).map((id) => id?.toString()).filter(Boolean))];
  const rateMap = await getLastQuotedRatesByVendorMaterial(uniqueIds);
  overlayCurrentQuotations(rateMap, currentQuotations);

  const rfqAssignments = currentQuotations.filter((q) => (q.selectedMaterialIds || []).length > 0);
  const useRfqAssignments = rfqAssignments.length > 0;

  const rows = [];
  for (const materialId of uniqueIds) {
    const material = await Material.findById(materialId).lean();
    const vendorById = new Map();

    if (useRfqAssignments) {
      for (const q of rfqAssignments) {
        const selected = (q.selectedMaterialIds || []).map((id) => toId(id));
        if (!selected.includes(materialId)) continue;
        const vendorId = toId(q.vendorId);
        if (!vendorId) continue;
        const vendorDoc = q.vendorId;
        if (vendorDoc && typeof vendorDoc === 'object') {
          vendorById.set(vendorId, vendorDoc);
        } else {
          const vendor = await Vendor.findById(vendorId).lean();
          if (vendor) vendorById.set(vendorId, vendor);
        }
      }
    } else {
      const vendors = await vendorsForMaterial(materialId, { strict });
      for (const v of vendors) vendorById.set(v._id.toString(), v);

      for (const q of currentQuotations) {
        const vendorId = toId(q.vendorId);
        if (!vendorId || vendorById.has(vendorId)) continue;
        const vendorDoc = q.vendorId;
        if (vendorDoc && typeof vendorDoc === 'object' && vendorDoc.name) {
          vendorById.set(vendorId, vendorDoc);
        }
      }
    }

    const offers = Array.from(vendorById.entries()).map(([vendorId, vendor]) => {
      const quote = rateMap.get(`${vendorId}:${materialId}`);
      return {
        vendorId,
        vendorName: vendor.name || 'Vendor',
        gstNumber: vendor.gstNumber || '',
        rate: quote?.rate ?? null,
        gstPercent: quote?.gstPercent ?? 18,
        lastQuotedAt: quote?.quotedAt ?? null,
      };
    });

    offers.sort((a, b) => {
      if (a.rate != null && b.rate != null) {
        const aTotal = a.rate * (1 + (a.gstPercent || 18) / 100);
        const bTotal = b.rate * (1 + (b.gstPercent || 18) / 100);
        if (aTotal !== bTotal) return aTotal - bTotal;
        return a.rate - b.rate;
      }
      if (a.rate != null) return -1;
      if (b.rate != null) return 1;
      return a.vendorName.localeCompare(b.vendorName);
    });

    const pricedRates = offers.map((o) => o.rate).filter((r) => r != null);
    rows.push({
      materialId,
      material: material
        ? { id: material._id.toString(), code: material.code, name: material.name, unit: material.unit }
        : null,
      offers,
      minQuotedRate: pricedRates.length ? Math.min(...pricedRates) : null,
      maxQuotedRate: pricedRates.length ? Math.max(...pricedRates) : null,
    });
  }

  return rows;
}

async function vendorsForMaterialsGrouped(materialIds, { strict = false } = {}) {
  const uniqueIds = [...new Set(materialIds.filter(Boolean))];
  const rows = [];
  for (const materialId of uniqueIds) {
    const material = await Material.findById(materialId);
    const vendors = await vendorsForMaterial(materialId, { strict });
    rows.push({
      materialId,
      material: material
        ? { id: material._id.toString(), code: material.code, name: material.name, unit: material.unit }
        : null,
      vendors: vendors.map(serializeVendor),
    });
  }
  return rows;
}

module.exports = {
  vendorsForMaterial,
  vendorsForMaterialsGrouped,
  getLastQuotedRatesByVendorMaterial,
  buildVendorOffersForMaterials,
};
