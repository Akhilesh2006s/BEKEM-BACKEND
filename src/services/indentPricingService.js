const { Material } = require('../models');
const { getIndentLineItems } = require('./materialRequestHelpers');
const { resolveUnitPricesForMaterials } = require('./materialPricingService');

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function resolveMaterialId(item) {
  const mat = item.materialId;
  if (!mat) return null;
  return (mat._id || mat).toString();
}

/**
 * Server-side indent line pricing and total estimated value.
 * Line total = requested qty × unit price.
 * Price = approved PO rate → Material Master reference → inventory unitRate.
 */
async function computeIndentPricing(mr) {
  const lineItems = getIndentLineItems(mr);
  if (!lineItems.length) {
    const qty = mr.quantityRequested || 1;
    return { byItemId: new Map(), totalEstimatedValue: 0, lineCount: 0, fallbackQty: qty };
  }

  const materialIds = [...new Set(lineItems.map(resolveMaterialId).filter(Boolean))];
  const materials = await Material.find({ _id: { $in: materialIds } })
    .select('referenceUnitPrice code name')
    .lean();
  const rateByMaterial = await resolveUnitPricesForMaterials(
    materials.map((m) => ({
      id: m._id.toString(),
      code: m.code,
      name: m.name,
      referenceUnitPrice: m.referenceUnitPrice,
    }))
  );

  const byItemId = new Map();
  let totalEstimatedValue = 0;

  for (const item of lineItems) {
    const materialId = resolveMaterialId(item);
    const unitPrice =
      materialId && rateByMaterial.has(materialId) ? Number(rateByMaterial.get(materialId)) || 0 : 0;
    const requestedQty = Math.max(0, Number(item.quantityRequested) || 0);
    const lineTotal = round2(requestedQty * unitPrice);
    totalEstimatedValue += lineTotal;
    byItemId.set(item._id.toString(), {
      unitPrice: round2(unitPrice),
      lineTotal,
    });
  }

  return {
    byItemId,
    totalEstimatedValue: round2(totalEstimatedValue),
    lineCount: lineItems.length,
  };
}

async function computeIndentEstimatedValue(mr) {
  const { totalEstimatedValue } = await computeIndentPricing(mr);
  return totalEstimatedValue;
}

/**
 * Pricing total for unsaved indent line items (create validation).
 * @param {Array<{ materialId: unknown, quantityRequested: number }>} items
 */
async function computeDraftIndentTotal(items) {
  if (!items?.length) return 0;

  const materialIds = [
    ...new Set(
      items.map((i) => (i.materialId?._id || i.materialId)?.toString()).filter(Boolean)
    ),
  ];
  const materials = await Material.find({ _id: { $in: materialIds } })
    .select('referenceUnitPrice code name')
    .lean();
  const rateByMaterial = await resolveUnitPricesForMaterials(
    materials.map((m) => ({
      id: m._id.toString(),
      code: m.code,
      name: m.name,
      referenceUnitPrice: m.referenceUnitPrice,
    }))
  );

  let totalEstimatedValue = 0;
  for (const item of items) {
    const materialId = (item.materialId?._id || item.materialId)?.toString();
    const unitPrice =
      materialId && rateByMaterial.has(materialId) ? Number(rateByMaterial.get(materialId)) || 0 : 0;
    const requestedQty = Math.max(0, Number(item.quantityRequested) || 0);
    totalEstimatedValue += round2(requestedQty * unitPrice);
  }

  return round2(totalEstimatedValue);
}

module.exports = {
  computeIndentPricing,
  computeIndentEstimatedValue,
  computeDraftIndentTotal,
  round2,
};
