const { PurchaseOrder } = require('../models');
const { projectShortCode, vendorShortCode } = require('./codeGenerators');

function getFinancialYear(date = new Date()) {
  const month = date.getMonth();
  const startYear = month >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  const endYear = startYear + 1;
  return `${String(startYear).slice(-2)}-${String(endYear).slice(-2)}`;
}

function normalizeCode(value, maxLen = 12, fallback = 'GEN') {
  const raw = String(value || fallback)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return raw.slice(0, maxLen) || fallback;
}

/**
 * Official PO format (no spaces around separators):
 * BEKEM-CHITR/SRE/0004-1/25-26
 *
 * 0004 = Bekem's PO number for the year (4th PO company-wide this FY)
 * 1    = how many times a PO has been sent to this vendor this FY (1st PO to SRE)
 */
function buildProcurementRef({ projectCode, vendorCode, poSeq, vendorPoSeq, financialYear }) {
  const fy = financialYear || getFinancialYear();
  const proj = normalizeCode(projectCode, 5, 'PRJ');
  const vend = normalizeCode(vendorCode, 6, 'VND');
  const bekemNo = String(poSeq).padStart(4, '0');
  const vendorNo = String(vendorPoSeq || 1);
  return `BEKEM-${proj}/${vend}/${bekemNo}-${vendorNo}/${fy}`;
}

function parseProcurementRef(ref) {
  if (!ref) return null;
  const spaced = String(ref).match(
    /^BEKEM\s*-?\s*([^/\s]+)\s*\/\s*([^/\s]+)\s*\/\s*([^/\s]+)\s*\/\s*([^/\s]+)$/i
  );
  if (spaced) {
    const seqPart = spaced[3];
    const [bekemPart, vendorPart] = String(seqPart).split('-');
    return {
      projectCode: spaced[1],
      vendorCode: spaced[2],
      poSeq: bekemPart,
      vendorPoSeq: vendorPart || '1',
      financialYear: spaced[4],
    };
  }
  const legacy = String(ref).match(/^BEKEM-([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)$/i);
  if (!legacy) return null;
  const [bekemPart, vendorPart] = String(legacy[3]).split('-');
  return {
    projectCode: legacy[1],
    vendorCode: legacy[2],
    poSeq: bekemPart,
    vendorPoSeq: vendorPart || '1',
    financialYear: legacy[4],
  };
}

function formatDisplayPoNumber(poSeq, vendorPoSeq = 1) {
  if (poSeq == null || poSeq === '') return '—';
  const n = Number(poSeq);
  if (!Number.isFinite(n)) return String(poSeq);
  return `${String(n).padStart(4, '0')}-${vendorPoSeq || 1}`;
}

/** Next company-wide PO number for Bekem this financial year. */
async function nextPoSequence(financialYear) {
  const fy = financialYear || getFinancialYear();
  const maxLive = await PurchaseOrder.findOne({ financialYear: fy, poSeq: { $exists: true } })
    .sort({ poSeq: -1 })
    .select('poSeq')
    .lean();

  let histMax = 0;
  try {
    const { StockInventoryRecord } = require('../models');
    const maxHist = await StockInventoryRecord.findOne({ financialYear: fy })
      .sort({ poSlNo: -1 })
      .select('poSlNo')
      .lean();
    histMax = maxHist?.poSlNo || 0;
  } catch {
    histMax = 0;
  }

  return Math.max(maxLive?.poSeq || 0, histMax) + 1;
}

/**
 * Next vendor-specific count: how many POs have been sent to this vendor in the FY.
 * 1 = first PO to this vendor this year, 2 = second, etc.
 */
async function nextVendorPoSequence(vendorId, financialYear) {
  const fy = financialYear || getFinancialYear();
  if (!vendorId) return 1;

  const count = await PurchaseOrder.countDocuments({
    financialYear: fy,
    vendorId,
    poSeq: { $exists: true },
  });
  return count + 1;
}

async function assignOfficialProcurementNumbers(po, { projectCode, vendorCode }) {
  const financialYear = getFinancialYear();
  const poSeq = await nextPoSequence(financialYear);
  const vendorPoSeq = await nextVendorPoSequence(po.vendorId, financialYear);
  const procurementRef = buildProcurementRef({
    projectCode: projectCode || 'PRJ',
    vendorCode: vendorCode || 'VND',
    poSeq,
    vendorPoSeq,
    financialYear,
  });
  po.poSeq = poSeq;
  po.vendorPoSeq = vendorPoSeq;
  po.financialYear = financialYear;
  po.procurementRef = procurementRef;
  po.poNumber = procurementRef;
  return po;
}

module.exports = {
  getFinancialYear,
  buildProcurementRef,
  parseProcurementRef,
  nextPoSequence,
  nextVendorPoSequence,
  assignOfficialProcurementNumbers,
  normalizeCode,
  formatDisplayPoNumber,
  projectShortCode,
  vendorShortCode,
};
