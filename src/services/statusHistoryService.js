const { StatusHistory } = require('../models');

async function record(entityType, entityId, fromStatus, toStatus, actorUserId, note = '', options = {}) {
  const data = {
    entityType,
    entityId,
    fromStatus,
    toStatus,
    actorUserId,
    ...(options.approvalPrincipalUserId ? { approvalPrincipalUserId: options.approvalPrincipalUserId } : {}),
    note,
    timestamp: new Date(),
  };
  if (options.session) return (await StatusHistory.create([data], { session: options.session }))[0];
  return StatusHistory.create(data);
}

async function getTimeline(entityType, entityId) {
  return StatusHistory.find({ entityType, entityId })
    .sort({ timestamp: 1 })
    .populate('actorUserId', 'name role');
}

module.exports = { record, getTimeline };
