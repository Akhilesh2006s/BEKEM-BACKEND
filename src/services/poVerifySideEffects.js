const statusHistoryService = require('./statusHistoryService');
const notificationService = require('./notificationService');
const { UserRole } = require('@afios/shared');
const { User, PurchaseRequest, Vendor } = require('../models');
const { sendPoToVendor } = require('./emailService');
const { generatePurchaseOrderPdfBuffer } = require('./pdfService');
const delegationService = require('./delegationService');
const { assignOfficialProcurementNumbers } = require('./procurementReferenceService');
const { recordPoSent } = require('./poTimelineService');
const {
  requiresChairmanApproval,
  requiresCoordinatorFinalApproval,
  requiresPmApproval,
} = require('../constants/approvalPolicy');

const PO_ALERT_ROLES = [
  UserRole.EXECUTIVE,
  UserRole.COORDINATOR,
  UserRole.CHAIRMAN,
  UserRole.STORE_INCHARGE,
];

async function runSideEffect(label, fn) {
  try {
    await fn();
  } catch (err) {
    console.error(`${label} failed:`, err.message);
  }
}

async function notifyChairmen(po) {
  const chairmen = await User.find({ role: UserRole.CHAIRMAN });
  const delegateIds = await delegationService.getPoFinalDelegateUserIds();
  const recipientIds = [...chairmen.map((u) => u._id), ...delegateIds];
  const unique = [...new Set(recipientIds.map((id) => id.toString()))];
  await notificationService.notifyUsers(unique, {
    title: 'PO awaiting approval',
    body: `${po.poNumber || po.draftRef} requires chairman final approval.`,
    relatedEntityType: 'PurchaseOrder',
    relatedEntityId: po._id,
  });
}

async function notifyExecutivesReturned(po) {
  const executives = await User.find({ role: UserRole.EXECUTIVE });
  await notificationService.notifyUsers(
    executives.map((u) => u._id),
    {
      title: 'PO returned',
      body: `${po.poNumber || po.draftRef} returned for revision.`,
      relatedEntityType: 'PurchaseOrder',
      relatedEntityId: po._id,
    }
  );
}

async function notifyPoApprovedInternal(po) {
  const users = await User.find({ role: { $in: PO_ALERT_ROLES } });
  const poNo = po.poNumber || po.draftRef || 'PO';
  const overrideTag = po.approvedAsChairmanOverride
    ? ' (approved in Chairman\'s absence)'
    : '';
  await notificationService.notifyUsers(
    users.map((u) => u._id),
    {
      title: 'Purchase order approved',
      body: `${poNo} has been approved${overrideTag}. View the official PO.`,
      relatedEntityType: 'PurchaseOrder',
      relatedEntityId: po._id,
    }
  );
}

async function dispatchVendorEmail(po, vendor) {
  if (!vendor?.email) {
    po.emailStatus = 'skipped';
    po.emailSentAt = null;
    return;
  }
  const populated = await Vendor.findById(vendor._id);
  let pdfBuffer;
  try {
    pdfBuffer = await generatePurchaseOrderPdfBuffer(po);
  } catch (err) {
    console.error('[PO PDF generation]', err.message);
    po.emailStatus = 'failed';
    return;
  }

  try {
    const result = await sendPoToVendor(po, populated || vendor, { pdfBuffer });
    if (result.sent && result.mode === 'smtp') {
      po.emailSentAt = new Date();
      po.sentToVendorAt = po.emailSentAt;
      po.emailStatus = 'sent';
    } else if (result.sent && result.mode === 'log') {
      po.emailStatus = 'queued';
      po.emailSentAt = null;
    } else {
      po.emailStatus = 'skipped';
    }
  } catch (err) {
    console.error('[PO email dispatch]', err.message);
    po.emailStatus = 'failed';
  }
}

async function runPostApprovalDispatch(po) {
  if (po.approvalDispatchedAt && po.emailStatus && po.emailStatus !== 'pending') return po;

  await notifyPoApprovedInternal(po);

  const vendor = await Vendor.findById(po.vendorId);
  await dispatchVendorEmail(po, vendor);

  if (!po.approvalDispatchedAt) {
    po.approvalDispatchedAt = new Date();
  }
  await po.save();
  if (po.emailStatus === 'sent') {
    await recordPoSent(po._id, null);
  }
  return po;
}

/**
 * Coordinator verify:
 * - < ₹5k should be PM (reject if wrongly here)
 * - ₹5k–₹10k → final approve
 * - > ₹10k → Chairman queue
 */
async function coordinatorVerifyPurchaseOrder(po, actorUserId, note) {
  if (requiresPmApproval(po.amount)) {
    const err = new Error('POs under ₹5,000 must be approved by the Project Manager');
    err.statusCode = 400;
    throw err;
  }

  if (requiresCoordinatorFinalApproval(po.amount)) {
    return finalizePurchaseOrder(
      po,
      actorUserId,
      note || 'Coordinator approved (₹5,000–₹10,000 band)',
      null,
      { chairmanOverride: false }
    );
  }

  const fromStatus = po.status;
  po.status = 'CHAIRMAN_PENDING';
  await po.save();
  await statusHistoryService.record(
    'PurchaseOrder',
    po._id,
    fromStatus,
    'CHAIRMAN_PENDING',
    actorUserId,
    note || 'Coordinator verified — forwarded to Chairman (above ₹10,000)'
  );
  await notifyChairmen(po);
  return po;
}

