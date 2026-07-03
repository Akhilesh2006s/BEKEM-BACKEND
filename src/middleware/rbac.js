const { PERMISSION_MATRIX } = require('@afios/shared');

function hasCapability(role, capability) {
  const caps = PERMISSION_MATRIX[role] || [];
  return caps.includes(capability);
}

function requireCapability(capability) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ statusCode: 401, message: 'Unauthorized' });
    }
    if (!hasCapability(req.user.role, capability)) {
      return res.status(403).json({
        statusCode: 403,
        message: `Forbidden: role ${req.user.role} lacks ${capability}`,
      });
    }
    next();
  };
}

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ statusCode: 401, message: 'Unauthorized' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        statusCode: 403,
        message: `Forbidden: role ${req.user.role} not allowed`,
      });
    }
    next();
  };
}

module.exports = { hasCapability, requireCapability, requireRoles, PERMISSION_MATRIX };
