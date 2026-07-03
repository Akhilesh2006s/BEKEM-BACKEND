const {
  WorkOrder,
  PurchaseOrder,
  PurchaseRequest,
  Site,
  StockLedger,
  StockMovement,
  Material,
  User,
} = require('../models');
const { UserRole } = require('@afios/shared');
const { generateWoNumber } = require('./documentNumberService');
const statusHistoryService = require('./statusHistoryService');
const notificationService = require('./notificationService');

function calcProgress(completed, total) {
  if (!total) return 0;
  return Math.min(100, Math.round((completed / total) * 100));
}

async function createFromPurchaseOrder({ purchaseOrderId, scope, totalQuantity, quantityUnit, siteId, actorUserId }) {
  const po = await PurchaseOrder.findById(purchaseOrderId).populate({
    path: 'purchaseRequestId',
    populate: { path: 'projectId' },
  });
  if (!po) throw Object.assign(new Error('Purchase order not found'), { statusCode: 404 });
  if (po.status !== 'APPROVED') {
    throw Object.assign(new Error('Purchase order must be approved before creating a work order'), {
      statusCode: 400,
    });
  }

  const existing = await WorkOrder.findOne({ purchaseOrderId: po._id });
  if (existing) {
    throw Object.assign(new Error('A work order already exists for this purchase order'), { statusCode: 400 });
  }

  const pr = po.purchaseRequestId;
  const project = pr?.projectId;
  if (!project) throw Object.assign(new Error('Project not found for purchase order'), { statusCode: 400 });

  let resolvedSiteId = siteId;
  if (!resolvedSiteId) {
    const site = await Site.findOne({ projectId: project._id });
    resolvedSiteId = site?._id;
  }

  const woNumber = await generateWoNumber(project.code);
  const wo = await WorkOrder.create({
    woNumber,
    purchaseOrderId: po._id,
    projectId: project._id,
    siteId: resolvedSiteId,
    vendorId: po.vendorId,
    scope,
    totalQuantity,
    quantityUnit: quantityUnit || 'Units',
    contractValue: po.amount,
    status: 'COORDINATOR_PENDING',
    createdByUserId: actorUserId,
  });

  await statusHistoryService.record(
    'WorkOrder',
    wo._id,
    null,
    'COORDINATOR_PENDING',
    actorUserId,
    `Work order ${woNumber} created from PO ${po.poNumber}`
  );

  const coordinators = await User.find({ role: UserRole.COORDINATOR });
  for (const c of coordinators) {
    await notificationService.notifyUser(c._id, {
      title: 'Work order pending verification',
      body: `${woNumber} requires coordinator verification.`,
      relatedEntityType: 'WorkOrder',
      relatedEntityId: wo._id,
    });
  }

  return wo;
}

async function issueMaterial({ workOrderId, materialId, quantity, actorUserId, siteId }) {
  const wo = await WorkOrder.findById(workOrderId);
  if (!wo) throw Object.assign(new Error('Work order not found'), { statusCode: 404 });
  if (!['ACCEPTED', 'IN_PROGRESS'].includes(wo.status)) {
    throw Object.assign(new Error('Materials can only be issued after contractor acceptance'), {
      statusCode: 400,
    });
  }

  const resolvedSiteId = siteId || wo.siteId;
  if (!resolvedSiteId) throw Object.assign(new Error('Site not assigned to work order'), { statusCode: 400 });

  const material = await Material.findById(materialId);
  if (!material) throw Object.assign(new Error('Material not found'), { statusCode: 404 });

  const ledger = await StockLedger.findOne({ siteId: resolvedSiteId, materialId });
  if (!ledger || ledger.quantityOnHand < quantity) {
    throw Object.assign(new Error('Insufficient stock for this material'), { statusCode: 400 });
  }

  ledger.quantityOnHand -= quantity;
  ledger.lastMovementAt = new Date();
  await ledger.save();

  await StockMovement.create({
    siteId: resolvedSiteId,
    materialId,
    quantityDelta: -quantity,
    type: 'ALLOCATION',
    actorUserId,
  });

  wo.materialIssues.push({
    materialId,
    materialName: material.name,
    materialUnit: material.unit,
    quantity,
    issuedByUserId: actorUserId,
  });

  if (wo.status === 'ACCEPTED') {
    const from = wo.status;
    wo.status = 'IN_PROGRESS';
    await statusHistoryService.record('WorkOrder', wo._id, from, 'IN_PROGRESS', actorUserId, 'Execution started');
  }

  await wo.save();
  return wo;
}

