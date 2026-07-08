const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body } = require('express-validator');
const { APP_LOCALE_CODES } = require('@afios/shared');
const { User } = require('../models');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { serializeUser } = require('../utils/serialize');

const router = express.Router();

function signTokens(user) {
  if (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET) {
    const err = new Error('Server auth is not configured (JWT secrets missing)');
    err.statusCode = 500;
    throw err;
  }
  const payload = { sub: user._id.toString(), role: user.role };
  const accessToken = jwt.sign(payload, process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES || '4h',
  });
  const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES || '7d',
  });
  return { accessToken, refreshToken };
}

router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Valid email required'),
    body('password').notEmpty().withMessage('Password required'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const { email, password } = req.body;
      const user = await User.findOne({ email: email.toLowerCase() });
      if (!user) {
        return res.status(401).json({ statusCode: 401, message: 'Invalid credentials' });
      }
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ statusCode: 401, message: 'Invalid credentials' });
      }

      const tokens = signTokens(user);
      user.refreshToken = tokens.refreshToken;
      await user.save();

      res.json({
        user: serializeUser(user),
        tokens,
      });
    } catch (err) {
      if (err.name === 'MongoServerSelectionError' || err.name === 'MongoNetworkError') {
        return res.status(503).json({
          statusCode: 503,
          message: 'Database is temporarily unavailable. Check MongoDB connection and retry.',
        });
      }
      next(err);
    }
  }
);

router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(401).json({ statusCode: 401, message: 'Refresh token required' });
    }
    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(payload.sub);
    if (!user || user.refreshToken !== refreshToken) {
      return res.status(401).json({ statusCode: 401, message: 'Invalid refresh token' });
    }
    const tokens = signTokens(user);
    user.refreshToken = tokens.refreshToken;
    await user.save();
    res.json({ tokens });
  } catch (err) {
    next(err);
  }
});

router.get('/me', authenticate, async (req, res) => {
  res.json({ user: serializeUser(req.user) });
});

router.patch(
  '/me/preferences',
  authenticate,
  [
    body('locale').optional().isIn(APP_LOCALE_CODES),
    body('notificationPrefs').optional().isObject(),
    body('notificationPrefs.inApp').optional().isBoolean(),
    body('notificationPrefs.emailDigest').optional().isBoolean(),
    body('notificationPrefs.sms').optional().isBoolean(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const user = await User.findById(req.user._id);
      if (!user) return res.status(404).json({ statusCode: 404, message: 'User not found' });

      if (req.body.locale) user.locale = req.body.locale;
      if (req.body.notificationPrefs) {
        user.notificationPrefs = {
          inApp:
            req.body.notificationPrefs.inApp !== undefined
              ? req.body.notificationPrefs.inApp
              : user.notificationPrefs?.inApp !== false,
          emailDigest:
            req.body.notificationPrefs.emailDigest !== undefined
              ? req.body.notificationPrefs.emailDigest
              : !!user.notificationPrefs?.emailDigest,
          sms:
            req.body.notificationPrefs.sms !== undefined
              ? req.body.notificationPrefs.sms
              : !!user.notificationPrefs?.sms,
        };
      }

      await user.save();
      res.json({ user: serializeUser(user) });
    } catch (err) {
      next(err);
    }
  }
);

router.post('/logout', authenticate, async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, { refreshToken: null });
  res.json({ message: 'Logged out' });
});

module.exports = router;
