const { Material, Vendor, Project } = require('../models');
const { UserRole } = require('@afios/shared');

const SEARCH_LIMIT = 20;

function escapeRegex(term) {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function searchMaterials(q, user) {
  const term = String(q || '').trim();
  if (term.length < 1) return [];
  const regex = new RegExp(escapeRegex(term), 'i');
  const materials = await Material.find({
    isActive: { $ne: false },
    $or: [
      { name: regex },
      { code: regex },
      { description: regex },
      { hsnCode: regex },
      { category: regex },
    ],
  })
    .sort({ code: 1 })
    .limit(SEARCH_LIMIT)
    .lean();

  return materials.map((m) => ({
    id: m._id.toString(),
    itemCode: m.code,
    description: m.description || m.name,
    name: m.name,
    hsnCode: m.hsnCode || '',
    gstRate: m.gstRate ?? 18,
    unit: m.unit,
    category: m.category || '',
  }));
}

async function searchVendors(q, user, { materialId } = {}) {
  const term = String(q || '').trim();
  const clauses = [{ isActive: { $ne: false } }];
  if (materialId) {
    clauses.push({
      $or: [{ materialIds: materialId }, { materialIds: { $size: 0 } }],
    });
  }
  if (term.length >= 1) {
    const regex = new RegExp(escapeRegex(term), 'i');
    clauses.push({
      $or: [
        { name: regex },
        { code: regex },
        { gstNumber: regex },
        { category: regex },
        { contactPerson: regex },
      ],
    });
  }
  const filter = clauses.length > 1 ? { $and: clauses } : clauses[0];
  const vendors = await Vendor.find(filter).sort({ name: 1 }).limit(SEARCH_LIMIT).lean();
  return vendors.map((v) => ({
    id: v._id.toString(),
    code: v.code || '',
    name: v.name,
    gstNumber: v.gstNumber || '',
    category: v.category || '',
  }));
}

async function searchProjects(q, user) {
  const term = String(q || '').trim();
  let filter = {};
  if ([UserRole.EXECUTIVE, UserRole.COORDINATOR, UserRole.CHAIRMAN].includes(user.role)) {
    filter = {};
  } else if (user.assignedProjectIds?.length) {
    filter = { _id: { $in: user.assignedProjectIds } };
  } else {
    return [];
  }
  if (term.length >= 1) {
    const regex = new RegExp(escapeRegex(term), 'i');
    filter.$and = [
      ...(filter.$and || []),
      { $or: [{ name: regex }, { code: regex }, { location: regex }] },
    ];
  }
  const projects = await Project.find(filter).sort({ code: 1 }).limit(SEARCH_LIMIT).lean();
  return projects.map((p) => ({
    id: p._id.toString(),
    code: p.code,
    name: p.name,
    location: p.location,
    status: p.status,
  }));
}

async function searchBranchTransferTargets(q, user, { fromProjectId, excludeProjectId } = {}) {
  const term = String(q || '').trim();
  let filter = {};
  const canSearchAll =
    [UserRole.EXECUTIVE, UserRole.COORDINATOR, UserRole.CHAIRMAN, UserRole.STORE_INCHARGE].includes(
      user.role
    );
  if (canSearchAll) {
    filter = {};
  } else if (user.assignedProjectIds?.length) {
    filter = { _id: { $in: user.assignedProjectIds } };
  } else {
    return [];
  }
  const exclude = excludeProjectId || fromProjectId;
  if (exclude) {
    filter._id = { ...(filter._id || {}), $ne: exclude };
  }
  if (term.length >= 1) {
    const regex = new RegExp(escapeRegex(term), 'i');
    filter.$and = [
      ...(filter.$and || []),
      { $or: [{ name: regex }, { code: regex }] },
    ];
  }
  const projects = await Project.find(filter).sort({ code: 1 }).limit(SEARCH_LIMIT).lean();
  return projects.map((p) => ({
    id: p._id.toString(),
    code: p.code,
    name: p.name,
  }));
}

module.exports = {
  SEARCH_LIMIT,
  searchMaterials,
  searchVendors,
  searchProjects,
  searchBranchTransferTargets,
};
