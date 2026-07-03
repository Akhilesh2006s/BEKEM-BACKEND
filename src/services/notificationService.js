const { Notification } = require('../models');

let io = null;

function setSocketIo(socketIo) {
  io = socketIo;
}

async function notifyUser(userId, { title, body, relatedEntityType, relatedEntityId }) {
  const notification = await Notification.create({
    userId,
    title,
    body,
    relatedEntityType,
    relatedEntityId,
  });

  if (io) {
    io.to(`user:${userId}`).emit('notification', serializeNotification(notification));
  }

  return notification;
}

async function notifyUsers(userIds, payload) {
  return Promise.all(userIds.map((id) => notifyUser(id, payload)));
}

function serializeNotification(n) {
  return {
    id: n._id.toString(),
    userId: n.userId.toString(),
    title: n.title,
    body: n.body,
    relatedEntityType: n.relatedEntityType,
    relatedEntityId: n.relatedEntityId.toString(),
    isRead: n.isRead,
    createdAt: n.createdAt.toISOString(),
  };
}

module.exports = { setSocketIo, notifyUser, notifyUsers, serializeNotification };