async function updateProgress({ workOrderId, completedQuantity, milestones, actorUserId }) {
  const wo = await WorkOrder.findById(workOrderId);
  if (!wo) throw Object.assign(new Error('Work order not found'), { statusCode: 404 });
  if (!['ACCEPTED', 'IN_PROGRESS'].includes(wo.status)) {
    throw Object.assign(new Error('Progress can only be updated during execution'), { statusCode: 400 });
  }

  if (typeof completedQuantity === 'number') {
    wo.completedQuantity = Math.min(completedQuantity, wo.totalQuantity);
    wo.progressPercent = calcProgress(wo.completedQuantity, wo.totalQuantity);
  }

  if (milestones?.length) {
    for (const update of milestones) {
      const ms = wo.milestones.id(update.id);
      if (ms && ['PENDING', 'RUNNING', 'COMPLETED'].includes(update.status)) {
        ms.status = update.status;
      }
    }
  }

  if (wo.status === 'ACCEPTED') {
    wo.status = 'IN_PROGRESS';
    await statusHistoryService.record('WorkOrder', wo._id, 'ACCEPTED', 'IN_PROGRESS', actorUserId, 'Progress updated');
  }

  await wo.save();
  return wo;
}

async function certifyWork({ workOrderId, quantity, note, evidenceNote, actorUserId }) {
  const wo = await WorkOrder.findById(workOrderId);
  if (!wo) throw Object.assign(new Error('Work order not found'), { statusCode: 404 });
  if (!['ACCEPTED', 'IN_PROGRESS'].includes(wo.status)) {
    throw Object.assign(new Error('Work can only be certified during execution'), { statusCode: 400 });
  }

  wo.certifications.push({
    quantity,
    note,
    evidenceNote: evidenceNote || '',
    certifiedByUserId: actorUserId,
    status: 'PENDING_PM',
  });
  await wo.save();

  const pms = await User.find({
    role: UserRole.PROJECT_MANAGER,
    assignedProjectIds: wo.projectId,
  });
  for (const pm of pms) {
    await notificationService.notifyUser(pm._id, {
      title: 'Work certification pending',
      body: `${wo.woNumber}: ${quantity} ${wo.quantityUnit} certified by site — verify.`,
      relatedEntityType: 'WorkOrder',
      relatedEntityId: wo._id,
    });
  }

  return wo;
}

async function verifyCertification({ workOrderId, certificationId, action, pmNote, actorUserId }) {
  const wo = await WorkOrder.findById(workOrderId);
  if (!wo) throw Object.assign(new Error('Work order not found'), { statusCode: 404 });

  const cert = wo.certifications.id(certificationId);
  if (!cert) throw Object.assign(new Error('Certification not found'), { statusCode: 404 });
  if (cert.status !== 'PENDING_PM') {
    throw Object.assign(new Error('Certification already processed'), { statusCode: 400 });
  }

  if (action === 'VERIFY') {
    cert.status = 'PM_VERIFIED';
    cert.pmVerifiedByUserId = actorUserId;
    cert.pmNote = pmNote || '';
    wo.completedQuantity = Math.min(wo.completedQuantity + cert.quantity, wo.totalQuantity);
    wo.progressPercent = calcProgress(wo.completedQuantity, wo.totalQuantity);
    if (wo.status === 'ACCEPTED') wo.status = 'IN_PROGRESS';
  } else {
    cert.status = 'REJECTED';
    cert.pmVerifiedByUserId = actorUserId;
    cert.pmNote = pmNote || 'Rejected';
  }

  await wo.save();
  return wo;
}

module.exports = {
  createFromPurchaseOrder,
  issueMaterial,
  updateProgress,
  certifyWork,
  verifyCertification,
  calcProgress,
};
