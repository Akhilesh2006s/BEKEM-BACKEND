const express = require('express');
const { body, param } = require('express-validator');
const {
  GoodsReceiptNote,
  PurchaseOrder,
  PurchaseRequest,
  Material,
  Site,
  User,
} = require('../models');
const { UserRole } = require('@afios/shared');
const { authenticate } = require('../middleware/auth');
const { requireCapability } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const {
  computeLineVariances,
  getCumulativeReceivedByLine,
  canViewGrnVariance,
  summarizePurchaseOrdersReceipts,
  summarizePoReceiptQuantities,
} = require('../services/grnFulfillmentService');
const {
  assessGrnHold,
  resolveReceiptStatus,
  validateMandatoryAttachments,
  applyGrnStockAndSideEffects,
  finalizeApprovedGrn,
  notifyGrnHoldApprovers,
  notifyChairmanGrnPending,
  serializeGrnHoldItem,
} = require('../services/grnHoldService');
const {
  allocatePoGrnNumber,
} = require('../services/grnCounterService');
const {
  computeGrnInvoiceValue,
  validateGrnTransportFields,
} = require('../services/poEditService');

const router = express.Router();
router.use(authenticate);

router.get('/pending-purchase-orders', async (req, res, next) => {
  try {
    // Req 43/44 — Material Received opens directly from approved POs (no Verify Delivery gate).
    const filter = {
      status: 'APPROVED',
      fulfillmentStatus: { $ne: 'closed_complete' },
    };
    // Store only sees approved POs for projects they are assigned to.
    if (req.user.role === UserRole.STORE_INCHARGE) {
      const projectIds = (req.user.assignedProjectIds || []).map((id) => id.toString?.() || id);
      if (!projectIds.length) {
        return res.json({ data: [] });
      }
      const prs = await PurchaseRequest.find({ projectId: { $in: projectIds } })
        .select('_id')
        .lean();
      const prIds = prs.map((p) => p._id);
      if (!prIds.length) {
        return res.json({ data: [] });
      }
      filter.purchaseRequestId = { $in: prIds };
    }

    const orders = await PurchaseOrder.find(filter)
      .sort({ createdAt: -1 })
      .populate([
        { path: 'vendorId' },
        {
          path: 'purchaseRequestId',
          populate: [{ path: 'projectId' }, { path: 'materialRequestId' }],
        },
      ]);
    const { serializePurchaseOrder } = require('../utils/serializeProcurement');
    const receiptByPo = await summarizePurchaseOrdersReceipts(orders);
    res.json({
      data: orders.map((po) => {
        const row = serializePurchaseOrder(po);
        row.receiptSummary = receiptByPo.get(po._id.toString()) || {
          orderedQty: 0,
          receivedQty: 0,
          remainingQty: 0,
          lineCount: (po.lineItems || []).length,
        };
        return row;
      }),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/hold-queue', async (req, res, next) => {
  try {
    const role = req.user.role;
    let approvalStage;
    if (role === UserRole.COORDINATOR) approvalStage = 'COORDINATOR_PENDING';
    else if (role === UserRole.CHAIRMAN) approvalStage = 'CHAIRMAN_PENDING';
    else {
      return res.status(403).json({ statusCode: 403, message: 'Forbidden' });
    }

    const grns = await GoodsReceiptNote.find({ status: 'ON_HOLD', approvalStage })
      .sort({ createdAt: -1 })
      .populate({
        path: 'purchaseOrderId',
        populate: [
          { path: 'vendorId' },
          { path: 'purchaseRequestId', populate: { path: 'projectId' } },
        ],
      })
      .limit(100);

    res.json({
      data: grns.map((g) => {
        const po = g.purchaseOrderId;
        const vendor = po?.vendorId;
        return serializeGrnHoldItem(g, po, vendor);
      }),
    });
  } catch (err) {
    next(err);
  }
});

const { BEKEM_BUYER_GST } = require('../constants/bekemAddresses');

function roundMoney(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function splitGstAmounts(taxable, gstPercent, vendorGstNumber) {
  const gstAmount = roundMoney(taxable * ((Number(gstPercent) || 0) / 100));
  const buyerState = String(BEKEM_BUYER_GST || '').slice(0, 2);
  const vendorState = String(vendorGstNumber || '').trim().slice(0, 2).toUpperCase();
  const interstate = Boolean(buyerState && vendorState && vendorState !== buyerState);
  if (interstate) {
    return { igst: gstAmount, cgst: 0, sgst: 0, gstAmount };
  }
  const half = roundMoney(gstAmount / 2);
  // Keep total GST exact when odd paise
  return { igst: 0, cgst: half, sgst: roundMoney(gstAmount - half), gstAmount };
}

function serializeGrnListItem(g, receiptSummary = null) {
  const po = g.purchaseOrderId;
  const poLines = Array.isArray(po?.lineItems) ? po.lineItems : [];
  const vendor =
    (g.vendorId && typeof g.vendorId === 'object' ? g.vendorId : null) ||
    (po?.vendorId && typeof po.vendorId === 'object' ? po.vendorId : null);
  const vendorGstNumber = vendor?.gstNumber || '';
  const vendorName = g.vendorName || vendor?.name || '';
  const items = (g.items || []).map((item) => {
    const mat = item.materialId;
    const materialId = mat?._id?.toString?.() || mat?.toString?.() || '';
    const poLine = poLines.find(
      (line) => (line.materialId?._id || line.materialId)?.toString?.() === materialId
    );
    const quantity = Number(item.quantityReceived) || 0;
    const ordered = Number(item.quantityOrdered || poLine?.quantity || 0);
    const rate = Number(item.invoiceUnitPrice || item.orderedUnitPrice || poLine?.rate || 0);
    const gstPercent = Number(poLine?.gstPercent ?? mat?.gstRate ?? 18);
    const basicAmount = roundMoney(quantity * rate);
    const others = 0;
    const totalBasic = roundMoney(basicAmount + others);
    const { igst, cgst, sgst, gstAmount } = splitGstAmounts(totalBasic, gstPercent, vendorGstNumber);
    const grossAmount = roundMoney(totalBasic + gstAmount);
    return {
      materialId,
      materialName: mat?.name || poLine?.description || 'Material',
      hsnCode: poLine?.hsnCode || mat?.hsnCode || '',
      unit: item.unit || mat?.unit || poLine?.unit || '',
      quantity,
      quantityOrdered: ordered,
      rate,
      basicAmount,
      others,
      totalBasic,
      gstPercent,
      igst,
      cgst,
      sgst,
      gstAmount,
      taxableAmount: totalBasic,
      grossAmount,
    };
  });

  const thisGrnReceivedQty = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const summary =
    receiptSummary ||
    (po?.lineItems
      ? summarizePoReceiptQuantities(po, {})
      : { orderedQty: 0, receivedQty: 0, remainingQty: 0, lineCount: items.length });

  return {
    id: g._id.toString(),
    grnNumber: g.grnNumber,
    purchaseOrderId: po?._id?.toString() || po?.toString?.() || null,
    poNumber: g.poNumber || po?.poNumber || po?.displayPoNumber || po?.draftRef || '',
    indentNumber: g.indentNumber || '',
    projectCode: po?.purchaseRequestId?.projectId?.code || '',
    projectName: po?.purchaseRequestId?.projectId?.name || '',
    vendorId:
      g.vendorId?._id?.toString?.() ||
      g.vendorId?.toString?.() ||
      vendor?._id?.toString?.() ||
      null,
    vendorName,
    vendorGstNumber,
    status: g.status,
    invoiceNo: g.invoiceNo || '',
    invoiceDate: g.invoiceDate?.toISOString?.() || null,
    invoiceValue: g.invoiceValue || 0,
    challanNo: g.challanNo || '',
    ewayBillNumber: g.ewayBillNumber || '',
    vehicleNo: g.vehicleNo || '',
    driverName: g.driverName || '',
    deliveryDate: g.deliveryDate?.toISOString?.() || null,
    note: g.note || '',
    remarks: g.note || '',
    receiveType: g.receiveType || 'FULL',
    receivedAt: g.receivedAt?.toISOString?.() || g.createdAt?.toISOString?.() || null,
    itemCount: items.length,
    items,
    attachments: (g.attachments || []).map((a) => ({
      id: a._id?.toString?.(),
      name: a.name,
      fileType: a.fileType || 'application/octet-stream',
      category: a.category || 'PHOTO',
      url: a.url || '',
    })),
    quantityOrdered: summary.orderedQty,
    quantityReceivedThisGrn: thisGrnReceivedQty,
    quantityReceived: summary.receivedQty,
    quantityRemaining: summary.remainingQty,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const receipts = await GoodsReceiptNote.find()
      .sort({ createdAt: -1 })
      .populate({
        path: 'purchaseOrderId',
        populate: [
          { path: 'vendorId', select: 'name gstNumber' },
          { path: 'purchaseRequestId', populate: { path: 'projectId', select: 'code name' } },
        ],
      })
      .populate('vendorId', 'name gstNumber')
      .populate('items.materialId')
      .limit(100);
    const pos = receipts
      .map((g) => g.purchaseOrderId)
      .filter((po) => po && typeof po === 'object' && po.lineItems);
    const uniquePos = [];
    const seen = new Set();
    for (const po of pos) {
      const id = po._id.toString();
      if (seen.has(id)) continue;
      seen.add(id);
      uniquePos.push(po);
    }
    const receiptByPo = await summarizePurchaseOrdersReceipts(uniquePos);
    res.json({
      data: receipts.map((g) => {
        const poId = g.purchaseOrderId?._id?.toString?.() || g.purchaseOrderId?.toString?.();
        return serializeGrnListItem(g, poId ? receiptByPo.get(poId) : null);
      }),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', param('id').isMongoId(), validate, async (req, res, next) => {
  try {
    const grn = await GoodsReceiptNote.findById(req.params.id)
      .populate({
        path: 'purchaseOrderId',
        populate: [
          { path: 'vendorId', select: 'name gstNumber' },
          { path: 'purchaseRequestId', populate: { path: 'projectId', select: 'code name' } },
        ],
      })
      .populate('vendorId', 'name gstNumber')
      .populate('items.materialId')
      .populate('receivedByUserId', 'name role');
    if (!grn) {
      return res.status(404).json({ statusCode: 404, message: 'GRN not found' });
    }
    const po = grn.purchaseOrderId;
    let receiptSummary = null;
    if (po && typeof po === 'object' && po.lineItems) {
      const map = await summarizePurchaseOrdersReceipts([po]);
      receiptSummary = map.get(po._id.toString()) || null;
    }
    const data = serializeGrnListItem(grn, receiptSummary);
    data.receivedByName = grn.receivedByUserId?.name || '';
    data.holdReasons = grn.holdReasons || [];
    data.approvalStage = grn.approvalStage || 'NONE';
    data.varianceDetails = canViewGrnVariance(req.user.role) ? grn.varianceDetails : null;
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/',
  requireCapability('RECEIVE_MATERIAL'),
  [
    body('purchaseOrderId').isMongoId(),
    body('items').isArray({ min: 1 }),
    body('items.*.materialId').isMongoId(),
    body('items.*.quantityOrdered').isFloat({ min: 0 }),
    body('items.*.quantityReceived').isFloat({ min: 0 }),
    body('items.*.invoiceUnitPrice').optional().isFloat({ min: 0 }),
    body('items.*.lineIndex').optional().isInt({ min: 0 }),
    body('items.*.lineStatus').optional().isIn(['RECEIVED', 'PARTIAL', 'REJECTED']),
    body('note').optional().trim(),
    body('remarks').optional().trim(),
    body('invoiceNo').optional().trim(),
    body('invoiceDate').isISO8601().withMessage('Invoice date is required'),
    body('invoiceValue').optional().isFloat({ min: 0 }),
    body('challanNo').optional().trim(),
    body('vehicleNo').optional().trim(),
    body('vehicleNumber').optional().trim(),
    body('ewayBillNumber').optional().trim(),
    body('driverName').optional().trim(),
    body('deliveryDate').optional().isISO8601(),
    body('saveDraft').optional().isBoolean(),
    body('receiveType').optional().isIn(['PARTIAL', 'FULL']),
    body('attachments').optional().isArray(),
    body('attachments.*.name').optional().isString(),
    body('attachments.*.fileType').optional().isString(),
    body('attachments.*.category').optional().isIn(['INVOICE', 'CHALLAN', 'PHOTO']),
    body('attachments.*.dataBase64').optional().isString(),
    body('attachments.*.contentBase64').optional().isString(),
  ],
  validate,
  async (req, res, next) => {
    const { withIdempotency, sendIdempotent } = require('../services/idempotencyService');
    try {
      const outcome = await withIdempotency(req, `grn:${req.body.purchaseOrderId}`, async () => {
      const po = await PurchaseOrder.findById(req.body.purchaseOrderId);
      if (!po) return { statusCode: 404, body: { statusCode: 404, message: 'PO not found' } };
      if (po.status !== 'APPROVED') {
        return { statusCode: 400, body: { statusCode: 400, message: 'PO must be approved before receipt' } };
      }

      const existingComplete = po.fulfillmentStatus === 'closed_complete';
      if (existingComplete) {
        return {
          statusCode: 400,
          body: { statusCode: 400, message: 'This PO has already been fully received' },
        };
      }

      const cumulativeBefore = await getCumulativeReceivedByLine(po._id);
      const linePayloads = req.body.items.map((i, idx) => ({
        lineIndex: i.lineIndex != null ? Number(i.lineIndex) : idx,
        quantityReceived: i.quantityReceived,
        invoiceUnitPrice: i.invoiceUnitPrice,
      }));
      const { items, isPartial, varianceLines } = computeLineVariances(
        po,
        linePayloads,
        cumulativeBefore
      );

      const totalReceived = items.reduce((s, i) => s + i.quantityReceived, 0);
      const saveDraft = req.body.saveDraft === true;
      const rawAttachments = Array.isArray(req.body.attachments)
        ? req.body.attachments.filter((a) => a?.name)
        : [];

      const attachmentErr = validateMandatoryAttachments(rawAttachments, { saveDraft });
      if (attachmentErr) {
        return {
          statusCode: attachmentErr.statusCode,
          body: { statusCode: attachmentErr.statusCode, message: attachmentErr.message },
        };
      }

      const invoiceValue =
        req.body.invoiceValue != null
          ? Number(req.body.invoiceValue)
          : computeGrnInvoiceValue(items);

      const hold = assessGrnHold(varianceLines, {
        invoiceValue,
        ewayBillNumber: req.body.ewayBillNumber,
        saveDraft,
      });

      const anyRejected = items.some((i) => i.lineStatus === 'REJECTED');
      const rejectedOnSubmit = !saveDraft && anyRejected && totalReceived === 0;
      // Every submitted GRN waits on Coordinator (Approve work orders) before stock posts.
      let status = saveDraft
        ? 'DRAFT'
        : rejectedOnSubmit
          ? 'REJECTED'
          : 'ON_HOLD';
      const needsCoordinatorReview = !saveDraft && status === 'ON_HOLD';
      const holdReasons = hold.requiresHold
        ? hold.holdReasons
        : needsCoordinatorReview
          ? ['REVIEW']
          : [];

      const receiveType =
        req.body.receiveType || (isPartial || status === 'PARTIALLY_RECEIVED' ? 'PARTIAL' : 'FULL');
      const remarks = req.body.remarks || req.body.note || '';

      const pr = await PurchaseRequest.findById(po.purchaseRequestId);
      const projectId = pr?.projectId?._id || pr?.projectId;
      if (!projectId) {
        return { statusCode: 400, body: { statusCode: 400, message: 'PO project not found for GRN numbering' } };
      }

      const site =
        (await Site.findOne({ projectId: pr?.projectId })) ||
        (req.user.assignedSiteId ? await Site.findById(req.user.assignedSiteId) : null);
      const siteId = site?._id || req.user.assignedSiteId;
      if (!siteId) {
        return { statusCode: 400, body: { statusCode: 400, message: 'No site for stock update' } };
      }

      const grnNumber = await allocatePoGrnNumber(po._id);

      const { MaterialRequest, Vendor } = require('../models');
      let indentNumber = '';
      if (pr?.materialRequestId) {
        const mr = await MaterialRequest.findById(pr.materialRequestId).select('indentNumber');
        indentNumber = mr?.indentNumber || '';
      }
      const vendor =
        po.vendorId && typeof po.vendorId === 'object' && po.vendorId.name
          ? po.vendorId
          : po.vendorId
            ? await Vendor.findById(po.vendorId).select('name')
            : null;
      const poNumber = po.poNumber || po.displayPoNumber || po.draftRef || '';
      const vendorName = vendor?.name || '';
      const { persistGrnAttachments } = require('../services/grnFileService');
      let attachments;
      try {
        attachments = persistGrnAttachments(rawAttachments);
      } catch (fileErr) {
        return {
          statusCode: fileErr.statusCode || 400,
          body: { statusCode: fileErr.statusCode || 400, message: fileErr.message },
        };
      }

      const grn = await GoodsReceiptNote.create({
        grnNumber,
        purchaseOrderId: po._id,
        poNumber,
        indentNumber,
        vendorId: vendor?._id || po.vendorId || null,
        vendorName,
        siteId,
        items,
        receivedQuantity: totalReceived,
        status,
        approvalStage: needsCoordinatorReview
          ? 'COORDINATOR_PENDING'
          : saveDraft
            ? 'NONE'
            : 'APPROVED',
        requiresChairmanApproval: hold.requiresChairmanApproval,
        holdReasons,
        receiveType,
        isPartialGrn: isPartial || hold.requiresHold || needsCoordinatorReview,
        varianceDetails:
          isPartial || hold.requiresHold || needsCoordinatorReview ? { lines: varianceLines } : null,
        invoiceNo: req.body.invoiceNo || '',
        invoiceDate: new Date(req.body.invoiceDate),
        invoiceValue,
        challanNo: req.body.challanNo || '',
        vehicleNo: '',
        ewayBillNumber: (req.body.ewayBillNumber || '').trim(),
        driverName: '',
        deliveryDate: req.body.deliveryDate ? new Date(req.body.deliveryDate) : new Date(),
        note: remarks,
        attachments,
        receivedByUserId: req.user._id,
      });

      let fulfillment = { fulfillmentStatus: po.fulfillmentStatus };

      if (!saveDraft && status !== 'REJECTED' && status !== 'ON_HOLD') {
        const result = await applyGrnStockAndSideEffects(grn, req.user._id);
        fulfillment = result.fulfillment;
      } else if (!saveDraft && status === 'ON_HOLD') {
        await notifyGrnHoldApprovers(grn, po, hold);
      }

      const populated = await GoodsReceiptNote.findById(grn._id)
        .populate('purchaseOrderId')
        .populate('items.materialId');
      const responseGrn = {
        id: populated._id.toString(),
        grnNumber: populated.grnNumber,
        status: populated.status,
        approvalStage: populated.approvalStage,
        requiresChairmanApproval: populated.requiresChairmanApproval,
        holdReasons: populated.holdReasons,
        isPartialGrn: populated.isPartialGrn,
        varianceDetails: canViewGrnVariance(req.user.role) ? populated.varianceDetails : null,
        fulfillmentStatus: fulfillment.fulfillmentStatus,
        items: populated.items.map((i) => ({
          materialId: i.materialId._id.toString(),
          materialName: i.materialId.name,
          quantityReceived: i.quantityReceived,
          lineStatus: i.lineStatus,
          invoiceUnitPrice: canViewGrnVariance(req.user.role) ? i.invoiceUnitPrice : undefined,
          qtyVariance: canViewGrnVariance(req.user.role) ? i.qtyVariance : undefined,
          priceVariance: canViewGrnVariance(req.user.role) ? i.priceVariance : undefined,
        })),
      };
      return { statusCode: 201, body: { data: responseGrn } };
      });
      return sendIdempotent(res, outcome);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/approve',
  param('id').isMongoId(),
  body('remark').optional().trim(),
  validate,
  async (req, res, next) => {
    try {
      const grn = await GoodsReceiptNote.findById(req.params.id);
      if (!grn) return res.status(404).json({ statusCode: 404, message: 'GRN not found' });
      if (grn.status !== 'ON_HOLD') {
        return res.status(400).json({ statusCode: 400, message: 'GRN is not on hold' });
      }

      const po = await PurchaseOrder.findById(grn.purchaseOrderId).populate('vendorId');
      if (!po) return res.status(404).json({ statusCode: 404, message: 'PO not found' });

      if (grn.approvalStage === 'COORDINATOR_PENDING') {
        if (req.user.role !== UserRole.COORDINATOR) {
          return res.status(403).json({ statusCode: 403, message: 'Coordinator approval required' });
        }
        grn.coordinatorApprovedAt = new Date();
        grn.coordinatorApprovedByUserId = req.user._id;
        if (req.body.remark) grn.note = [grn.note, req.body.remark].filter(Boolean).join('\n');

        if (grn.requiresChairmanApproval) {
          grn.approvalStage = 'CHAIRMAN_PENDING';
          await grn.save();
          await notifyChairmanGrnPending(grn, po);
          return res.json({
            data: {
              id: grn._id.toString(),
              status: grn.status,
              approvalStage: grn.approvalStage,
              message: 'Forwarded to Chairman for approval',
            },
          });
        }

        const { grn: finalized, fulfillment } = await finalizeApprovedGrn(grn, req.user._id);
        return res.json({
          data: {
            id: finalized._id.toString(),
            status: finalized.status,
            approvalStage: finalized.approvalStage,
            fulfillmentStatus: fulfillment.fulfillmentStatus,
            message: 'GRN approved — stock allocated',
          },
        });
      }

      if (grn.approvalStage === 'CHAIRMAN_PENDING') {
        if (req.user.role !== UserRole.CHAIRMAN) {
          return res.status(403).json({ statusCode: 403, message: 'Chairman approval required' });
        }
        grn.chairmanApprovedAt = new Date();
        grn.chairmanApprovedByUserId = req.user._id;
        if (req.body.remark) grn.note = [grn.note, req.body.remark].filter(Boolean).join('\n');
        await grn.save();

        const { grn: finalized, fulfillment } = await finalizeApprovedGrn(grn, req.user._id);
        return res.json({
          data: {
            id: finalized._id.toString(),
            status: finalized.status,
            approvalStage: finalized.approvalStage,
            fulfillmentStatus: fulfillment.fulfillmentStatus,
            message: 'GRN approved — stock allocated',
          },
        });
      }

      return res.status(400).json({ statusCode: 400, message: 'GRN is not pending approval' });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
