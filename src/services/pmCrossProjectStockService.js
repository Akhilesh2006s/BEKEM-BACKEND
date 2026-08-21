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

/** Full stock-on-hand for every material at every project assigned to the PM, grouped by project. */
async function getAllCrossProjectStock(user, options = {}) {
  if (user.role !== UserRole.PROJECT_MANAGER) return [];

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

  const emptyResult = otherProjects.map((p) => ({
    projectId: p._id.toString(),
    projectCode: p.code,
    projectName: p.name,
    materials: [],
  }));
  if (!sites.length) return emptyResult;

  const sitesById = new Map(sites.map((s) => [s._id.toString(), s]));
  const ledgers = await StockLedger.find({ siteId: { $in: sites.map((s) => s._id) } })
    .select('siteId materialId quantityOnHand quantityReserved')
    .populate('materialId', 'name code unit')
    .lean();

  const materialsByProject = new Map();
  for (const l of ledgers) {
    const onHand = l.quantityOnHand || 0;
    const reserved = l.quantityReserved || 0;
    const available = Math.max(0, onHand - reserved);
    if (available <= 0) continue;
    const mat = l.materialId;
    if (!mat) continue;
    const site = sitesById.get(l.siteId.toString());
    if (!site) continue;

    const pid = site.projectId.toString();
    const matId = mat._id.toString();
    if (!materialsByProject.has(pid)) materialsByProject.set(pid, new Map());
    const matMap = materialsByProject.get(pid);
    if (!matMap.has(matId)) {
      matMap.set(matId, {
        materialId: matId,
        materialCode: mat.code,
        materialName: mat.name,
        unit: mat.unit,
        availableQty: 0,
        sites: [],
      });
    }
    const entry = matMap.get(matId);
    entry.availableQty += available;
    entry.sites.push({
      siteId: l.siteId.toString(),
      siteName: siteDisplayName(site),
      availableQty: available,
    });
  }

  return otherProjects.map((p) => {
    const pid = p._id.toString();
    const matMap = materialsByProject.get(pid);
    const materials = matMap
      ? [...matMap.values()].sort((a, b) => (a.materialName || '').localeCompare(b.materialName || ''))
      : [];
    return {
      projectId: pid,
      projectCode: p.code,
      projectName: p.name,
      materials,
    };
  });
}

module.exports = {
  getPmAssignedProjects,
  getCrossProjectStockForMaterials,
  enrichIndentWithCrossProjectStock,
  getAllCrossProjectStock,
};
