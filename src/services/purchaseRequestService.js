const { UserRole } = require('@afios/shared');
const { PurchaseRequest, MaterialRequest, User } = require('../models');
const { generatePrNumber } = require('./documentNumberService');
const statusHistoryService = require('./statusHistoryService');
const notificationService = require('./notificationService');
const { notifyExecutivesForIndent } = require('./executiveRoutingService');
const { computeIndentEstimatedValue } = require('./indentPricingService');

async function estimateIndentAmount(mr) {
  return computeIndentEstimatedValue(mr);
}

async function createPurchaseRequestForIndent(mr, actorUserId, amountEstimate, historyNote, options = {}) {
  const { session, deferNotification } = options;
  const existing = await PurchaseRequest.findOne({ materialRequestId: mr._id }).session(session || null);
  if (existing) {
    // Coordinator local-close (and similar) must still move the indent + write history
    // so the daily approval bar / cap consume this action even when a PR already exists.
    const terminalMr = new Set([
      'PURCHASE_REQUESTED',
      'PO_CREATED',
      'ALLOCATED',
      'PARTIALLY_ISSUED',
      'ISSUED',
      'COMPLETED',
      'CLOSED',
      'CANCELLED',
      'REJECTED',
    ]);
    if (!terminalMr.has(mr.status)) {
      const fromStatus = mr.status;
      mr.status = 'PURCHASE_REQUESTED';
      mr.pendingWithRole = 'EXECUTIVE';
      await mr.save(session ? { session } : {});
      await statusHistoryService.record(
        'MaterialRequest',
        mr._id,
        fromStatus,
        'PURCHASE_REQUESTED',
        actorUserId,
        historyNote || `PR ${existing.prNumber} confirmed`,
        { session }
      );
    }
    if (!['PO_CREATED', 'CANCELLED', 'CLOSED'].includes(existing.status) && existing.status !== 'OPEN') {
      existing.status = 'OPEN';
      await existing.save(session ? { session } : {});
    }
    return existing;
  }

  const project = mr.projectId?.code ? mr.projectId : await require('../models').Project.findById(mr.projectId?._id || mr.projectId).session(session || null);
  const projectCode = project?.code || 'PRJ';
  const prNumber = await generatePrNumber(projectCode, session);
  const estimate = amountEstimate ?? (await estimateIndentAmount(mr));

  const prData = {
    prNumber,
    materialRequestId: mr._id,
    projectId: project._id || mr.projectId,
    status: 'OPEN',
    createdByUserId: actorUserId,
    amountEstimate: estimate,
  };
  const pr = session ? (await PurchaseRequest.create([prData], { session }))[0] : await PurchaseRequest.create(prData);

  const fromStatus = mr.status;
  mr.status = 'PURCHASE_REQUESTED';
  mr.pendingWithRole = 'EXECUTIVE';
  await mr.save(session ? { session } : {});

  await statusHistoryService.record('PurchaseRequest', pr._id, null, 'OPEN', actorUserId, 'PR created', { session });
  await statusHistoryService.record(
    'MaterialRequest',
    mr._id,
    fromStatus,
    'PURCHASE_REQUESTED',
    actorUserId,
    historyNote || `PR ${prNumber} created`,
    { session }
  );

  if (!deferNotification) await notifyExecutivesForIndent(mr.indentCategoryId, notificationService, {
    title: 'New purchase request',
    body: `${prNumber} is in your Pending Purchase Requests queue.`,
    relatedEntityType: 'PurchaseRequest',
    relatedEntityId: pr._id,
  });

  return pr;
}

/**
 * Executive marks "Proceed with Purchase Order" — queues OPEN PR for Create PO wizard.
 * Does not create a PO or notify coordinators.
 */
async function openPurchaseRequestForExecutivePo(mr, executiveUserId, remark) {
  const existing = await PurchaseRequest.findOne({ materialRequestId: mr._id });
  if (existing) {
    if (existing.status === 'OPEN' && !existing.executiveRecommendation) {
      existing.executiveRecommendation = 'PURCHASE_ORDER';
      existing.executiveRecommendationRemark = remark || '';
      existing.executiveRecommendedByUserId = executiveUserId;
      existing.executiveRecommendedAt = new Date();
      await existing.save();
    }
    return existing;
  }

  const project = mr.projectId?._id ? mr.projectId : await require('../models').Project.findById(mr.projectId);
  const projectCode = project?.code || 'PRJ';
  const prNumber = await generatePrNumber(projectCode);
  const estimate = await estimateIndentAmount(mr);

  const pr = await PurchaseRequest.create({
    prNumber,
    materialRequestId: mr._id,
    projectId: project._id || mr.projectId,
    status: 'OPEN',
    createdByUserId: executiveUserId,
    amountEstimate: estimate,
    executiveRecommendation: 'PURCHASE_ORDER',
    executiveRecommendationRemark: remark || '',
    executiveRecommendedByUserId: executiveUserId,
    executiveRecommendedAt: new Date(),
  });

  const fromStatus = mr.status;
  mr.status = 'PURCHASE_REQUESTED';
  mr.pendingWithRole = 'EXECUTIVE';
  mr.executiveProcurementMethod = 'PURCHASE_ORDER';
  mr.executiveDecisionRemark = remark || '';
  mr.executiveDecidedByUserId = executiveUserId;
  mr.executiveDecidedAt = new Date();
  await mr.save();

  await statusHistoryService.record(
    'PurchaseRequest',
    pr._id,
    null,
    'OPEN',
    executiveUserId,
    'Queued for Create PO — executive marked proceed with purchase order'
  );
  await statusHistoryService.record(
    'MaterialRequest',
    mr._id,
    fromStatus,
    'PURCHASE_REQUESTED',
    executiveUserId,
    `Proceed with Purchase Order: ${remark || '—'}`
  );

  return pr;
}

module.exports = {
  createPurchaseRequestForIndent,
  openPurchaseRequestForExecutivePo,
  estimateIndentAmount,
};
