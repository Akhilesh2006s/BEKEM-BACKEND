const { UserRole } = require('@afios/shared');
const { userCanAccessProject } = require('../utils/serialize');

const ALL_PROJECTS_ROLES = new Set([
  UserRole.EXECUTIVE,
  UserRole.COORDINATOR,
  UserRole.CHAIRMAN,
]);

function seesAllProjects(role) {
  return ALL_PROJECTS_ROLES.has(role);
}

function projectScopeFilter(user, projectField = 'projectId') {
  if (seesAllProjects(user.role)) return {};
  if (user.role === UserRole.PROJECT_MANAGER) {
    return { [projectField]: { $in: user.assignedProjectIds || [] } };
  }
  return {};
}

function assertCanAccessProject(user, projectId) {
  if (!projectId) return true;
  if (userCanAccessProject(user, projectId)) return true;
  const err = new Error('Forbidden — project out of scope');
  err.statusCode = 403;
  throw err;
}

function assertCanAccessBranchTransfer(user, transfer) {
  if (seesAllProjects(user.role)) return true;
  const fromId = transfer.fromProjectId?._id || transfer.fromProjectId;
  const toId = transfer.toProjectId?._id || transfer.toProjectId;
  if (userCanAccessProject(user, fromId) || userCanAccessProject(user, toId)) return true;
  const err = new Error('Forbidden — project out of scope');
  err.statusCode = 403;
  throw err;
}

function rejectStoreSiteForWorkOrders(req, res, next) {
  if ([UserRole.STORE_INCHARGE, UserRole.SITE_INCHARGE].includes(req.user.role)) {
    return res.status(403).json({
      statusCode: 403,
      message: 'Work orders are not accessible to Store or Site roles',
    });
  }
  next();
}

module.exports = {
  seesAllProjects,
  projectScopeFilter,
  assertCanAccessProject,
  assertCanAccessBranchTransfer,
  rejectStoreSiteForWorkOrders,
  ALL_PROJECTS_ROLES,
};
