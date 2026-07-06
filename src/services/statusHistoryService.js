const { StatusHistory } = require('../models');

async function record(entityType, entityId, fromStatus, toStatus, actorUserId, note = '') {
  return StatusHistory.create({
    entityType,
    entityId,
    fromStatus,
    toStatus,
    actorUserId,
    note,
    timestamp: new Date(),
  });
}

async function getTimeline(entityType, entityId) {
  return StatusHistory.find({ entityType, entityId })
    .sort({ timestamp: 1 })
    .populate('actorUserId', 'name role');
}

module.exports = { record, getTimeline };
