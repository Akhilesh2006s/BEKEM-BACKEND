const { UserRole } = require('@afios/shared');
const { User } = require('../models');
const { getIndentLineItems } = require('./materialRequestHelpers');
const { enrichIndentWithStock } = require('./indentStockService');
const { allocateIndentStock } = require('./indentAllocationService');
const statusHistoryService = require('./statusHistoryService');
const notificationService = require('./notificationService');
const { notifyExecutivesForIndent } = require('./executiveRoutingService');

const STAGES = {
  EXECUTIVE: 'EXECUTIVE',
  PROJECT_MANAGER: 'PROJECT_MANAGER',
  STORE_INCHARGE: 'STORE_INCHARGE',
  SITE_INCHARGE: 'SITE_INCHARGE',
};

const CLOSED = new Set(['COMPLETED', 'CLOSED', 'REJECTED', 'CANCELLED']);
const ACTIVE_STAGES = new Set([
  STAGES.EXECUTIVE,
  STAGES.PROJECT_MANAGER,
  STAGES.STORE_INCHARGE,
]);

function startAllocationReview(mr) {
  mr.allocationReviewStage = STAGES.EXECUTIVE;
  mr.pendingWithRole = UserRole.EXECUTIVE;
  mr.pmProceededAllocation = false;
  return mr;
}

function resolveAllocationReviewStage(mr, poStatus) {
  if (!mr || CLOSED.has(mr.status)) return null;
  if (mr.status === 'ISSUED' || mr.allocationReviewStage === STAGES.SITE_INCHARGE) {
    return STAGES.SITE_INCHARGE;
  }
  if (mr.allocationReviewStage && ACTIVE_STAGES.has(mr.allocationReviewStage)) {
    return mr.allocationReviewStage;
  }
  const poApproved = mr.status === 'CHAIRMAN_APPROVED' || poStatus === 'APPROVED';
  if (!poApproved) return null;
  if (mr.pmProceededAllocation) return STAGES.STORE_INCHARGE;
  return STAGES.EXECUTIVE;
}

function isInAllocationReview(mr, poStatus) {
  return ACTIVE_STAGES.has(resolveAllocationReviewStage(mr, poStatus));
}

async function notifyProjectManagers(mr, { title, body }) {
  const pmUsers = await User.find({
    role: UserRole.PROJECT_MANAGER,
    assignedProjectIds: mr.projectId,
  });
  await notificationService.notifyUsers(
    pmUsers.map((u) => u._id),
    {
      title,
      body,
      relatedEntityType: 'MaterialRequest',
      relatedEntityId: mr._id,
    }
  );
}

async function notifyStore(mr, { title, body }) {
  const storeUsers = await User.find({
    role: UserRole.STORE_INCHARGE,
    assignedSiteId: mr.siteId,
  });
  await notificationService.notifyUsers(
    storeUsers.map((u) => u._id),
    {
      title,
      body,
      relatedEntityType: 'MaterialRequest',
      relatedEntityId: mr._id,
    }
  );
}

async function notifyExecutives(mr, { title, body }) {
  await notifyExecutivesForIndent(mr.indentCategoryId, notificationService, {
    title,
    body,
    relatedEntityType: 'MaterialRequest',
    relatedEntityId: mr._id,
  });
}

const STORE_ISSUE_STATUSES = new Set(['MATERIAL_RECEIVED', 'ALLOCATED']);

function storeCanIssueToRaiser(mr) {
  return STORE_ISSUE_STATUSES.has(mr?.status);
}

async function issueToIndentRaiser(mr, actor, remark) {
  const fromStatus = mr.status;
  for (const item of getIndentLineItems(mr)) {
    const qty = item.quantityAllocated || item.quantityRequested;
    item.quantityAllocated = qty;
    item.quantityIssued = qty;
  }
  if (mr.quantityRequested) {
    mr.quantityAllocated = mr.quantityAllocated || mr.quantityRequested;
    mr.quantityIssued = mr.quantityRequested;
  }
  mr.status = 'ISSUED';
  mr.allocationReviewStage = STAGES.SITE_INCHARGE;
  mr.pendingWithRole = UserRole.SITE_INCHARGE;
  mr.pmForwardRemark = remark;
  await mr.save();
  await statusHistoryService.record(
    'MaterialRequest',
    mr._id,
    fromStatus,
    'ISSUED',
    actor._id,
    `Store proceeded with allocation — issued to indent raiser: ${remark}`
  );
  await notificationService.notifyUser(mr.requestedByUserId, {
    title: 'Collect & verify materials',
    body: `${mr.indentNumber} has been allocated. Collect and verify the materials.`,
    relatedEntityType: 'MaterialRequest',
    relatedEntityId: mr._id,
  });
  return mr;
}

