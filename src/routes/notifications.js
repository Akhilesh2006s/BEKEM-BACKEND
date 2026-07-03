const express = require('express');
const { param } = require('express-validator');
const { Notification } = require('../models');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { serializeNotification } = require('../services/notificationService');

const router = express.Router();

router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const notifications = await Notification.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(100);
    res.json({ data: notifications.map(serializeNotification) });
  } catch (err) {
    next(err);
  }
});

router.patch('/read-all', async (req, res, next) => {
  try {
    await Notification.updateMany({ userId: req.user._id, isRead: false }, { isRead: true });
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/read', param('id').isMongoId(), validate, async (req, res, next) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { isRead: true },
      { new: true }
    );
    if (!notification) {
      return res.status(404).json({ statusCode: 404, message: 'Notification not found' });
    }
    res.json({ data: serializeNotification(notification) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
