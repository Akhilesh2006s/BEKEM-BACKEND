const { Material } = require('../models');
const { getIndentLineItems } = require('./materialRequestHelpers');
const { getLatestApprovedRates } = require('./materialPricingService');

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function resolveMaterialId(item) {
  const mat = item.materialId;
  if (!mat) return null;
  return (mat._id || mat).toString();
}

/**
 * Resolve unit price: latest approved PO rate, then Material Master referenceUnitPrice.
 */
function resolveUnitPrice(materialId, rateByMaterial, referenceByMaterial) {
  if (!materialId) return 0;
  const id = materialId.toString();
  if (rateByMaterial.has(id)) return rateByMaterial.get(id);
  if (referenceByMaterial.has(id)) return referenceByMaterial.get(id);
  return 0;
}

/**
 * Server-side indent line pricing and total estimated value.
 * Line total uses requested quantity × unit price (per UAT spec).
 */
async function computeIndentPricing(mr) {
  const lineItems = getIndentLineItems(mr);
  if (!lineItems.length) {
    const qty = mr.quantityRequested || 1;
    return { byItemId: new Map(), totalEstimatedValue: 0, lineCount: 0, fallbackQty: qty };
  }

  const materialIds = [...new Set(lineItems.map(resolveMaterialId).filter(Boolean))];
  const [rateByMaterial, materials] = await Promise.all([
    getLatestApprovedRates(materialIds),
    Material.find({ _id: { $in: materialIds } }).select('referenceUnitPrice').lean(),
  ]);

  const referenceByMaterial = new Map(
    materials.map((m) => [m._id.toString(), Number(m.referenceUnitPrice) || 0])
  );

  const byItemId = new Map();
  let totalEstimatedValue = 0;

  for (const item of lineItems) {
    const materialId = resolveMaterialId(item);
    const unitPrice = resolveUnitPrice(materialId, rateByMaterial, referenceByMaterial);
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

module.exports = {
  computeIndentPricing,
  computeIndentEstimatedValue,
  round2,
};
