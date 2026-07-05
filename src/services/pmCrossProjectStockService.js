const { UserRole } = require('@afios/shared');
const { Project, Site, StockLedger } = require('../models');
const { getIndentLineItems } = require('./materialRequestHelpers');

async function getPmAssignedProjects(user) {
  if (!user?.assignedProjectIds?.length) return [];
  return Project.find({ _id: { $in: user.assignedProjectIds } })
    .select('name code')
    .sort({ name: 1 })
    .lean();
}

async function getCrossProjectStockForMaterials(user, materialIds) {
  if (user.role !== UserRole.PROJECT_MANAGER || !materialIds?.length) {
    return [];
  }

  const projects = await getPmAssignedProjects(user);
  if (!projects.length) return [];

  const projectIds = projects.map((p) => p._id);
  const sites = await Site.find({ projectId: { $in: projectIds } })
    .select('projectId name')
    .lean();

  const sitesByProject = new Map();
  for (const s of sites) {
    const pid = s.projectId.toString();
    if (!sitesByProject.has(pid)) sitesByProject.set(pid, []);
    sitesByProject.get(pid).push(s._id);
  }

  const uniqueMaterialIds = [...new Set(materialIds.map((id) => id.toString()))];
  const ledgers = await StockLedger.find({
    materialId: { $in: uniqueMaterialIds },
    siteId: { $in: sites.map((s) => s._id) },
  })
    .select('siteId materialId quantityOnHand quantityReserved')
    .lean();

  const siteToProject = new Map(sites.map((s) => [s._id.toString(), s.projectId.toString()]));

  const qtyByProjectMaterial = new Map();
  for (const l of ledgers) {
    const pid = siteToProject.get(l.siteId.toString());
    if (!pid) continue;
    const key = `${pid}|${l.materialId.toString()}`;
    const onHand = l.quantityOnHand || 0;
    const reserved = l.quantityReserved || 0;
    const available = Math.max(0, onHand - reserved);
    qtyByProjectMaterial.set(key, (qtyByProjectMaterial.get(key) || 0) + available);
  }

  return uniqueMaterialIds.map((materialId) => ({
    materialId,
    projects: projects.map((p) => {
      const pid = p._id.toString();
      return {
        projectId: pid,
        projectCode: p.code,
        projectName: p.name,
        availableQty: qtyByProjectMaterial.get(`${pid}|${materialId}`) || 0,
      };
    }),
  }));
}

async function enrichIndentWithCrossProjectStock(mr, user) {
  if (user?.role !== UserRole.PROJECT_MANAGER) return null;
  const lineItems = getIndentLineItems(mr);
  const materialIds = lineItems.map((item) => (item.materialId?._id || item.materialId).toString());
  return getCrossProjectStockForMaterials(user, materialIds);
}

module.exports = {
  getPmAssignedProjects,
  getCrossProjectStockForMaterials,
  enrichIndentWithCrossProjectStock,
};
