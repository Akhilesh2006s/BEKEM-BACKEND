const { UserRole } = require('@afios/shared');
const { userCanAccessProject } = require('../utils/serialize');
const { PurchaseRequest } = require('../models');

const HO_ROLES = new Set([UserRole.EXECUTIVE, UserRole.COORDINATOR, UserRole.CHAIRMAN]);
/** Store → Chairman may view POs. Site Incharge cannot. */
const PO_VIEW_ROLES = new Set([
  UserRole.STORE_INCHARGE,
  UserRole.PROJECT_MANAGER,
  UserRole.EXECUTIVE,
  UserRole.COORDINATOR,
  UserRole.CHAIRMAN,
]);

function poProjectId(po) {
  const pr = po.purchaseRequestId;
  if (!pr) return null;
  return pr.projectId?._id || pr.projectId || null;
}

/** Resolves project when purchaseRequestId is an unpopulated ObjectId (e.g. grn-counter). */
async function resolvePoProjectId(po) {
  const direct = poProjectId(po);
  if (direct) return direct;
  const prRef = po.purchaseRequestId;
  if (!prRef) return null;
  const prId = typeof prRef === 'object' && prRef._id ? prRef._id : prRef;
  const pr = await PurchaseRequest.findById(prId).select('projectId').lean();
  return pr?.projectId || null;
}

function rejectSitePoAccess(req, res, next) {
  if (req.user?.role === UserRole.SITE_INCHARGE) {
    return res.status(403).json({
      statusCode: 403,
      message: 'Purchase orders are not accessible to Site roles',
    });
  }
  next();
}

function requirePoEditRole(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ statusCode: 401, message: 'Unauthorized' });
  }
  if ([UserRole.COORDINATOR, UserRole.CHAIRMAN].includes(req.user.role)) {
    return next();
  }
  return res.status(403).json({
    statusCode: 403,
    message: 'Forbidden: only Coordinator or Chairman may edit purchase orders',
  });
}

async function assertCanViewPurchaseOrder(user, po) {
  if (!PO_VIEW_ROLES.has(user.role)) {
    const err = new Error('Purchase orders are not accessible to this role');
    err.statusCode = 403;
    throw err;
  }

  if (HO_ROLES.has(user.role)) return true;

  const projectId = await resolvePoProjectId(po);
  if (!projectId) {
    const err = new Error('Forbidden — project out of scope');
    err.statusCode = 403;
    throw err;
  }

  if (!userCanAccessProject(user, projectId)) {
    const err = new Error('Forbidden — project out of scope');
    err.statusCode = 403;
    throw err;
  }
  return true;
}

function assertCanListPurchaseOrders(user, { queue } = {}) {
  if (!PO_VIEW_ROLES.has(user.role)) {
    const err = new Error('Purchase orders are not accessible to this role');
    err.statusCode = 403;
    throw err;
  }

  if (queue === 'coordinator' && user.role !== UserRole.COORDINATOR) {
    const err = new Error('Only Coordinator may open the coordinator verification queue');
    err.statusCode = 403;
    throw err;
  }
  if (queue === 'chairman' && user.role !== UserRole.CHAIRMAN) {
    const err = new Error('Only Chairman may open the chairman approval queue');
    err.statusCode = 403;
    throw err;
  }
  if (queue === 'pm') {
    const err = new Error('PM PO approval queue is retired — approval is Coordinator / Chairman only');
    err.statusCode = 403;
    throw err;
  }
  return true;
}

async function purchaseOrderListFilter(user, baseFilter = {}) {
  if (HO_ROLES.has(user.role)) return baseFilter;

  if (user.role === UserRole.PROJECT_MANAGER || user.role === UserRole.STORE_INCHARGE) {
    const projectIds = user.assignedProjectIds || [];
    if (!projectIds.length) return { _id: null };
    const prIds = await PurchaseRequest.find({
      projectId: { $in: projectIds },
    }).distinct('_id');
    return {
      ...baseFilter,
      purchaseRequestId: { $in: prIds },
    };
  }

  return { _id: null };
}

async function filterPurchaseOrdersForUser(user, orders) {
  if (HO_ROLES.has(user.role)) return orders;

  if (user.role === UserRole.PROJECT_MANAGER || user.role === UserRole.STORE_INCHARGE) {
    return orders.filter((po) => userCanAccessProject(user, poProjectId(po)));
  }

  return [];
}

module.exports = {
  rejectSitePoAccess,
  requirePoEditRole,
  assertCanViewPurchaseOrder,
  assertCanListPurchaseOrders,
  purchaseOrderListFilter,
  filterPurchaseOrdersForUser,
  poProjectId,
  resolvePoProjectId,
  HO_ROLES,
  PO_VIEW_ROLES,
};
