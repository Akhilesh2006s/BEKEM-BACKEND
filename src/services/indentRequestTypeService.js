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
 * Enforce below-₹5,000 cap on create (server-side).
 * Requires a resolvable unit price on every line so zero-price items cannot bypass the cap.
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
    const missing = materials.filter((m) => {
      const rate = rates.get(m._id.toString());
      return !(Number(rate) > 0);
    });
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
