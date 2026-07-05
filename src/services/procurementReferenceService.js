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
 * Official PO format (no spaces):
 * BEKEM-AMR/SRE/0002/26-27
 *
 * BEKEM-(PROJECT)/(VENDOR)/(PO_SEQ)/(FY)
 */
function buildProcurementRef({ projectCode, vendorCode, poSeq, financialYear }) {
  const fy = financialYear || getFinancialYear();
  const proj = normalizeCode(projectCode, 5, 'PRJ');
  const vend = normalizeCode(vendorCode, 6, 'VND');
  const bekemNo = String(poSeq).padStart(4, '0');
  return `BEKEM-${proj}/${vend}/${bekemNo}/${fy}`;
}

/** Draft PO reference — same FY token as final, clear DRAFT prefix. */
function buildDraftProcurementRef({ projectCode, draftSeq, financialYear }) {
  const fy = financialYear || getFinancialYear();
  const proj = normalizeCode(projectCode, 5, 'PRJ');
  const seq = String(draftSeq).padStart(4, '0');
  return `BEKEM-DRAFT/${proj}/${seq}/${fy}`;
}

function parseProcurementRef(ref) {
  if (!ref) return null;
  const cleaned = sanitizeProcurementRef(ref);
  const draft = String(cleaned).match(/^BEKEM-DRAFT\/([^/]+)\/(\d+)\/([^/]+)$/i);
  if (draft) {
    return {
      projectCode: draft[1],
      vendorCode: null,
      poSeq: draft[2],
      vendorPoSeq: null,
      financialYear: draft[3],
      isDraft: true,
    };
  }
  const official = String(cleaned).match(/^BEKEM-([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)$/i);
  if (!official) return null;
  const seqPart = String(official[3]);
  const [bekemPart, vendorPart] = seqPart.split('-');
  return {
    projectCode: official[1],
    vendorCode: official[2],
    poSeq: bekemPart,
    vendorPoSeq: vendorPart || null,
    financialYear: official[4],
    isDraft: false,
  };
}

/** Strip stray whitespace from legacy/imported references. */
function sanitizeProcurementRef(ref) {
  if (!ref) return ref;
  let s = String(ref).trim();
  s = s.replace(/\s*\/\s*/g, '/');
  s = s.replace(/\s*-\s*/g, '-');
  s = s.replace(/^BEKEM\s+-/i, 'BEKEM-');
  return s;
}

function formatDisplayPoNumber(poSeq, vendorPoSeq = 1) {
  if (poSeq == null || poSeq === '') return '—';
  const n = Number(poSeq);
  if (!Number.isFinite(n)) return String(poSeq).padStart(4, '0');
  return String(n).padStart(4, '0');
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
 * Next vendor-specific count (internal analytics only — not part of public ref).
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
  buildDraftProcurementRef,
  parseProcurementRef,
  sanitizeProcurementRef,
  nextPoSequence,
  nextVendorPoSequence,
  assignOfficialProcurementNumbers,
  normalizeCode,
  formatDisplayPoNumber,
  projectShortCode,
  vendorShortCode,
};
