const { INDENT_VALUE_CAP_INR } = require('@afios/shared');
const { computeDraftIndentTotal } = require('./indentPricingService');

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
 * @param {string} indentRequestType
 * @param {Array<{ materialId: unknown, quantityRequested: number }>} resolvedItems
 */
async function validateIndentRequestTypeForCreate(indentRequestType, resolvedItems) {
  assertIndentRequestType(indentRequestType);
  if (indentRequestType !== 'BELOW_5000') return;

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
