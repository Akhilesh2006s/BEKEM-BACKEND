const PoStatusTimeline = require('../models/PoStatusTimeline');
const { PO_TRACKING_STAGES } = require('../models/PoStatusTimeline');

const STAGE_LABELS = {
  created: 'Created',
  vendor_assigned: 'Vendor Assigned',
  sent: 'Sent',
  dispatch: 'Dispatch',
  transit: 'Transit',
  received: 'Received',
};

async function recordPoStage(purchaseOrderId, stage, { actorUserId, note, reachedAt } = {}) {
  if (!PO_TRACKING_STAGES.includes(stage)) return null;
  try {
    return await PoStatusTimeline.findOneAndUpdate(
      { purchaseOrderId, stage },
      {
        $setOnInsert: {
          purchaseOrderId,
          stage,
          reachedAt: reachedAt || new Date(),
          note: note || '',
          actorUserId: actorUserId || undefined,
        },
      },
      { upsert: true, new: true }
    );
  } catch (err) {
    if (err.code === 11000) return PoStatusTimeline.findOne({ purchaseOrderId, stage });
    throw err;
  }
}

async function recordPoCreated(purchaseOrderId, actorUserId) {
  await recordPoStage(purchaseOrderId, 'created', { actorUserId });
  await recordPoStage(purchaseOrderId, 'vendor_assigned', { actorUserId });
}

async function recordPoSent(purchaseOrderId, actorUserId) {
  await recordPoStage(purchaseOrderId, 'sent', { actorUserId });
}

async function recordPoDispatch(purchaseOrderId, actorUserId) {
  await recordPoStage(purchaseOrderId, 'dispatch', { actorUserId });
  await recordPoStage(purchaseOrderId, 'transit', { actorUserId });
}

async function recordPoReceived(purchaseOrderId, actorUserId) {
  await recordPoStage(purchaseOrderId, 'received', { actorUserId });
}

async function getPoTimeline(purchaseOrderId) {
  const rows = await PoStatusTimeline.find({ purchaseOrderId }).sort({ reachedAt: 1 }).lean();
  const reached = Object.fromEntries(rows.map((r) => [r.stage, r.reachedAt]));

  let currentStage = 'created';
  for (const stage of PO_TRACKING_STAGES) {
    if (reached[stage]) currentStage = stage;
  }

  return {
    stages: PO_TRACKING_STAGES.map((stage) => ({
      stage,
      label: STAGE_LABELS[stage],
      reachedAt: reached[stage] ? new Date(reached[stage]).toISOString() : null,
      isCurrent: stage === currentStage,
      isComplete: Boolean(reached[stage]),
    })),
    currentStage,
  };
}

async function hasReachedStage(purchaseOrderId, stage) {
  const row = await PoStatusTimeline.findOne({ purchaseOrderId, stage }).lean();
  return Boolean(row);
}

module.exports = {
  recordPoStage,
  recordPoCreated,
  recordPoSent,
  recordPoDispatch,
  recordPoReceived,
  getPoTimeline,
  hasReachedStage,
  STAGE_LABELS,
};
