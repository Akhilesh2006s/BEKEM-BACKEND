const { ProjectGrnCounter } = require('../models');

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
 * Atomically allocate the next project-scoped GRN number (never resets).
 */
async function allocateProjectGrnNumber(projectId) {
  const counter = await ProjectGrnCounter.findOneAndUpdate(
    { projectId },
    { $inc: { lastGrnNumber: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return formatGrnNumber(counter.lastGrnNumber);
}

async function peekNextProjectGrnNumber(projectId) {
  const counter = await ProjectGrnCounter.findOne({ projectId }).lean();
  const next = (counter?.lastGrnNumber || 0) + 1;
  return { nextNumber: next, grnNumber: formatGrnNumber(next) };
}

async function syncProjectGrnCounterFromExisting(projectId) {
  const { GoodsReceiptNote, PurchaseOrder, PurchaseRequest } = require('../models');

  const prIds = await PurchaseRequest.find({ projectId }).select('_id').lean();
  const poIds = await PurchaseOrder.find({
    purchaseRequestId: { $in: prIds.map((p) => p._id) },
  })
    .select('_id')
    .lean();

  const grns = await GoodsReceiptNote.find({
    purchaseOrderId: { $in: poIds.map((p) => p._id) },
  })
    .select('grnNumber')
    .lean();

  let maxSeq = 0;
  for (const g of grns) {
    maxSeq = Math.max(maxSeq, parseGrnSequence(g.grnNumber));
  }

  if (maxSeq === 0) return null;

  const existing = await ProjectGrnCounter.findOne({ projectId }).lean();
  if (!existing || existing.lastGrnNumber < maxSeq) {
    await ProjectGrnCounter.findOneAndUpdate(
      { projectId },
      { $set: { lastGrnNumber: maxSeq } },
      { upsert: true }
    );
  }
  return maxSeq;
}

module.exports = {
  formatGrnNumber,
  parseGrnSequence,
  allocateProjectGrnNumber,
  peekNextProjectGrnNumber,
  syncProjectGrnCounterFromExisting,
  GRN_NUMBER_PREFIX,
};
