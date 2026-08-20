const { UserRole } = require('@afios/shared');
const { Project, Site, StockLedger } = require('../models');
const { getIndentLineItems } = require('./materialRequestHelpers');

function siteDisplayName(site) {
  const name = (site.name || '').trim();
  const chainage = (site.chainageLabel || '').trim();
  if (name && chainage && name !== chainage) return `${name} · ${chainage}`;
  return name || chainage || 'Site';
}

async function getPmAssignedProjects(user) {
  if (!user?.assignedProjectIds?.length) return [];
  return Project.find({ _id: { $in: user.assignedProjectIds } })
    .select('name code')
    .sort({ name: 1 })
    .lean();
}

async function getCrossProjectStockForMaterials(user, materialIds, options = {}) {
  if (user.role !== UserRole.PROJECT_MANAGER || !materialIds?.length) {
    return [];
  }

  const excludeProjectId = options.excludeProjectId ? String(options.excludeProjectId) : '';

  const projects = await getPmAssignedProjects(user);
  const otherProjects = excludeProjectId
    ? projects.filter((p) => p._id.toString() !== excludeProjectId)
    : projects;
  if (!otherProjects.length) return [];

  const projectIds = otherProjects.map((p) => p._id);
  const sites = await Site.find({ projectId: { $in: projectIds } })
    .select('projectId name chainageLabel')
    .lean();

  const uniqueMaterialIds = [...new Set(materialIds.map((id) => id.toString()))];
  const ledgers = sites.length
    ? await StockLedger.find({
        materialId: { $in: uniqueMaterialIds },
        siteId: { $in: sites.map((s) => s._id) },
      })
        .select('siteId materialId quantityOnHand quantityReserved')
        .lean()
    : [];

  const qtyBySiteMaterial = new Map();
  for (const l of ledgers) {
    const key = `${l.siteId.toString()}|${l.materialId.toString()}`;
    const onHand = l.quantityOnHand || 0;
    const reserved = l.quantityReserved || 0;
    const available = Math.max(0, onHand - reserved);
    qtyBySiteMaterial.set(key, (qtyBySiteMaterial.get(key) || 0) + available);
  }

  const sitesByProject = new Map();
  for (const s of sites) {
    const pid = s.projectId.toString();
    if (!sitesByProject.has(pid)) sitesByProject.set(pid, []);
    sitesByProject.get(pid).push(s);
  }

  return uniqueMaterialIds.map((materialId) => ({
    materialId,
    projects: otherProjects.map((p) => {
      const pid = p._id.toString();
      const projectSites = sitesByProject.get(pid) || [];
      const siteRows = projectSites.map((s) => ({
        siteId: s._id.toString(),
        siteName: siteDisplayName(s),
        availableQty: qtyBySiteMaterial.get(`${s._id.toString()}|${materialId}`) || 0,
      }));
      const availableQty = siteRows.reduce((sum, row) => sum + row.availableQty, 0);
      return {
        projectId: pid,
        projectCode: p.code,
        projectName: p.name,
        availableQty,
        sites: siteRows,
      };
    }),
  }));
}

async function enrichIndentWithCrossProjectStock(mr, user) {
  if (user?.role !== UserRole.PROJECT_MANAGER) return null;
  const lineItems = getIndentLineItems(mr);
  const materialIds = lineItems.map((item) => (item.materialId?._id || item.materialId).toString());
  const excludeProjectId = mr.projectId?._id || mr.projectId;
  return getCrossProjectStockForMaterials(user, materialIds, { excludeProjectId });
}

module.exports = {
  getPmAssignedProjects,
  getCrossProjectStockForMaterials,
  enrichIndentWithCrossProjectStock,
};
