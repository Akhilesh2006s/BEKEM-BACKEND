const { UserRole } = require('@afios/shared');
const { Site } = require('../models');
const { userCanAccessSite } = require('../utils/serialize');

/**
 * Resolve site scope for inward/outward registers and matching reports.
 * Store/Site default to assigned site; multi-project users get all project sites.
 */
async function resolveRegisterSiteFilter(user, querySiteId) {
  if (querySiteId) {
    const sid = String(querySiteId);
    if (!userCanAccessSite(user, sid)) {
      const err = new Error('Forbidden — site out of scope');
      err.statusCode = 403;
      throw err;
    }
    return { siteId: sid };
  }

  if (user.role === UserRole.STORE_INCHARGE || user.role === UserRole.SITE_INCHARGE) {
    if (user.assignedSiteId) {
      return { siteId: user.assignedSiteId };
    }
    const projectIds = (user.assignedProjectIds || []).map((id) => id.toString?.() || String(id));
    if (projectIds.length) {
      const sites = await Site.find({ projectId: { $in: projectIds } }).select('_id').lean();
      if (sites.length) return { siteId: { $in: sites.map((s) => s._id) } };
    }
    return { empty: true };
  }

  if (user.role === UserRole.PROJECT_MANAGER) {
    const projectIds = (user.assignedProjectIds || []).map((id) => id.toString?.() || String(id));
    if (projectIds.length) {
      const sites = await Site.find({ projectId: { $in: projectIds } }).select('_id').lean();
      if (sites.length) return { siteId: { $in: sites.map((s) => s._id) } };
    }
    return { empty: true };
  }

  return {};
}

function applySiteFilterToQuery(filter, scope) {
  if (scope.empty) return false;
  if (scope.siteId) filter.siteId = scope.siteId;
  return true;
}

module.exports = {
  resolveRegisterSiteFilter,
  applySiteFilterToQuery,
};
