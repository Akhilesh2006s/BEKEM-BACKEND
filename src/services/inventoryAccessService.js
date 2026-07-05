const { UserRole } = require('@afios/shared');
const { Project, Site } = require('../models');
const { seesAllProjects } = require('../middleware/projectScope');

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolve which inventory project names (PO index `project` column) a user may access.
 */
async function resolveInventoryScope(user) {
  if (seesAllProjects(user.role)) {
    return { mode: 'all', projectNames: null, projects: [], primaryProjectName: null };
  }

  let projectIds = (user.assignedProjectIds || []).map((id) => id.toString());

  if (user.role === UserRole.STORE_INCHARGE) {
    if (user.assignedSiteId) {
      const site = await Site.findById(user.assignedSiteId).select('projectId');
      if (site?.projectId) {
        projectIds = [site.projectId.toString()];
      }
    } else if (projectIds.length > 1) {
      projectIds = [projectIds[0]];
    }
  }

  if (!projectIds.length) {
    return { mode: 'none', projectNames: [], projects: [], primaryProjectName: null };
  }

  const projects = await Project.find({ _id: { $in: projectIds } })
    .select('name code')
    .sort({ name: 1 });

  const projectNames = projects.map((p) => p.name);

  return {
    mode: user.role === UserRole.STORE_INCHARGE ? 'single' : 'assigned',
    projectNames,
    primaryProjectName: projectNames[0] || null,
    projects: projects.map((p) => ({
      id: p._id.toString(),
      name: p.name,
      code: p.code,
    })),
  };
}

function findAllowedProjectName(scope, requestedProject) {
  if (!requestedProject || scope.mode === 'all') return requestedProject || null;
  const allowed = scope.projectNames || [];
  const needle = requestedProject.trim().toLowerCase();
  return (
    allowed.find(
      (name) =>
        name.toLowerCase() === needle ||
        name.toLowerCase().includes(needle) ||
        needle.includes(name.toLowerCase())
    ) || null
  );
}

function assertProjectQueryAllowed(scope, requestedProject) {
  if (!requestedProject || scope.mode === 'all') return;
  if (!findAllowedProjectName(scope, requestedProject)) {
    const err = new Error('Forbidden — project out of scope');
    err.statusCode = 403;
    throw err;
  }
}

function assertRecordProjectAllowed(scope, recordProject) {
  if (scope.mode === 'all') return;
  const allowed = scope.projectNames || [];
  if (!recordProject || !allowed.includes(recordProject)) {
    const err = new Error('Forbidden — project out of scope');
    err.statusCode = 403;
    throw err;
  }
}

function buildInventoryProjectFilter(scope, requestedProject) {
  if (scope.mode === 'all') {
    if (!requestedProject) return {};
    return { project: new RegExp(escapeRegex(requestedProject), 'i') };
  }

  const allowed = scope.projectNames || [];
  if (!allowed.length) {
    return { project: '__none__' };
  }

  if (requestedProject) {
    const match = findAllowedProjectName(scope, requestedProject);
    return { project: new RegExp(`^${escapeRegex(match)}$`, 'i') };
  }

  if (allowed.length === 1) {
    return { project: new RegExp(`^${escapeRegex(allowed[0])}$`, 'i') };
  }

  return { project: { $in: allowed } };
}

module.exports = {
  resolveInventoryScope,
  assertProjectQueryAllowed,
  assertRecordProjectAllowed,
  buildInventoryProjectFilter,
  findAllowedProjectName,
};
