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

function hasPositiveOtherProjectStock(crossRows) {
  for (const row of crossRows || []) {
    for (const project of row.projects || []) {
      for (const site of project.sites || []) {
        if (Number(site.availableQty) > 0) return true;
      }
    }
  }
  return false;
}

function otherQtyByMaterial(crossProjectStock) {
  const map = new Map();
  for (const row of crossProjectStock || []) {
    const mid = String(row.materialId);
    const total = (row.projects || []).reduce(
      (sum, p) => sum + Math.max(0, Number(p.availableQty || 0)),
      0
    );
    map.set(mid, (map.get(mid) || 0) + total);
  }
  return map;
}

function coveredQtyByMaterialFromTransfers(transfers) {
  const closed = new Set(['REJECTED', 'RAISE_PO_INSTEAD']);
  const map = {};
  for (const t of transfers || []) {
    if (closed.has(t.status)) continue;
    for (const item of t.items || []) {
      const mid = String(item.materialId || '');
      if (!mid) continue;
      map[mid] = (map[mid] || 0) + Number(item.quantity || 0);
    }
  }
  return map;
}

/**
 * Combined current-project + other-PM-projects stock vs full indent required qty.
 * Branch Transfer is viable only when physical stock across projects can cover
 * the entire indent quantity (not just the remainder after an existing BT).
 */
function evaluateBranchTransferViability(stockByLine, crossProjectStock, alreadyCoveredByMaterial = {}) {
  const otherByMaterial = otherQtyByMaterial(crossProjectStock);
  const lines = (stockByLine || []).map((s) => {
    const materialId = String(s.materialId);
    const requiredQty = Number(s.requestedQty ?? s.requiredQty ?? s.quantityRequested ?? 0);
    const currentProjectAvailableQty = Math.max(
      0,
      Number(s.availableQty ?? s.currentProjectAvailableQty ?? 0)
    );
    const otherProjectsAvailableQty = Math.max(0, Number(otherByMaterial.get(materialId) || 0));
    const alreadyCoveredQty = Math.max(0, Number(alreadyCoveredByMaterial[materialId] || 0));
    const remainingNeedQty = Math.max(0, requiredQty - alreadyCoveredQty);
    const combinedAvailableQty = currentProjectAvailableQty + otherProjectsAvailableQty;
    /** Still uncovered after current site stock + existing branch transfers. */
    const shortfallAfterCurrent = Math.max(
      0,
      requiredQty - currentProjectAvailableQty - alreadyCoveredQty
    );
    /** Gap vs full indent after combining all project stock (current + other projects). */
    const shortfallAfterCombined = Math.max(0, requiredQty - combinedAvailableQty);
    const fulfilledByCurrentAndBt =
      currentProjectAvailableQty + alreadyCoveredQty >= requiredQty;
    const canCoverViaCombinedStock = combinedAvailableQty >= requiredQty;
    return {
      materialId,
      materialName: s.materialName,
      unit: s.unit,
      requiredQty,
      currentProjectAvailableQty,
      otherProjectsAvailableQty,
      combinedAvailableQty,
      alreadyCoveredQty,
      remainingNeedQty,
      shortfallAfterCurrent,
      shortfallAfterCombined,
      branchTransferViable:
        !fulfilledByCurrentAndBt &&
        currentProjectAvailableQty < requiredQty &&
        canCoverViaCombinedStock,
    };
  });

  const unfulfilledLines = lines.filter(
    (l) => l.currentProjectAvailableQty + l.alreadyCoveredQty < l.requiredQty
  );
  return {
    currentProjectInsufficient: unfulfilledLines.length > 0,
    branchTransferViable:
      unfulfilledLines.length > 0 &&
      unfulfilledLines.every((l) => l.combinedAvailableQty >= l.requiredQty),
    lines,
  };
}

async function evaluateIndentBranchTransfer(mr, user, stockContext) {
  if (!user || user.role !== UserRole.PROJECT_MANAGER) {
    return evaluateBranchTransferViability(stockContext?.stockByLine || [], []);
  }
  const cross = await enrichIndentWithCrossProjectStock(mr, user);
  const { BranchTransfer } = require('../models');
  const transfers = await BranchTransfer.find({ materialRequestId: mr._id })
    .select('status items')
    .lean();
  return evaluateBranchTransferViability(
    stockContext?.stockByLine || [],
    cross || [],
    coveredQtyByMaterialFromTransfers(transfers)
  );
}

/** True when another PM-assigned project has on-hand qty for this indent's materials. */
async function indentHasOtherProjectStock(mr, user) {
  const cross = await enrichIndentWithCrossProjectStock(mr, user);
  return hasPositiveOtherProjectStock(cross);
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
  hasPositiveOtherProjectStock,
  indentHasOtherProjectStock,
  evaluateBranchTransferViability,
  evaluateIndentBranchTransfer,
  coveredQtyByMaterialFromTransfers,
};
