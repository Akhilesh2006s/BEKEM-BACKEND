/**
 * Future-ready GST portal integration.
 * When VENDOR_GST_LOOKUP_ENABLED=true and a provider is configured,
 * lookupVendorByGstNumber will call the external API.
 *
 * Expected future response shape:
 * { legalName, tradeName, status, address, gstNumber }
 */

function isGstLookupEnabled() {
  return process.env.VENDOR_GST_LOOKUP_ENABLED === 'true';
}

function normalizeGstNumber(gstNumber) {
  return String(gstNumber || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

function isValidGstNumberFormat(gstNumber) {
  const n = normalizeGstNumber(gstNumber);
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(n);
}

/**
 * @param {string} gstNumber
 * @returns {Promise<null | { name: string, address: string, gstDetails: object }>}
 */
async function lookupVendorByGstNumber(gstNumber) {
  const normalized = normalizeGstNumber(gstNumber);
  if (!normalized) {
    const err = new Error('GST number is required');
    err.statusCode = 400;
    throw err;
  }
  if (!isValidGstNumberFormat(normalized)) {
    const err = new Error('Invalid GST number format');
    err.statusCode = 400;
    throw err;
  }

  if (!isGstLookupEnabled()) {
    return null;
  }

  // Provider hook — implement when GST portal API credentials are available.
  // const provider = require('./vendorGstLookupProvider');
  // return provider.fetch(normalized);

  return null;
}

module.exports = {
  isGstLookupEnabled,
  normalizeGstNumber,
  isValidGstNumberFormat,
  lookupVendorByGstNumber,
};
