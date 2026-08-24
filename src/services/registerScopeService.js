const { UserRole } = require('@afios/shared');
const { Site } = require('../models');
const { userCanAccessSite } = require('../utils/serialize');

async function sitesForProjectIds(projectIds) {
  if (!projectIds.length) return [];
  return Site.find({ projectId: { $in: projectIds } }).select('_id').lean();
}

/**
 * Resolve site scope for inward/outward registers, stock, and matching reports.
 * Store/PM: all sites in assigned projects so stock matches indent lists.
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

  const projectIds = (user.assignedProjectIds || []).map((id) => id.toString?.() || String(id));

  if (user.role === UserRole.STORE_INCHARGE || user.role === UserRole.SITE_INCHARGE) {
    if (projectIds.length) {
      const sites = await sitesForProjectIds(projectIds);
      if (sites.length) return { siteId: { $in: sites.map((s) => s._id) } };
    }
    if (user.assignedSiteId) return { siteId: user.assignedSiteId };
    return { empty: true };
  }

  if (user.role === UserRole.PROJECT_MANAGER) {
    if (projectIds.length) {
      const sites = await sitesForProjectIds(projectIds);
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

/** Flatten scope to a site-id list, or null meaning all sites. */
function siteIdsFromScope(scope) {
  if (scope.empty) return [];
  if (!scope.siteId) return null;
  if (scope.siteId.$in) return scope.siteId.$in;
  return [scope.siteId];
}

module.exports = {
  resolveRegisterSiteFilter,
  applySiteFilterToQuery,
  siteIdsFromScope,
};
