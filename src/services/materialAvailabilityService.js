const { UserRole } = require('@afios/shared');
const { Material, Site, StockLedger, Project } = require('../models');

async function getMaterialAvailability(user, materialId) {
  const material = await Material.findById(materialId).lean();
  if (!material) {
    const err = new Error('Material not found');
    err.statusCode = 404;
    throw err;
  }

  const ledgers = await StockLedger.find({ materialId })
    .populate('siteId', 'name projectId')
    .lean();

  const projectIds = [...new Set(ledgers.map((l) => l.siteId?.projectId?.toString()).filter(Boolean))];
  const projects = await Project.find({ _id: { $in: projectIds } })
    .select('name code')
    .lean();
  const projectById = new Map(projects.map((p) => [p._id.toString(), p]));

  const storeRows = ledgers.map((l) => {
    const onHand = l.quantityOnHand || 0;
    const reserved = l.quantityReserved || 0;
    const availableQty = Math.max(0, onHand - reserved);
    const pid = l.siteId?.projectId?.toString();
    const proj = pid ? projectById.get(pid) : null;
    return {
      siteId: l.siteId?._id?.toString(),
      siteName: l.siteId?.name || 'Store',
      projectId: pid,
      projectCode: proj?.code || '',
      projectName: proj?.name || '',
      availableQty,
    };
  });

  const projectQty = new Map();
  for (const row of storeRows) {
    if (!row.projectId) continue;
    projectQty.set(row.projectId, (projectQty.get(row.projectId) || 0) + row.availableQty);
  }

  const projectWise = [...projectQty.entries()].map(([projectId, availableQty]) => {
    const p = projectById.get(projectId);
    return {
      projectId,
      projectCode: p?.code || '',
      projectName: p?.name || '',
      availableQty,
    };
  });

  const companyAvailableQty = storeRows.reduce((sum, r) => sum + r.availableQty, 0);

  let pmStoreAvailableQty = companyAvailableQty;
  if (user.role === UserRole.PROJECT_MANAGER && user.assignedProjectIds?.length) {
    const allowed = new Set(user.assignedProjectIds.map((id) => id.toString()));
    pmStoreAvailableQty = storeRows
      .filter((r) => r.projectId && allowed.has(r.projectId))
      .reduce((sum, r) => sum + r.availableQty, 0);
  }

  const pmProjects =
    user.role === UserRole.PROJECT_MANAGER && user.assignedProjectIds?.length
      ? projectWise.filter((p) => user.assignedProjectIds.some((id) => id.toString() === p.projectId))
      : projectWise;

  return {
    materialId: material._id.toString(),
    materialName: material.name,
    materialCode: material.code,
    unit: material.unit,
    storeAvailableQty: pmStoreAvailableQty,
    companyAvailableQty,
    stores: storeRows,
    projectWise: pmProjects,
  };
}

module.exports = { getMaterialAvailability };
