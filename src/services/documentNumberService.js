async function nextSequence(Model, field, prefix) {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const last = await Model.findOne({ [field]: { $regex: `^${escaped}` } })
    .sort({ [field]: -1 })
    .select(field);
  let seq = 1;
  if (last) {
    const parts = last[field].split('/');
    seq = parseInt(parts[parts.length - 1], 10) + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

async function generatePrNumber(projectCode) {
  const now = new Date();
  const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fyEnd = fyStart + 1;
  const fy = `${String(fyStart).slice(-2)}-${String(fyEnd).slice(-2)}`;
  const prefix = `PR/${projectCode}/FY${fy}/`;
  const { PurchaseRequest } = require('../models');
  return nextSequence(PurchaseRequest, 'prNumber', prefix);
}

async function generateRfqNumber(projectCode) {
  const prefix = `RFQ/${projectCode}/`;
  const { RFQ } = require('../models');
  return nextSequence(RFQ, 'rfqNumber', prefix);
}

async function generateDraftPoRef(projectCode) {
  const { getFinancialYear, buildDraftProcurementRef } = require('./procurementReferenceService');
  const { PurchaseOrder } = require('../models');
  const fy = getFinancialYear();
  const proj = String(projectCode || 'PRJ')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 5) || 'PRJ';
  const prefix = `BEKEM-DRAFT/${proj}/`;
  const last = await PurchaseOrder.findOne({ draftRef: { $regex: `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` } })
    .sort({ draftRef: -1 })
    .select('draftRef');
  let seq = 1;
  if (last?.draftRef) {
    const parts = last.draftRef.split('/');
    const n = parseInt(parts[2], 10);
    if (Number.isFinite(n)) seq = n + 1;
  }
  return buildDraftProcurementRef({ projectCode: proj, draftSeq: seq, financialYear: fy });
}

async function generatePoNumber(projectCode) {
  const now = new Date();
  const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fy = `${String(fyStart).slice(-2)}-${String(fyStart + 1).slice(-2)}`;
  const prefix = `PO/${projectCode}/FY${fy}/`;
  const { PurchaseOrder } = require('../models');
  return nextSequence(PurchaseOrder, 'poNumber', prefix);
}

async function generateWoNumber(projectCode) {
  const prefix = `WO/${projectCode}/`;
  const { WorkOrder } = require('../models');
  return nextSequence(WorkOrder, 'woNumber', prefix);
}

async function generateGrnNumber() {
  const prefix = `GRN/${new Date().getFullYear()}/`;
  const { GoodsReceiptNote } = require('../models');
  return nextSequence(GoodsReceiptNote, 'grnNumber', prefix);
}

async function generateIssueNumber() {
  const prefix = `ISS/${new Date().getFullYear()}/`;
  const { MaterialIssue } = require('../models');
  return nextSequence(MaterialIssue, 'issueNumber', prefix);
}

async function generateTransferNumber() {
  const prefix = `BT/${new Date().getFullYear()}/`;
  const { BranchTransfer } = require('../models');
  return nextSequence(BranchTransfer, 'transferNumber', prefix);
}

module.exports = {
  generatePrNumber,
  generateRfqNumber,
  generatePoNumber,
  generateWoNumber,
  generateGrnNumber,
  generateIssueNumber,
  generateTransferNumber,
  generateDraftPoRef,
};
