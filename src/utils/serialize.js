const { UserRole } = require('@afios/shared');
const { getIndentLineItems, pendingWithLabel } = require('../services/materialRequestHelpers');

function resolveId(ref) {
  if (!ref) return null;
  if (ref._id) return ref._id.toString();
  return ref.toString();
}

function userCanAccessProject(user, projectId) {
  const pid = resolveId(projectId);
  if ([UserRole.EXECUTIVE, UserRole.COORDINATOR, UserRole.CHAIRMAN].includes(user.role)) {
    return true;
  }
  if (
    [UserRole.PROJECT_MANAGER, UserRole.SITE_INCHARGE, UserRole.STORE_INCHARGE].includes(user.role)
  ) {
    return (user.assignedProjectIds || []).some((id) => id.toString() === pid);
  }
  return false;
}

function userCanAccessSite(user, siteId) {
  const sid = resolveId(siteId);
  if ([UserRole.EXECUTIVE, UserRole.COORDINATOR, UserRole.CHAIRMAN].includes(user.role)) {
    return true;
  }
  if (user.role === UserRole.PROJECT_MANAGER) {
    return true;
  }
  if ([UserRole.SITE_INCHARGE, UserRole.STORE_INCHARGE].includes(user.role)) {
    return user.assignedSiteId?.toString() === sid;
  }
  return false;
}

/** Store managers with multiple projects may access any site under those projects. */
async function userCanAccessSiteAsync(user, siteId) {
  if (userCanAccessSite(user, siteId)) return true;
  if (user.role !== UserRole.STORE_INCHARGE || !user.assignedProjectIds?.length) return false;
  const { Site } = require('../models');
  const site = await Site.findById(siteId).select('projectId');
  if (!site?.projectId) return false;
  return user.assignedProjectIds.some((id) => id.toString() === site.projectId.toString());
}

function serializeUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    assignedProjectIds: (user.assignedProjectIds || []).map((id) => id.toString()),
    assignedSiteId: user.assignedSiteId?.toString() || null,
    avatarColor: user.avatarColor,
    locale: user.locale || 'en',
    notificationPrefs: {
      inApp: user.notificationPrefs?.inApp !== false,
      emailDigest: !!user.notificationPrefs?.emailDigest,
      sms: !!user.notificationPrefs?.sms,
    },
  };
}

function serializeMaterial(m) {
  if (!m) return undefined;
  return {
    id: m._id?.toString() || m.id,
    code: m.code,
    name: m.name,
    description: m.description || '',
    unit: m.unit,
    grade: m.grade || '',
    category: m.category || 'Consumables',
    categoryId: m.categoryId?.toString?.() || m.categoryId || undefined,
    hsnCode: m.hsnCode || '',
    gstRate: m.gstRate ?? 18,
  };
}

function serializeLineItem(item, stockFields) {
  const mat = item.materialId;
  const unit = item.unit || mat?.unit || '';
  const material = mat?.name ? serializeMaterial(mat) : undefined;
  if (material && unit) material.unit = unit;
  const base = {
    id: item._id.toString(),
    materialId: resolveId(mat),
    quantityRequested: item.quantityRequested,
    quantityAllocated: item.quantityAllocated || 0,
    quantityIssued: item.quantityIssued || 0,
    unit,
    material,
  };
  if (stockFields) {
    base.requestedQty = stockFields.requestedQty;
    base.availableQty = stockFields.availableQty;
    base.existingStock = stockFields.existingStock;
    base.requiredQty = stockFields.requiredQty;
  }
  return base;
}

function serializeMaterialRequest(mr, stockContext) {
  const lineItems = getIndentLineItems(mr);
  const first = lineItems[0];
  const firstMat = first?.materialId;
  const stockByItemId = new Map(
    (stockContext?.stockByLine || []).map((s) => [s.itemId, s])
  );

  const base = {
    id: mr._id.toString(),
    indentNumber: mr.indentNumber,
    projectId: resolveId(mr.projectId),
    siteId: resolveId(mr.siteId),
    items: lineItems.map((item) =>
      serializeLineItem(item, stockByItemId.get(item._id.toString()))
    ),
    itemCount: lineItems.length,
    materialId: resolveId(firstMat),
    quantityRequested: first?.quantityRequested,
    quantityAllocated: first?.quantityAllocated || 0,
    purpose: mr.purpose || '',
    requiredByDate: mr.requiredByDate?.toISOString?.() || mr.requiredByDate || null,
    requestedByUserId: resolveId(mr.requestedByUserId),
    status: mr.status,
    pendingWith: pendingWithLabel(mr.status),
    estimatedValue: mr.estimatedValue || 0,
    escalatedToHo: !!mr.escalatedToHo,
    canFullyIssue: stockContext?.canFullyIssue,
    hasShortfall: stockContext?.hasShortfall,
    createdAt: mr.createdAt?.toISOString?.() || mr.createdAt,
    updatedAt: mr.updatedAt?.toISOString?.() || mr.updatedAt,
  };

  if (firstMat?.name) base.material = serializeMaterial(firstMat);
  if (mr.siteId?.chainageLabel) {
    base.site = {
      id: mr.siteId._id.toString(),
      projectId: resolveId(mr.siteId.projectId),
      name: mr.siteId.name,
      chainageLabel: mr.siteId.chainageLabel,
    };
  }
  if (mr.projectId?.code) {
    base.project = {
      id: mr.projectId._id.toString(),
      code: mr.projectId.code,
      name: mr.projectId.name,
      location: mr.projectId.location,
      status: mr.projectId.status,
      startDate: mr.projectId.startDate?.toISOString?.(),
      targetEndDate: mr.projectId.targetEndDate?.toISOString?.(),
      budgetTotal: mr.projectId.budgetTotal,
      budgetSpent: mr.projectId.budgetSpent,
      healthScore: mr.projectId.healthScore,
    };
  }
  if (mr.requestedByUserId?.name) {
    base.requester = {
      id: mr.requestedByUserId._id.toString(),
      name: mr.requestedByUserId.name,
    };
  }

  return base;
}

async function serializeMaterialRequestEnriched(mr) {
  const { enrichIndentWithStock } = require('../services/indentStockService');
  const stockContext = await enrichIndentWithStock(mr);
  return serializeMaterialRequest(mr, stockContext);
}

module.exports = {
  resolveId,
  userCanAccessProject,
  userCanAccessSite,
  userCanAccessSiteAsync,
  serializeUser,
  serializeMaterial,
  serializeMaterialRequest,
  serializeMaterialRequestEnriched,
};
