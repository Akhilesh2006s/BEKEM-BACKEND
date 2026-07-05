const { UserRole } = require('@afios/shared');
const { PurchaseRequest, User, MaterialRequest } = require('../models');
const statusHistoryService = require('./statusHistoryService');
const notificationService = require('./notificationService');

async function executiveDecidePurchaseRequest(pr, user, { method, remark }) {
  if (user.role !== UserRole.EXECUTIVE) {
    const err = new Error('Only Executive can record procurement recommendation');
    err.statusCode = 403;
    throw err;
  }
  if (pr.status !== 'OPEN') {
    const err = new Error('Purchase request is not open for executive decision');
    err.statusCode = 400;
    throw err;
  }
  if (!['PURCHASE_ORDER', 'BRANCH_TRANSFER'].includes(method)) {
    const err = new Error('Procurement method must be PURCHASE_ORDER or BRANCH_TRANSFER');
    err.statusCode = 400;
    throw err;
  }

  pr.executiveRecommendation = method;
  pr.executiveRecommendationRemark = remark || '';
  pr.executiveRecommendedByUserId = user._id;
  pr.executiveRecommendedAt = new Date();

  if (method === 'BRANCH_TRANSFER') {
    pr.status = 'BRANCH_TRANSFER_RECOMMENDED';
    const mr = pr.materialRequestId?._id
      ? pr.materialRequestId
      : await MaterialRequest.findById(pr.materialRequestId);
    if (mr) {
      mr.pendingWithRole = 'COORDINATOR';
      await mr.save();
    }
  }

  await pr.save();

  await statusHistoryService.record(
    'PurchaseRequest',
    pr._id,
    'OPEN',
    method === 'BRANCH_TRANSFER' ? 'BRANCH_TRANSFER_RECOMMENDED' : 'OPEN',
    user._id,
    method === 'BRANCH_TRANSFER'
      ? `Executive recommended branch transfer: ${remark || '—'}`
      : `Executive recommended purchase order: ${remark || '—'}`
  );

  if (method === 'BRANCH_TRANSFER') {
    const coordinators = await User.find({ role: UserRole.COORDINATOR });
    const mrId = pr.materialRequestId?._id || pr.materialRequestId;
    await notificationService.notifyUsers(
      coordinators.map((u) => u._id),
      {
        title: 'Branch transfer recommended',
        body: `${pr.prNumber} — executive recommends branch transfer.`,
        relatedEntityType: 'ProcurementDecision',
        relatedEntityId: mrId,
      }
    );
  }

  return pr;
}

module.exports = { executiveDecidePurchaseRequest };
