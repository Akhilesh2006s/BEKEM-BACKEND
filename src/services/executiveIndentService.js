const { UserRole } = require('@afios/shared');
const { MaterialRequest, Site, Project, User, PurchaseRequest } = require('../models');
const { generateIndentNumber } = require('./indentService');
const { generatePrNumber } = require('./documentNumberService');
const statusHistoryService = require('./statusHistoryService');
const notificationService = require('./notificationService');
const { computeIndentEstimatedValue } = require('./indentPricingService');
const { ensureRfqAndQuotations } = require('./procurementService');
const { getIndentLineItems } = require('./materialRequestHelpers');

const HO_ROLES = [UserRole.EXECUTIVE, UserRole.COORDINATOR, UserRole.CHAIRMAN];

function assertHoRole(user) {
  if (!HO_ROLES.includes(user.role)) {
    const err = new Error('Forbidden');
    err.statusCode = 403;
    throw err;
  }
}

async function resolveSiteForProject(projectId) {
  const site = await Site.findOne({ projectId }).sort({ createdAt: 1 });
  if (!site) {
    const err = new Error('No site found for project');
    err.statusCode = 400;
    throw err;
  }
  return site;
}

/**
 * Head-office indent (not site-raised). Only Coordinator may generate.
 * origin stays 'EXECUTIVE' so existing filters keep HO indents hidden from Site/Store/PM.
 */
async function createHoIndent(user, { projectId, items, purpose, requiredByDate }) {
  if (user.role !== UserRole.COORDINATOR) {
    const err = new Error('Only Coordinator can generate HO indents');
    err.statusCode = 403;
    throw err;
  }

  const project = await Project.findById(projectId);
  if (!project) {
    const err = new Error('Project not found');
    err.statusCode = 404;
    throw err;
  }

  const site = await resolveSiteForProject(projectId);
  const { resolveIndentLineItems } = require('./siteMaterialService');
  const resolvedItems = await resolveIndentLineItems(items, { createdByUserId: user._id });
  if (!resolvedItems.length) {
    const err = new Error('At least one material item is required');
    err.statusCode = 400;
    throw err;
  }

  const indentNumber = await generateIndentNumber(project.code);
  const mr = await MaterialRequest.create({
    indentNumber,
    projectId: project._id,
    siteId: site._id,
    items: resolvedItems,
    materialId: resolvedItems[0].materialId,
    quantityRequested: resolvedItems[0].quantityRequested,
    purpose: purpose || 'Coordinator HO indent',
    requiredByDate: requiredByDate || undefined,
    requestedByUserId: user._id,
    status: 'HO_PENDING_COORDINATOR',
    pendingWithRole: 'COORDINATOR',
    origin: 'EXECUTIVE',
    estimatedValue: 0,
  });

  mr.estimatedValue = await computeIndentEstimatedValue(mr);
  await mr.save();

  await statusHistoryService.record(
    'MaterialRequest',
    mr._id,
    null,
    'HO_PENDING_COORDINATOR',
    user._id,
    `Coordinator HO indent ${indentNumber} created`
  );

  // Coordinator is the HO raiser — generate PR + RFQ in the same step (no self-approval queue).
  return approveHoIndent(user, mr._id.toString());
}

/** @deprecated use createHoIndent */
async function createExecutiveIndent(user, body) {
  return createHoIndent(user, body);
}

async function approveHoIndent(user, indentId) {
  if (user.role !== UserRole.COORDINATOR) {
    const err = new Error('Only Coordinator can approve HO indents');
    err.statusCode = 403;
    throw err;
  }

  const mr = await MaterialRequest.findById(indentId).populate('projectId');
  if (!mr || mr.origin !== 'EXECUTIVE') {
    const err = new Error('HO indent not found');
    err.statusCode = 404;
    throw err;
  }
  if (mr.status !== 'HO_PENDING_COORDINATOR') {
    const err = new Error('Indent is not awaiting Coordinator approval');
    err.statusCode = 400;
    throw err;
  }

  const project = mr.projectId?._id ? mr.projectId : await Project.findById(mr.projectId);
  const projectCode = project?.code || 'PRJ';
  const estimate = mr.estimatedValue || (await computeIndentEstimatedValue(mr));

  let pr = await PurchaseRequest.findOne({ materialRequestId: mr._id });
  if (!pr) {
    const prNumber = await generatePrNumber(projectCode);
    pr = await PurchaseRequest.create({
      prNumber,
      materialRequestId: mr._id,
      projectId: project._id || mr.projectId,
      status: 'OPEN',
      createdByUserId: user._id,
      amountEstimate: estimate,
    });
    await statusHistoryService.record('PurchaseRequest', pr._id, null, 'OPEN', user._id, 'PR from HO indent');
  }

  const lineItems = getIndentLineItems(mr);
  const materialIds = lineItems.map((item) => (item.materialId?._id || item.materialId).toString());
  const { rfq } = await ensureRfqAndQuotations(pr, projectCode, user._id, materialIds);

  const fromStatus = mr.status;
  mr.status = 'RFQ_OPEN';
  mr.pendingWithRole = 'EXECUTIVE';
  await mr.save();

  await statusHistoryService.record(
    'MaterialRequest',
    mr._id,
    fromStatus,
    'RFQ_OPEN',
    user._id,
    `HO indent ready — RFQ ${rfq.rfqNumber} generated`
  );

  const executives = await User.find({ role: UserRole.EXECUTIVE });
  await notificationService.notifyUsers(
    executives.map((u) => u._id),
    {
      title: 'RFQ ready',
      body: `${rfq.rfqNumber} generated from ${mr.indentNumber}.`,
      relatedEntityType: 'RFQ',
      relatedEntityId: rfq._id,
    }
  );

  return { mr, pr, rfq };
}

/** @deprecated use approveHoIndent */
async function approveExecutiveIndent(user, indentId) {
  return approveHoIndent(user, indentId);
}

module.exports = {
  HO_ROLES,
  assertHoRole,
  createHoIndent,
  createExecutiveIndent,
  approveHoIndent,
  approveExecutiveIndent,
};
