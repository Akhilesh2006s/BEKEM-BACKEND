const jwt = require('jsonwebtoken');
const { User } = require('../models');

async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ statusCode: 401, message: 'Missing access token' });
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    const user = await User.findById(payload.sub).select('-passwordHash -refreshToken');
    if (!user) {
      return res.status(401).json({ statusCode: 401, message: 'User not found' });
    }
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ statusCode: 401, message: 'Invalid or expired token' });
  }
}

function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();
  authenticate(req, res, next);
}

module.exports = { authenticate, optionalAuth };
