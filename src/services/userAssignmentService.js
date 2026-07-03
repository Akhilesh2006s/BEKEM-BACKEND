const { UserRole } = require('@afios/shared');
const { Project, Site } = require('../models');

const SINGLE_PROJECT_ROLES = new Set([UserRole.SITE_INCHARGE, UserRole.PROJECT_MANAGER]);
const ALL_PROJECTS_ROLES = new Set([
  UserRole.EXECUTIVE,
  UserRole.COORDINATOR,
  UserRole.CHAIRMAN,
]);

function isSingleProjectRole(role) {
  return SINGLE_PROJECT_ROLES.has(role);
}

function isAllProjectsRole(role) {
  return ALL_PROJECTS_ROLES.has(role);
}

function isMultiProjectRole(role) {
  return role === UserRole.STORE_INCHARGE;
}

async function allProjectIds() {
  const projects = await Project.find().select('_id').lean();
  return projects.map((p) => p._id);
}

/**
 * Normalize project assignments by role:
 * - Site Manager / Project Manager: exactly one (last selected wins)
 * - Store Manager: one or many
 * - Executive / Coordinator / Chairman: all projects
 */
async function normalizeAssignedProjectIds(role, ids) {
  if (isAllProjectsRole(role)) {
    return allProjectIds();
  }
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (isSingleProjectRole(role)) {
    return list.length ? [list[list.length - 1]] : [];
  }
  return list;
}

/**
 * Resolve primary site for site/store roles from project assignment.
 */
async function resolveAssignedSiteId(role, projectIds, requestedSiteId) {
  if (![UserRole.SITE_INCHARGE, UserRole.STORE_INCHARGE].includes(role)) {
    return requestedSiteId || null;
  }

  const ids = (projectIds || []).map((id) => id.toString());
  if (!ids.length) return requestedSiteId || null;

  if (requestedSiteId) {
    const site = await Site.findById(requestedSiteId).select('projectId');
    if (site && ids.includes(site.projectId?.toString())) {
      return site._id;
    }
  }

  const firstSite = await Site.findOne({ projectId: { $in: projectIds } }).sort({ createdAt: 1 });
  return firstSite?._id || null;
}

async function applyRoleAssignments(user, { assignedProjectIds, assignedSiteId } = {}) {
  let inputProjects =
    assignedProjectIds !== undefined ? assignedProjectIds : user.assignedProjectIds;
  const siteHint = assignedSiteId !== undefined ? assignedSiteId : user.assignedSiteId;

  if (
    (isSingleProjectRole(user.role) || isMultiProjectRole(user.role)) &&
    (!inputProjects || !inputProjects.length) &&
    siteHint
  ) {
    const site = await Site.findById(siteHint).select('projectId');
    if (site?.projectId) inputProjects = [site.projectId];
  }

  const projectIds = await normalizeAssignedProjectIds(user.role, inputProjects);
  user.assignedProjectIds = projectIds;
  user.assignedSiteId = await resolveAssignedSiteId(user.role, projectIds, siteHint);
  return user;
}

async function assignUserToProject(user, projectId) {
  const pid = projectId.toString();
  if (isAllProjectsRole(user.role)) {
    const all = await allProjectIds();
    user.assignedProjectIds = all;
    user.assignedSiteId = null;
    await user.save();
    return user;
  }

  if (isSingleProjectRole(user.role)) {
    user.assignedProjectIds = [projectId];
    user.assignedSiteId = await resolveAssignedSiteId(user.role, [projectId], null);
    await user.save();
    return user;
  }

  // Store Manager — one or many
  const current = (user.assignedProjectIds || []).map((id) => id.toString());
  if (!current.includes(pid)) {
    user.assignedProjectIds = [...(user.assignedProjectIds || []), projectId];
  }
  user.assignedSiteId = await resolveAssignedSiteId(
    user.role,
    user.assignedProjectIds,
    user.assignedSiteId
  );
  await user.save();
  return user;
}

async function removeUserFromProject(user, projectId) {
  const pid = projectId.toString();
  if (isAllProjectsRole(user.role)) {
    const err = new Error('Executive, Coordinator, and Chairman are assigned to all projects');
    err.statusCode = 400;
    throw err;
  }

  user.assignedProjectIds = (user.assignedProjectIds || []).filter((id) => id.toString() !== pid);

  if (
    user.assignedSiteId &&
    (await Site.findOne({ _id: user.assignedSiteId, projectId }))
  ) {
    user.assignedSiteId = await resolveAssignedSiteId(
      user.role,
      user.assignedProjectIds,
      null
    );
  } else if (!user.assignedProjectIds.length) {
    user.assignedSiteId = null;
  }

  await user.save();
  return user;
}

/** When a new project is created, attach it to HQ roles that own all projects. */
async function attachProjectToAllProjectsRoles(projectId) {
  const { User } = require('../models');
  await User.updateMany(
    { role: { $in: [...ALL_PROJECTS_ROLES] } },
    { $addToSet: { assignedProjectIds: projectId } }
  );
}

module.exports = {
  SINGLE_PROJECT_ROLES,
  ALL_PROJECTS_ROLES,
  isSingleProjectRole,
  isAllProjectsRole,
  isMultiProjectRole,
  allProjectIds,
  normalizeAssignedProjectIds,
  resolveAssignedSiteId,
  applyRoleAssignments,
  assignUserToProject,
  removeUserFromProject,
  attachProjectToAllProjectsRoles,
};
