const statusHistoryService = require('./statusHistoryService');
const notificationService = require('./notificationService');
const { UserRole } = require('@afios/shared');
const { User, PurchaseRequest, Vendor } = require('../models');
const { sendPoToVendor } = require('./emailService');
const delegationService = require('./delegationService');
const { assignOfficialProcurementNumbers } = require('./procurementReferenceService');
const {
  requiresChairmanApproval,
  requiresCoordinatorFinalApproval,
  requiresPmApproval,
} = require('../constants/approvalPolicy');
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
  const recipientIds = [
    ...chairmen.map((u) => u._id),
    ...delegateIds,
  ];
  const unique = [...new Set(recipientIds.map((id) => id.toString()))];
  await notificationService.notifyUsers(
    unique,
    {
      title: 'PO awaiting approval',
      body: `${po.poNumber || po.draftRef} requires chairman final approval.`,
      relatedEntityType: 'PurchaseOrder',
      relatedEntityId: po._id,
    }
  );
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

/**
 * Coordinator verify:
 * - < ₹5k should be PM (reject if wrongly here)
 * - ₹5k–₹10k → final approve
 * - > ₹10k → Chairman, unless chairmanUnavailable + note
 */
async function coordinatorVerifyPurchaseOrder(po, actorUserId, note, options = {}) {
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
      null
    );
  }

  // Above ₹10,000
  if (options.chairmanUnavailable) {
    const reason = String(note || '').trim();
    if (reason.length < 8) {
      const err = new Error(
        'Enter a reason (min 8 characters) that Chairman is not on premises / unavailable'
      );
      err.statusCode = 400;
      throw err;
    }
    return finalizePurchaseOrder(
      po,
      actorUserId,
      `Coordinator approved in Chairman absence: ${reason}`,
      null
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
  return finalizePurchaseOrder(po, actorUserId, note || 'Project Manager approved (under ₹5,000)', null);
}

async function finalizePurchaseOrder(po, actorUserId, note, approvalContext) {
  const fromStatus = po.status;
  po.status = 'APPROVED';

  if (!po.poNumber) {
    const pr = await PurchaseRequest.findById(po.purchaseRequestId).populate('projectId');
    const { projectShortCode, vendorShortCode } = require('./codeGenerators');
    const projectCode =
      pr?.projectId?.code || projectShortCode(pr?.projectId?.name) || 'PRJ';
    const vendor = await Vendor.findById(po.vendorId);
    const vendorCode = vendor?.code || vendorShortCode(vendor?.name) || 'VND';
    await assignOfficialProcurementNumbers(po, { projectCode, vendorCode });
    po.officialPdfGeneratedAt = new Date();
  }
  await po.save();

  // Sync expected delivery onto matching Stock Inventory lines (if present)
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

  const historyNote = delegationService.formatApprovalNote(
    note || 'Approved',
    approvalContext
  );

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

  const vendor = await Vendor.findById(po.vendorId);
  if (vendor?.email) {
    try {
      await sendPoToVendor(po, vendor);
      po.sentToVendorAt = new Date();
      await po.save();
    } catch (err) {
      console.error('[PO email]', err.message);
    }
  }

  return po;
}

module.exports = {
  runSideEffect,
  recordPoStatusHistory: (po, fromStatus, toStatus, actorUserId, note) =>
    statusHistoryService.record('PurchaseOrder', po._id, fromStatus, toStatus, actorUserId, note),
  notifyChairmen,
  notifyExecutivesReturned,
  coordinatorVerifyPurchaseOrder,
  pmApprovePurchaseOrder,
  finalizePurchaseOrder,
};