const { PurchaseOrderGrnCounter } = require('../models');

const GRN_NUMBER_PREFIX = 'GRN-';

function formatGrnNumber(seq) {
  return `${GRN_NUMBER_PREFIX}${String(seq).padStart(3, '0')}`;
}

function parseGrnSequence(grnNumber) {
  if (!grnNumber) return 0;
  const match = String(grnNumber).match(/^GRN-(\d+)$/i);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Atomically allocate the next PO-scoped GRN number (resets per purchase order).
 */
async function allocatePoGrnNumber(purchaseOrderId) {
  const counter = await PurchaseOrderGrnCounter.findOneAndUpdate(
    { purchaseOrderId },
    { $inc: { lastGrnNumber: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return formatGrnNumber(counter.lastGrnNumber);
}

async function peekNextPoGrnNumber(purchaseOrderId) {
  const counter = await PurchaseOrderGrnCounter.findOne({ purchaseOrderId }).lean();
  const next = (counter?.lastGrnNumber || 0) + 1;
  return { nextNumber: next, grnNumber: formatGrnNumber(next) };
}

async function syncPoGrnCounterFromExisting(purchaseOrderId) {
  const { GoodsReceiptNote } = require('../models');

  const grns = await GoodsReceiptNote.find({ purchaseOrderId }).select('grnNumber').lean();

  let maxSeq = 0;
  for (const g of grns) {
    maxSeq = Math.max(maxSeq, parseGrnSequence(g.grnNumber));
  }

  if (maxSeq === 0) return null;

  const existing = await PurchaseOrderGrnCounter.findOne({ purchaseOrderId }).lean();
  if (!existing || existing.lastGrnNumber < maxSeq) {
    await PurchaseOrderGrnCounter.findOneAndUpdate(
      { purchaseOrderId },
      { $set: { lastGrnNumber: maxSeq } },
      { upsert: true }
    );
  }
  return maxSeq;
}

/** @deprecated Use allocatePoGrnNumber */
async function allocateProjectGrnNumber(projectId) {
  void projectId;
  throw new Error('GRN numbers are allocated per purchase order. Use allocatePoGrnNumber.');
}

/** @deprecated Use peekNextPoGrnNumber */
async function peekNextProjectGrnNumber(projectId) {
  void projectId;
  return { nextNumber: 1, grnNumber: formatGrnNumber(1) };
}

/** @deprecated Use syncPoGrnCounterFromExisting */
async function syncProjectGrnCounterFromExisting(projectId) {
  void projectId;
  return null;
}

module.exports = {
  formatGrnNumber,
  parseGrnSequence,
  allocatePoGrnNumber,
  peekNextPoGrnNumber,
  syncPoGrnCounterFromExisting,
  allocateProjectGrnNumber,
  peekNextProjectGrnNumber,
  syncProjectGrnCounterFromExisting,
  GRN_NUMBER_PREFIX,
};
