const { UserRole } = require('@afios/shared');
const mongoose = require('mongoose');
const {
  GoodsReceiptNote,
  PurchaseOrder,
  PurchaseRequest,
  MaterialRequest,
  Site,
  User,
} = require('../models');
const statusHistoryService = require('./statusHistoryService');
const notificationService = require('./notificationService');
const { syncPoFulfillment } = require('./grnFulfillmentService');
const { createBatchesFromGrn } = require('./fifoStockService');

function assessGrnHold(varianceLines = [], { invoiceValue, ewayBillNumber, saveDraft = false } = {}) {
  let requiresHold = false;
  let requiresChairmanApproval = false;
  const holdReasons = new Set();

  for (const line of varianceLines) {
    if (line.priceDeviation) {
      requiresHold = true;
      holdReasons.add('PRICE');
    }
    if (line.qtyDeviation && Number(line.receivedQty) > Number(line.remainingQty)) {
      requiresHold = true;
      requiresChairmanApproval = true;
      holdReasons.add('QTY');
    }
  }

  if (
    !saveDraft &&
    invoiceValue != null &&
    Number(invoiceValue) > 50000 &&
    !(ewayBillNumber || '').trim()
  ) {
    requiresHold = true;
    holdReasons.add('EWAY');
  }

  return {
    requiresHold,
    requiresChairmanApproval,
    holdReasons: [...holdReasons],
  };
}

function resolveReceiptStatus(items) {
  const totalReceived = items.reduce((s, i) => s + (i.quantityReceived || 0), 0);
  const allReceived = items.every((i) => i.lineStatus === 'RECEIVED');
  if (totalReceived === 0) return 'REJECTED';
  return allReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
}

function validateMandatoryAttachments(attachments = [], { saveDraft = false } = {}) {
  if (saveDraft) return null;
  const hasInvoice = attachments.some((a) => a.category === 'INVOICE');
  const hasChallan = attachments.some((a) => a.category === 'CHALLAN');
  if (!hasInvoice || !hasChallan) {
    const err = new Error('Invoice and Challan uploads are required before submitting a GRN');
    err.statusCode = 400;
    return err;
  }
  return null;
}

async function applyGrnStockAndSideEffects(grn, actorUserId, options = {}) {
  const session = options.session || null;
  const po = await PurchaseOrder.findById(grn.purchaseOrderId).session(session);
  if (!po) {
    const err = new Error('Purchase order not found');
    err.statusCode = 404;
    throw err;
  }

  const pr = await PurchaseRequest.findById(po.purchaseRequestId).session(session);
  const projectId = pr?.projectId?._id || pr?.projectId;

  await createBatchesFromGrn(grn, actorUserId, pr?.materialRequestId || null, { session });

  const fulfillment = await syncPoFulfillment(po, actorUserId, { session });

  let storeNotification = null;

  if (pr?.materialRequestId) {
    const mr = await MaterialRequest.findById(pr.materialRequestId).session(session);
    if (
      mr &&
      fulfillment.fulfillmentStatus === 'closed_complete' &&
      ['CHAIRMAN_APPROVED', 'PO_CREATED', 'COORDINATOR_VERIFIED', 'MATERIAL_RECEIVED'].includes(
        mr.status
      )
    ) {
      const fromStatus = mr.status;
      mr.status = 'MATERIAL_RECEIVED';
      mr.pendingWithRole = 'STORE_INCHARGE';
      await mr.save(session ? { session } : undefined);
      await statusHistoryService.record(
        'MaterialRequest',
        mr._id,
        fromStatus,
        'MATERIAL_RECEIVED',
        actorUserId,
        `GRN ${grn.grnNumber} — material received at store`,
        { session }
      );
      storeNotification = { siteId: grn.siteId, materialRequestId: mr._id, indentNumber: mr.indentNumber };
    }
  }

  const populatedPo = await PurchaseOrder.findById(po._id).session(session).populate('vendorId');
  const { createBillFromGrn } = require('./financeService');
  await createBillFromGrn(grn, populatedPo, populatedPo?.vendorId, projectId, actorUserId, { session });

  if (!session && storeNotification) await notifyStoreOfReceipt(storeNotification);
  return { fulfillment, po, storeNotification };
}

async function notifyStoreOfReceipt({ siteId, materialRequestId, indentNumber }) {
  const storeUsers = await User.find({ role: UserRole.STORE_INCHARGE, assignedSiteId: siteId });
  await notificationService.notifyUsers(storeUsers.map((u) => u._id), {
    title: 'Material received — ready to issue',
    body: `Indent ${indentNumber} stock received. Issue to site when ready.`,
    relatedEntityType: 'MaterialRequest', relatedEntityId: materialRequestId,
  });
}

