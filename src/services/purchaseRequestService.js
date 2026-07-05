const { UserRole } = require('@afios/shared');
const { PurchaseRequest, MaterialRequest, User } = require('../models');
const { generatePrNumber } = require('./documentNumberService');
const statusHistoryService = require('./statusHistoryService');
const notificationService = require('./notificationService');
const { getIndentLineItems } = require('./materialRequestHelpers');

function estimateIndentAmount(mr) {
  const items = getIndentLineItems(mr);
  if (!items.length) {
    return (mr.quantityRequested || 1) * 5000;
  }
  return items.reduce((sum, item) => sum + (item.quantityRequested || 1) * 5000, 0);
}

async function createPurchaseRequestForIndent(mr, actorUserId, amountEstimate, historyNote) {
  const existing = await PurchaseRequest.findOne({ materialRequestId: mr._id });
  if (existing) return existing;

  const project = mr.projectId?._id ? mr.projectId : await require('../models').Project.findById(mr.projectId);
  const projectCode = project?.code || 'PRJ';
  const prNumber = await generatePrNumber(projectCode);
  const estimate = amountEstimate ?? estimateIndentAmount(mr);

  const pr = await PurchaseRequest.create({
    prNumber,
    materialRequestId: mr._id,
    projectId: project._id || mr.projectId,
    status: 'OPEN',
    createdByUserId: actorUserId,
    amountEstimate: estimate,
  });

  const fromStatus = mr.status;
  mr.status = 'PURCHASE_REQUESTED';
  mr.pendingWithRole = 'EXECUTIVE';
  await mr.save();

  await statusHistoryService.record('PurchaseRequest', pr._id, null, 'OPEN', actorUserId, 'PR created');
  await statusHistoryService.record(
    'MaterialRequest',
    mr._id,
    fromStatus,
    'PURCHASE_REQUESTED',
    actorUserId,
    historyNote || `PR ${prNumber} created`
  );

  const executives = await User.find({ role: UserRole.EXECUTIVE });
  await notificationService.notifyUsers(
    executives.map((u) => u._id),
    {
      title: 'New purchase request',
      body: `${prNumber} is in your Pending Purchase Requests queue.`,
      relatedEntityType: 'PurchaseRequest',
      relatedEntityId: pr._id,
    }
  );

  return pr;
}

module.exports = { createPurchaseRequestForIndent, estimateIndentAmount };
