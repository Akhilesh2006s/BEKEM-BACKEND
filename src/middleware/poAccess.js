const { UserRole } = require('@afios/shared');
const { userCanAccessProject } = require('../utils/serialize');
const { Site } = require('../models');

const HO_ROLES = new Set([UserRole.EXECUTIVE, UserRole.COORDINATOR, UserRole.CHAIRMAN]);

function poProjectId(po) {
  const pr = po.purchaseRequestId;
  if (!pr) return null;
  return pr.projectId?._id || pr.projectId || null;
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
  if (user.role === UserRole.SITE_INCHARGE) {
    const err = new Error('Purchase orders are not accessible to Site roles');
    err.statusCode = 403;
    throw err;
  }

  if (HO_ROLES.has(user.role)) return true;

  const projectId = poProjectId(po);
  if (!projectId) {
    const err = new Error('Forbidden — project out of scope');
    err.statusCode = 403;
    throw err;
  }

  if (user.role === UserRole.PROJECT_MANAGER) {
    if (!userCanAccessProject(user, projectId)) {
      const err = new Error('Forbidden — project out of scope');
      err.statusCode = 403;
      throw err;
    }
    if (!['APPROVED', 'PM_PENDING'].includes(po.status)) {
      const err = new Error('Project managers may only view approved POs or those pending PM approval');
      err.statusCode = 403;
      throw err;
    }
    return true;
  }

  if (user.role === UserRole.STORE_INCHARGE) {
    if (!userCanAccessProject(user, projectId)) {
      const err = new Error('Forbidden — project out of scope');
      err.statusCode = 403;
      throw err;
    }
    if (po.status !== 'APPROVED') {
      const err = new Error('Store managers may only view approved purchase orders');
      err.statusCode = 403;
      throw err;
    }
    return true;
  }

  const err = new Error('Forbidden');
  err.statusCode = 403;
  throw err;
}

function assertCanListPurchaseOrders(user, { queue } = {}) {
  if (user.role === UserRole.SITE_INCHARGE) {
    const err = new Error('Purchase orders are not accessible to Site roles');
    err.statusCode = 403;
    throw err;
  }
  if (user.role === UserRole.PROJECT_MANAGER && queue !== 'pm') {
    const err = new Error('Project managers may only list POs in the PM approval queue');
    err.statusCode = 403;
    throw err;
  }
  return true;
}

async function purchaseOrderListFilter(user, baseFilter = {}) {
  if (HO_ROLES.has(user.role)) return baseFilter;

  if (user.role === UserRole.PROJECT_MANAGER) {
    return {
      ...baseFilter,
      status: 'PM_PENDING',
    };
  }

  if (user.role === UserRole.STORE_INCHARGE) {
    const projectIds = user.assignedProjectIds || [];
    if (!projectIds.length) return { _id: null };
    const prIds = await require('../models').PurchaseRequest.find({
      projectId: { $in: projectIds },
    }).distinct('_id');
    return {
      ...baseFilter,
      purchaseRequestId: { $in: prIds },
      status: baseFilter.status || 'APPROVED',
    };
  }

  return { _id: null };
}

async function filterPurchaseOrdersForUser(user, orders) {
  if (HO_ROLES.has(user.role)) return orders;

  if (user.role === UserRole.PROJECT_MANAGER) {
    return orders.filter((po) => userCanAccessProject(user, poProjectId(po)));
  }

  if (user.role === UserRole.STORE_INCHARGE) {
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
  HO_ROLES,
};
