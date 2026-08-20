const { UserRole } = require('@afios/shared');
const { User } = require('../models');
const { getIndentLineItems } = require('./materialRequestHelpers');
const { enrichIndentWithStock } = require('./indentStockService');
const { allocateIndentStock } = require('./indentAllocationService');
const statusHistoryService = require('./statusHistoryService');
const notificationService = require('./notificationService');

const CLOSED = new Set([
  'ALLOCATED',
  'ISSUED',
  'COMPLETED',
  'CLOSED',
  'REJECTED',
  'CANCELLED',
]);

function isIndentAwaitingPmAllocation(mr, poStatus) {
  if (!mr || mr.pmProceededAllocation || CLOSED.has(mr.status)) return false;
  if (mr.status === 'CHAIRMAN_APPROVED') return true;
  return poStatus === 'APPROVED';
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

async function pmProceedWithAllocation(mr, actorUserId, remark) {
  const fromStatus = mr.status;
  const stockContext = await enrichIndentWithStock(mr);
  let allocatedFromStock = false;

  if (stockContext.canFullyIssue) {
    await allocateIndentStock(mr, actorUserId);
    allocatedFromStock = true;
  } else {
    for (const item of getIndentLineItems(mr)) {
      item.quantityAllocated = item.quantityRequested;
    }
  }

  mr.pmProceededAllocation = true;
  mr.pmForwardRemark = remark;
  mr.pendingWithRole = 'STORE_INCHARGE';
  if (allocatedFromStock) {
    mr.status = 'ALLOCATED';
  }
  await mr.save();

  await statusHistoryService.record(
    'MaterialRequest',
    mr._id,
    fromStatus,
    mr.status,
    actorUserId,
    allocatedFromStock
      ? `PM proceeded with allocation (stock reserved): ${remark}`
      : `PM proceeded with allocation after Executive / Chairman approval: ${remark}`
  );

  const storeUsers = await User.find({
    role: UserRole.STORE_INCHARGE,
    assignedSiteId: mr.siteId,
  });
  await notificationService.notifyUsers(
    storeUsers.map((u) => u._id),
    {
      title: allocatedFromStock
        ? 'Indent allocated by PM — ready to issue'
        : 'PM proceeded with allocation — awaiting receipt',
      body: allocatedFromStock
        ? `${mr.indentNumber} — stock reserved; issue material.`
        : `${mr.indentNumber} — PO approved; issue after GRN / stock receipt.`,
      relatedEntityType: 'MaterialRequest',
      relatedEntityId: mr._id,
    }
  );

  await notificationService.notifyUser(mr.requestedByUserId, {
    title: 'PM proceeded with allocation',
    body: allocatedFromStock
      ? `Your request ${mr.indentNumber} was allocated by the Project Manager — stock reserved for issue.`
      : `Your request ${mr.indentNumber} was approved for allocation by the Project Manager.`,
    relatedEntityType: 'MaterialRequest',
    relatedEntityId: mr._id,
  });

  return mr;
}

module.exports = {
  isIndentAwaitingPmAllocation,
  notifyProjectManagers,
  pmProceedWithAllocation,
};
