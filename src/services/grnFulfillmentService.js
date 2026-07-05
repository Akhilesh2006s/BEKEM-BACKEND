const {
  GoodsReceiptNote,
  PurchaseOrder,
  Notification,
  DeliveryAlert,
} = require('../models');
const { recordPoReceived, hasReachedStage } = require('./poTimelineService');

const VARIANCE_ROLES = new Set(['STORE', 'PM', 'EXECUTIVE', 'COORDINATOR', 'CHAIRMAN']);

function canViewGrnVariance(role) {
  return VARIANCE_ROLES.has(role);
}

function buildLineKey(line, index) {
  return line._id?.toString() || `idx-${index}`;
}

async function getCumulativeReceivedByLine(poId, { excludeStatuses = ['DRAFT'] } = {}) {
  const grns = await GoodsReceiptNote.find({
    purchaseOrderId: poId,
    status: { $nin: excludeStatuses },
  }).lean();

  const cumulative = {};
  for (const grn of grns) {
    for (const item of grn.items || []) {
      const key = item.poLineId?.toString() || item.materialId?.toString();
      if (!key) continue;
      cumulative[key] = (cumulative[key] || 0) + (item.quantityReceived || 0);
    }
  }
  return cumulative;
}

function computeLineVariances(po, linePayloads, cumulativeBefore = {}) {
  const varianceLines = [];
  let isPartial = false;

  const items = linePayloads.map((row, index) => {
    const poLine = po.lineItems[row.lineIndex ?? index];
    if (!poLine) {
      const err = new Error(`Invalid line index ${row.lineIndex ?? index}`);
      err.statusCode = 400;
      throw err;
    }

    const lineKey = buildLineKey(poLine, row.lineIndex ?? index);
    const orderedQty = Number(poLine.quantity);
    const orderedPrice = Number(poLine.rate);
    const alreadyReceived = cumulativeBefore[lineKey] || cumulativeBefore[poLine.materialId?.toString()] || 0;
    const remainingQty = Math.max(0, orderedQty - alreadyReceived);
    const receivedQty = Number(row.quantityReceived ?? row.receivedQty ?? 0);
    const invoicePrice = Number(row.invoiceUnitPrice ?? row.rate ?? orderedPrice);

    const qtyVariance = receivedQty - remainingQty;
    const priceVariance = invoicePrice - orderedPrice;
    const hasQtyVar = receivedQty > 0 && Math.abs(qtyVariance) > 0.0001;
    const hasPriceVar = Math.abs(priceVariance) > 0.0001;

    if (hasQtyVar || hasPriceVar) {
      isPartial = true;
      varianceLines.push({
        poLineId: poLine._id?.toString(),
        materialId: poLine.materialId?.toString(),
        description: poLine.description,
        orderedQty,
        remainingQty,
        receivedQty,
        orderedUnitPrice: orderedPrice,
        invoiceUnitPrice: invoicePrice,
        qtyVariance,
        priceVariance,
        qtyDeviation: hasQtyVar,
        priceDeviation: hasPriceVar,
      });
    }

    return {
      materialId: poLine.materialId,
      poLineId: poLine._id,
      quantityOrdered: orderedQty,
      quantityReceived: receivedQty,
      orderedUnitPrice: orderedPrice,
      invoiceUnitPrice: invoicePrice,
      qtyVariance,
      priceVariance,
      lineStatus:
        alreadyReceived + receivedQty >= orderedQty
          ? 'RECEIVED'
          : receivedQty > 0
            ? 'PARTIAL'
            : 'REJECTED',
    };
  });

  return { items, isPartial, varianceLines };
}

