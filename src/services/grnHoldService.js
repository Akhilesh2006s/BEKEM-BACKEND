const { UserRole } = require('@afios/shared');
const {
  GoodsReceiptNote,
  PurchaseOrder,
  PurchaseRequest,
  MaterialRequest,
  StockLedger,
  StockMovement,
  Site,
  User,
} = require('../models');
const statusHistoryService = require('./statusHistoryService');
const notificationService = require('./notificationService');
const { syncPoFulfillment } = require('./grnFulfillmentService');

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

async function applyGrnStockAndSideEffects(grn, actorUserId) {
  const po = await PurchaseOrder.findById(grn.purchaseOrderId);
  if (!po) {
    const err = new Error('Purchase order not found');
    err.statusCode = 404;
    throw err;
  }

  const pr = await PurchaseRequest.findById(po.purchaseRequestId);
  const projectId = pr?.projectId?._id || pr?.projectId;

  for (const item of grn.items || []) {
    if (item.quantityReceived <= 0) continue;
    let ledger = await StockLedger.findOne({ siteId: grn.siteId, materialId: item.materialId });
    if (!ledger) {
      ledger = await StockLedger.create({
        siteId: grn.siteId,
        materialId: item.materialId,
        quantityOnHand: 0,
        lowStockThreshold: 10,
      });
    }
    ledger.quantityOnHand += item.quantityReceived;
    ledger.lastMovementAt = new Date();
    await ledger.save();
    await StockMovement.create({
      siteId: grn.siteId,
      materialId: item.materialId,
      materialRequestId: pr?.materialRequestId || null,
      quantityDelta: item.quantityReceived,
      type: 'INCOMING',
      actorUserId,
    });
  }

  const fulfillment = await syncPoFulfillment(po, actorUserId);

  if (pr?.materialRequestId) {
    const mr = await MaterialRequest.findById(pr.materialRequestId);
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
      await mr.save();
      await statusHistoryService.record(
        'MaterialRequest',
        mr._id,
        fromStatus,
        'MATERIAL_RECEIVED',
        actorUserId,
        `GRN ${grn.grnNumber} — material received at store`
      );
      const storeUsers = await User.find({
        role: UserRole.STORE_INCHARGE,
        assignedSiteId: grn.siteId,
      });
      await notificationService.notifyUsers(
        storeUsers.map((u) => u._id),
        {
          title: 'Material received — ready to issue',
          body: `Indent ${mr.indentNumber} stock received. Issue to site when ready.`,
          relatedEntityType: 'MaterialRequest',
          relatedEntityId: mr._id,
        }
      );
    }
  }

  const populatedPo = await PurchaseOrder.findById(po._id).populate('vendorId');
  const { createBillFromGrn } = require('./financeService');
  await createBillFromGrn(grn, populatedPo, populatedPo?.vendorId, projectId, actorUserId);

  return { fulfillment, po };
}

async function finalizeApprovedGrn(grn, actorUserId) {
  const receiptStatus = resolveReceiptStatus(grn.items);
  grn.status = receiptStatus;
  grn.approvalStage = 'APPROVED';
  grn.approvedAt = new Date();
  grn.approvedByUserId = actorUserId;
  await grn.save();

  const { fulfillment } = await applyGrnStockAndSideEffects(grn, actorUserId);
  return { grn, fulfillment };
}

async function notifyGrnHoldApprovers(grn, po, { requiresChairmanApproval }) {
  const coordinators = await User.find({ role: UserRole.COORDINATOR, isActive: { $ne: false } });
  await notificationService.notifyUsers(
    coordinators.map((u) => u._id),
    {
      title: 'GRN on hold — approval required',
      body: `${grn.grnNumber} for PO ${po.displayPoNumber || po.poNumber || ''} requires approval (${(grn.holdReasons || []).join(', ') || 'variance'}).`,
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
