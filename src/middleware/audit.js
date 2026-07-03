const { AuditLog } = require('../models');

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function auditMiddleware(req, res, next) {
  if (!MUTATING_METHODS.has(req.method)) return next();

  const originalJson = res.json.bind(res);
  res.json = function (body) {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const actorUserId = req.user?._id || null;
      AuditLog.create({
        actorUserId,
        action: `${req.method} ${req.originalUrl}`,
        entityType: req.auditEntityType || 'HTTP',
        entityId: req.auditEntityId || null,
        beforeState: req.auditBeforeState || null,
        afterState: body?.data || body || null,
        ipAddress: req.ip || req.socket?.remoteAddress || '',
      }).catch((err) => console.error('Audit log failed:', err.message));
    }
    return originalJson(body);
  };
  next();
}

module.exports = { auditMiddleware };