async function coordinatorOverrideApprove(po, actorUserId, remark) {
  const text = String(remark || '').trim();
  if (text.length < 1 || text.length > 300) {
    const err = new Error('Override remark must be between 1 and 300 characters');
    err.statusCode = 400;
    throw err;
  }
  if (po.status !== 'CHAIRMAN_PENDING') {
    const err = new Error('PO is not awaiting Chairman approval');
    err.statusCode = 400;
    throw err;
  }
  return finalizePurchaseOrder(po, actorUserId, 'Coordinator override approval', null, {
    chairmanOverride: true,
    overrideRemark: text,
  });
}

async function pmApprovePurchaseOrder(po, actorUserId, note) {
  if (!requiresPmApproval(po.amount)) {
    const err = new Error('Only POs under ₹5,000 can be approved by Project Manager');
    err.statusCode = 400;
    throw err;
  }
  if (po.status !== 'PM_PENDING') {
    const err = new Error('PO is not pending Project Manager approval');
    err.statusCode = 400;
    throw err;
  }
  return finalizePurchaseOrder(
    po,
    actorUserId,
    note || 'Project Manager approved (under ₹5,000)',
    null,
    { chairmanOverride: false }
  );
}

async function finalizePurchaseOrder(po, actorUserId, note, approvalContext, options = {}) {
  if (po.status === 'APPROVED') {
    await runPostApprovalDispatch(po);
    return po;
  }

  const fromStatus = po.status;
  po.status = 'APPROVED';
  po.approvedByUserId = actorUserId;
  po.finalApprovedAt = new Date();
  po.approvedAsChairmanOverride = !!options.chairmanOverride;
  po.overrideRemark = options.chairmanOverride ? String(options.overrideRemark || '').trim() : '';

  if (!po.poNumber) {
    const pr = await PurchaseRequest.findById(po.purchaseRequestId).populate('projectId');
    const { projectShortCode, vendorShortCode } = require('./codeGenerators');
    const projectCode = pr?.projectId?.code || projectShortCode(pr?.projectId?.name) || 'PRJ';
    const vendor = await Vendor.findById(po.vendorId);
    const vendorCode = vendor?.code || vendorShortCode(vendor?.name) || 'VND';
    await assignOfficialProcurementNumbers(po, { projectCode, vendorCode });
    po.officialPdfGeneratedAt = new Date();
  }
  await po.save();

  if (po.expectedDeliveryDate && (po.poNumber || po.procurementRef)) {
    try {
      const { StockInventoryRecord } = require('../models');
      const poNo = po.procurementRef || po.poNumber;
      await StockInventoryRecord.updateMany(
        { poNo },
        { $set: { expectedDeliveryDate: po.expectedDeliveryDate } }
      );
    } catch (err) {
      console.warn('Inventory expected delivery sync skipped:', err.message);
    }
  }

  const historyNote = options.chairmanOverride
    ? `Approved in Chairman's absence: ${po.overrideRemark}`
    : delegationService.formatApprovalNote(note || 'Approved', approvalContext);

  await statusHistoryService.record(
    'PurchaseOrder',
    po._id,
    fromStatus,
    'APPROVED',
    actorUserId,
    historyNote
  );

  const mr =
    po.purchaseRequestId?.materialRequestId ||
    (po.purchaseRequestId
      ? (await PurchaseRequest.findById(po.purchaseRequestId).populate('materialRequestId'))
          ?.materialRequestId
      : null);

  if (mr && typeof mr === 'object' && mr._id) {
    const mrFrom = mr.status;
    mr.status = 'CHAIRMAN_APPROVED';
    await mr.save();
    await statusHistoryService.record(
      'MaterialRequest',
      mr._id,
      mrFrom,
      'CHAIRMAN_APPROVED',
      actorUserId,
      `PO ${po.poNumber} approved`
    );
    await notificationService.notifyUser(mr.requestedByUserId, {
      title: 'Purchase order approved',
      body: `PO ${po.poNumber} approved. Awaiting vendor dispatch and store receipt.`,
      relatedEntityType: 'MaterialRequest',
      relatedEntityId: mr._id,
    });
  }

  await runPostApprovalDispatch(po);
  return po;
}

module.exports = {
  runSideEffect,
  recordPoStatusHistory: (po, fromStatus, toStatus, actorUserId, note) =>
    statusHistoryService.record('PurchaseOrder', po._id, fromStatus, toStatus, actorUserId, note),
  notifyChairmen,
  notifyExecutivesReturned,
  coordinatorVerifyPurchaseOrder,
  coordinatorOverrideApprove,
  pmApprovePurchaseOrder,
  finalizePurchaseOrder,
  runPostApprovalDispatch,
};