async function proceedWithAllocation(mr, actor, remark, poStatus) {
  const role = actor.role;

  if (role === UserRole.STORE_INCHARGE) {
    if (!storeCanIssueToRaiser(mr)) {
      const err = new Error(
        'Indent is not ready to allocate. Record Stock Received in Material GRN, or close against available store stock first.'
      );
      err.statusCode = 400;
      throw err;
    }
    return issueToIndentRaiser(mr, actor, remark);
  }

  const stage = resolveAllocationReviewStage(mr, poStatus);
  if (!ACTIVE_STAGES.has(stage)) {
    const err = new Error('Indent is not in the allocation review chain');
    err.statusCode = 400;
    throw err;
  }
  if (role !== stage) {
    const err = new Error(`Awaiting ${stage.replace(/_/g, ' ').toLowerCase()} to proceed with allocation`);
    err.statusCode = 400;
    throw err;
  }

  mr.allocationReviewStage = stage;
  const fromStatus = mr.status;

  if (role === UserRole.EXECUTIVE) {
    mr.allocationReviewStage = STAGES.PROJECT_MANAGER;
    mr.pendingWithRole = UserRole.PROJECT_MANAGER;
    await mr.save();
    await statusHistoryService.record(
      'MaterialRequest',
      mr._id,
      fromStatus,
      mr.status,
      actor._id,
      `Executive proceeded with allocation: ${remark}`
    );
    await notifyProjectManagers(mr, {
      title: 'Final review',
      body: `${mr.indentNumber} — Executive proceeded with allocation. Open Final review, then Proceed with Allocation.`,
    });
    return mr;
  }

  if (role === UserRole.PROJECT_MANAGER) {
    const stockContext = await enrichIndentWithStock(mr);
    if (stockContext.canFullyIssue) {
      await allocateIndentStock(mr, actor._id);
      mr.status = 'ALLOCATED';
    } else {
      for (const item of getIndentLineItems(mr)) {
        item.quantityAllocated = item.quantityRequested;
      }
    }
    mr.pmProceededAllocation = true;
    mr.pmForwardRemark = remark;
    mr.allocationReviewStage = STAGES.STORE_INCHARGE;
    mr.pendingWithRole = UserRole.STORE_INCHARGE;
    await mr.save();
    await statusHistoryService.record(
      'MaterialRequest',
      mr._id,
      fromStatus,
      mr.status,
      actor._id,
      `PM proceeded with allocation: ${remark}`
    );
    await notifyStore(mr, {
      title: 'Final review',
      body: `${mr.indentNumber} — PM proceeded with allocation. Open Final review, then Proceed with Allocation.`,
    });
    return mr;
  }

  const err = new Error('This role cannot proceed with allocation');
  err.statusCode = 403;
  throw err;
}

/** @deprecated Use proceedWithAllocation */
async function pmProceedWithAllocation(mr, actorUserId, remark, poStatus = 'APPROVED') {
  return proceedWithAllocation(
    mr,
    { _id: actorUserId, role: UserRole.PROJECT_MANAGER },
    remark,
    poStatus
  );
}

function isIndentAwaitingPmAllocation(mr, poStatus) {
  return resolveAllocationReviewStage(mr, poStatus) === STAGES.PROJECT_MANAGER;
}

module.exports = {
  STAGES,
  startAllocationReview,
  resolveAllocationReviewStage,
  isInAllocationReview,
  isIndentAwaitingPmAllocation,
  notifyProjectManagers,
  notifyExecutives,
  notifyStore,
  proceedWithAllocation,
  pmProceedWithAllocation,
  storeCanIssueToRaiser,
};
