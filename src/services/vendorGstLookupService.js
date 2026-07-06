/**
 * GST portal integration — validates GSTIN and fetches taxpayer details
 * via GSTN-authorised provider (default: sandbox.co.in GSP).
 */

const { fetchGstTaxpayer, getProviderName } = require('./vendorGstLookupProvider');

function hasLookupCredentials() {
  const provider = getProviderName();
  if (provider === 'mock') return true;
  if (provider === 'custom') return !!process.env.GST_LOOKUP_API_URL;
  return !!(process.env.GST_LOOKUP_API_KEY && process.env.GST_LOOKUP_API_SECRET);
}

function isGstLookupEnabled() {
  if (process.env.VENDOR_GST_LOOKUP_ENABLED === 'false') return false;
  if (process.env.VENDOR_GST_LOOKUP_ENABLED === 'true') return true;
  return hasLookupCredentials();
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

function extractPanFromGst(gstNumber) {
  const n = normalizeGstNumber(gstNumber);
  if (n.length !== 15) return '';
  return n.slice(2, 12);
}

/**
 * @param {string} gstNumber
 * @returns {Promise<null | { name: string, address: string, panNumber?: string, gstDetails: object }>}
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

  const result = await fetchGstTaxpayer(normalized);
  return {
    ...result,
    panNumber: extractPanFromGst(normalized),
  };
}

function getLookupStatusMessage() {
  if (!isGstLookupEnabled()) {
    return 'Connect GST portal — set GST_LOOKUP_API_KEY and GST_LOOKUP_API_SECRET (sandbox.co.in or GSP)';
  }
  const provider = getProviderName();
  if (provider === 'mock') return 'GST lookup running in mock mode';
  return `GST auto-fetch enabled via ${provider} provider`;
}

module.exports = {
  isGstLookupEnabled,
  hasLookupCredentials,
  normalizeGstNumber,
  isValidGstNumberFormat,
  extractPanFromGst,
  lookupVendorByGstNumber,
  getLookupStatusMessage,
};
