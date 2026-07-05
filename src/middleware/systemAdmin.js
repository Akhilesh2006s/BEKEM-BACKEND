/** Only users flagged as system administrator may manage users. */
function requireSystemAdmin(req, res, next) {
  if (!req.user?.isSystemAdmin) {
    return res.status(403).json({
      statusCode: 403,
      message: 'System administrator access required',
    });
  }
  next();
}

module.exports = { requireSystemAdmin };
