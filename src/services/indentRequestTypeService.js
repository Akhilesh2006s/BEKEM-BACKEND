const { Material } = require('../models');
const { INDENT_VALUE_CAP_INR } = require('@afios/shared');
const { computeDraftIndentTotal } = require('./indentPricingService');
const { resolveUnitPricesForMaterials } = require('./materialPricingService');

const VALID_TYPES = ['BELOW_5000', 'ABOVE_5000'];

function assertIndentRequestType(indentRequestType) {
  if (!VALID_TYPES.includes(indentRequestType)) {
    const err = new Error('indentRequestType must be BELOW_5000 or ABOVE_5000');
    err.statusCode = 400;
    throw err;
  }
}

/**
 * Enforce below-₹5,000 rules on create (server-side):
 * - every line must have a resolvable unit price
 * - no single material unit price may be ≥ ₹5,000
 * - indent running total must stay under ₹5,000
 * @param {string} indentRequestType
 * @param {Array<{ materialId: unknown, quantityRequested: number }>} resolvedItems
 */
async function validateIndentRequestTypeForCreate(indentRequestType, resolvedItems) {
  assertIndentRequestType(indentRequestType);
  if (indentRequestType !== 'BELOW_5000') return;

  const materialIds = [
    ...new Set(
      (resolvedItems || [])
        .map((i) => (i.materialId?._id || i.materialId)?.toString())
        .filter(Boolean)
    ),
  ];
  if (materialIds.length) {
    const materials = await Material.find({ _id: { $in: materialIds } })
      .select('referenceUnitPrice code name')
      .lean();
    const rates = await resolveUnitPricesForMaterials(
      materials.map((m) => ({
        id: m._id.toString(),
        code: m.code,
        name: m.name,
        referenceUnitPrice: m.referenceUnitPrice,
      }))
    );

    const missing = [];
    const overCap = [];
    for (const m of materials) {
      const rate = Number(rates.get(m._id.toString())) || 0;
      if (!(rate > 0)) missing.push(m);
      else if (rate >= INDENT_VALUE_CAP_INR) overCap.push({ ...m, rate });
    }

    if (missing.length) {
      const names = missing
        .slice(0, 3)
        .map((m) => m.name || m.code)
        .join(', ');
      const err = new Error(
        `Price not available for: ${names}. Ask HQ to set a Material Master reference rate, or use Above ₹5,000.`
      );
      err.statusCode = 400;
      throw err;
    }

    if (overCap.length) {
      const names = overCap
        .slice(0, 3)
        .map((m) => m.name || m.code)
        .join(', ');
      const err = new Error(
        `These materials cost ₹5,000 or more per unit and cannot be added to a Below ₹5,000 indent: ${names}. Use Above ₹5,000.`
      );
      err.statusCode = 400;
      throw err;
    }
  }

  const totalEstimatedValue = await computeDraftIndentTotal(resolvedItems);
  if (totalEstimatedValue >= INDENT_VALUE_CAP_INR) {
    const err = new Error(
      `Below ₹5,000 indents must have a total under ₹${INDENT_VALUE_CAP_INR.toLocaleString('en-IN')}. Create an Above ₹5,000 indent for additional materials.`
    );
    err.statusCode = 400;
    throw err;
  }
}

module.exports = {
  assertIndentRequestType,
  validateIndentRequestTypeForCreate,
};