async function finalizeApprovedGrn(grn, actorUserId) {
  const session = await mongoose.startSession();
  let finalized, result;
  try {
    await session.withTransaction(async () => {
      const current = await GoodsReceiptNote.findById(grn._id).session(session);
      if (!current || current.status !== 'ON_HOLD' || current.approvalStage !== grn.approvalStage) {
        const err = new Error('GRN is no longer awaiting this approval'); err.statusCode = 409; throw err;
      }
      current.coordinatorApprovedAt = grn.coordinatorApprovedAt;
      current.coordinatorApprovedByUserId = grn.coordinatorApprovedByUserId;
      current.chairmanApprovedAt = grn.chairmanApprovedAt;
      current.chairmanApprovedByUserId = grn.chairmanApprovedByUserId;
      current.note = grn.note;
      current.status = resolveReceiptStatus(current.items);
      current.approvalStage = 'APPROVED';
      current.approvedAt = new Date();
      current.approvedByUserId = actorUserId;
      await current.save({ session });
      result = await applyGrnStockAndSideEffects(current, actorUserId, { session });
      finalized = current;
    });
  } finally {
    await session.endSession();
  }
  if (result.storeNotification) {
    try { await notifyStoreOfReceipt(result.storeNotification); }
    catch (err) { console.error('GRN approved; notification could not be sent:', err.message); }
  }
  return { grn: finalized, fulfillment: result.fulfillment };
}

async function notifyGrnHoldApprovers(grn, po, { requiresChairmanApproval }) {
  const coordinators = await User.find({ role: UserRole.COORDINATOR, isActive: { $ne: false } });
  await notificationService.notifyUsers(
    coordinators.map((u) => u._id),
    {
      title: 'GRN pending — Approve work orders',
      body: `${grn.grnNumber} for PO ${po.displayPoNumber || po.poNumber || ''} is ready for Coordinator approval (${(grn.holdReasons || []).join(', ') || 'review'}).`,
      relatedEntityType: 'GoodsReceiptNote',
      relatedEntityId: grn._id,
    }
  );

  if (requiresChairmanApproval) {
    const chairmen = await User.find({ role: UserRole.CHAIRMAN, isActive: { $ne: false } });
    await notificationService.notifyUsers(
      chairmen.map((u) => u._id),
      {
        title: 'GRN queued for MD review',
        body: `${grn.grnNumber} will need Chairman approval after Coordinator sign-off.`,
        relatedEntityType: 'GoodsReceiptNote',
        relatedEntityId: grn._id,
      }
    );
  }
}

async function notifyChairmanGrnPending(grn, po) {
  const chairmen = await User.find({ role: UserRole.CHAIRMAN, isActive: { $ne: false } });
  await notificationService.notifyUsers(
    chairmen.map((u) => u._id),
    {
      title: 'GRN on hold — Chairman approval',
      body: `${grn.grnNumber} for PO ${po.displayPoNumber || po.poNumber || ''} awaits MD approval.`,
      relatedEntityType: 'GoodsReceiptNote',
      relatedEntityId: grn._id,
    }
  );
}

function serializeGrnHoldItem(grn, po, vendor) {
  return {
    id: grn._id.toString(),
    grnNumber: grn.grnNumber,
    status: grn.status,
    approvalStage: grn.approvalStage,
    requiresChairmanApproval: Boolean(grn.requiresChairmanApproval),
    holdReasons: grn.holdReasons || [],
    invoiceNo: grn.invoiceNo,
    invoiceValue: grn.invoiceValue,
    receivedAt: grn.receivedAt?.toISOString?.() || grn.createdAt?.toISOString?.() || '',
    varianceDetails: grn.varianceDetails,
    purchaseOrderId: po?._id?.toString(),
    poNumber: po?.displayPoNumber || po?.poNumber || po?.draftRef || '',
    vendorName: vendor?.name || '',
    projectName: po?.purchaseRequestId?.projectId?.name || '',
  };
}

module.exports = {
  assessGrnHold,
  resolveReceiptStatus,
  validateMandatoryAttachments,
  applyGrnStockAndSideEffects,
  finalizeApprovedGrn,
  notifyGrnHoldApprovers,
  notifyChairmanGrnPending,
  serializeGrnHoldItem,
};
