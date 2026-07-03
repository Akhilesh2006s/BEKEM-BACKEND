const delegationService = require('../services/delegationService');

function requireFinalApproval() {
  return async (req, res, next) => {
    try {
      const ctx = await delegationService.resolveApproval(req.user, 'FINAL_APPROVAL', 'PO_FINAL');
      if (!ctx.allowed) {
        return res.status(403).json({ statusCode: 403, message: ctx.message });
      }
      req.approvalContext = ctx;
      next();
    } catch (err) {
      next(err);
    }
  };
}

function requirePmApproval() {
  return async (req, res, next) => {
    try {
      const { MaterialRequest } = require('../models');
      const mr = await MaterialRequest.findById(req.params.id);
      if (!mr) {
        return res.status(404).json({ statusCode: 404, message: 'Request not found' });
      }

      const ctx = await delegationService.resolveApproval(
        req.user,
        'APPROVE_MATERIAL_REQUEST',
        'MR_PM',
        mr.projectId
      );
      if (!ctx.allowed) {
        return res.status(403).json({ statusCode: 403, message: ctx.message });
      }
      req.approvalContext = ctx;
      req._materialRequest = mr;
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requireFinalApproval, requirePmApproval };