async function syncPoFulfillment(po, actorUserId) {
  const cumulative = await getCumulativeReceivedByLine(po._id);

  let allComplete = true;
  const lineSummary = (po.lineItems || []).map((line, index) => {
    const key = buildLineKey(line, index);
    const ordered = Number(line.quantity);
    const received = cumulative[key] || cumulative[line.materialId?.toString()] || 0;
    if (received < ordered) allComplete = false;
    return {
      poLineId: line._id?.toString(),
      materialId: line.materialId?.toString(),
      description: line.description,
      orderedQty: ordered,
      cumulativeReceived: received,
      remainingQty: Math.max(0, ordered - received),
      isComplete: received >= ordered,
    };
  });

  po.fulfillmentStatus = allComplete ? 'closed_complete' : 'open_partial';
  if (allComplete) {
    po.trackingReceivedAt = po.trackingReceivedAt || new Date();
    if (!(await hasReachedStage(po._id, 'received'))) {
      await recordPoReceived(po._id, actorUserId);
    }
    await DeliveryAlert.updateMany(
      { purchaseOrderId: po._id, resolvedAt: null },
      { $set: { resolvedAt: new Date() } }
    );
  }
  await po.save();

  return { fulfillmentStatus: po.fulfillmentStatus, lineSummary, allComplete };
}

async function listPoGrns(poId) {
  const { PaymentBill } = require('../models');
  const { summarizePayments } = require('./financeService');

  const [po, grns] = await Promise.all([
    PurchaseOrder.findById(poId).lean(),
    GoodsReceiptNote.find({ purchaseOrderId: poId }).sort({ receivedAt: -1, createdAt: -1 }).lean(),
  ]);
  if (!po) return null;

  const grnIds = grns.map((g) => g._id);
  const [cumulative, bills] = await Promise.all([
    getCumulativeReceivedByLine(poId),
    PaymentBill.find({ grnId: { $in: grnIds } }).lean(),
  ]);
  const billByGrn = new Map(bills.map((b) => [b.grnId.toString(), b]));
  const poBills = await PaymentBill.find({ purchaseOrderId: poId }).lean();

  const lineSummary = (po.lineItems || []).map((line, index) => {
    const key = buildLineKey(line, index);
    const ordered = Number(line.quantity);
    const received =
      cumulative[key] || cumulative[line.materialId?.toString()] || 0;
    return {
      poLineId: line._id?.toString(),
      description: line.description,
      orderedQty: ordered,
      cumulativeReceived: received,
      remainingQty: Math.max(0, ordered - received),
      isComplete: received >= ordered,
    };
  });

  return {
    fulfillmentStatus: po.fulfillmentStatus || 'open_partial',
    lineSummary,
    paymentSummary: {
      ...summarizePayments(poBills),
      billCount: poBills.length,
    },
    grns: grns.map((g) => {
      const bill = billByGrn.get(g._id.toString());
      return {
        id: g._id.toString(),
        grnNumber: g.grnNumber,
        status: g.status,
        receiveType: g.receiveType,
        isPartialGrn: Boolean(g.isPartialGrn),
        varianceDetails: g.varianceDetails,
        invoiceNo: g.invoiceNo,
        receivedAt: g.receivedAt?.toISOString?.() || g.createdAt?.toISOString?.() || '',
        items: g.items,
        billNumber: bill?.billNumber || '',
        invoiceValue: bill?.invoiceValue,
        paidAmount: bill?.paidAmount || 0,
        outstandingAmount: bill?.outstandingAmount,
        paymentStatus: bill?.paymentStatus || (bill ? 'PENDING' : undefined),
        tallySyncStatus: bill?.tallySyncStatus,
      };
    }),
  };
}

function stripVarianceForRole(grnPayload, role) {
  if (canViewGrnVariance(role)) return grnPayload;
  const copy = { ...grnPayload };
  delete copy.varianceDetails;
  delete copy.isPartialGrn;
  if (copy.items) {
    copy.items = copy.items.map((it) => {
      const { qtyVariance, priceVariance, orderedUnitPrice, invoiceUnitPrice, ...rest } = it;
      return rest;
    });
  }
  return copy;
}

module.exports = {
  canViewGrnVariance,
  getCumulativeReceivedByLine,
  computeLineVariances,
  syncPoFulfillment,
  listPoGrns,
  stripVarianceForRole,
};
