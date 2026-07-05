const express = require('express');
const { body, param } = require('express-validator');
const {
  GoodsReceiptNote,
  PurchaseOrder,
  PurchaseRequest,
  MaterialRequest,
  StockLedger,
  StockMovement,
  Material,
  Site,
  User,
} = require('../models');
const { UserRole } = require('@afios/shared');
const statusHistoryService = require('../services/statusHistoryService');
const notificationService = require('../services/notificationService');
const { authenticate } = require('../middleware/auth');
const { requireCapability } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const {
  computeLineVariances,
  getCumulativeReceivedByLine,
  syncPoFulfillment,
  canViewGrnVariance,
} = require('../services/grnFulfillmentService');
const {
  allocateProjectGrnNumber,
} = require('../services/grnCounterService');
const {
  computeGrnInvoiceValue,
  validateGrnTransportFields,
} = require('../services/poEditService');

const router = express.Router();
router.use(authenticate);

router.get('/pending-purchase-orders', async (req, res, next) => {
  try {
    const { DeliveryVerification } = require('../models');
    const verifiedPoIds = await DeliveryVerification.distinct('purchaseOrderId');
    const orders = await PurchaseOrder.find({
      status: 'APPROVED',
      fulfillmentStatus: { $ne: 'closed_complete' },
      _id: { $in: verifiedPoIds },
    })
      .sort({ createdAt: -1 })
      .populate([
        { path: 'vendorId' },
        {
          path: 'purchaseRequestId',
          populate: [{ path: 'projectId' }, { path: 'materialRequestId' }],
        },
      ]);
    const { serializePurchaseOrder } = require('../utils/serializeProcurement');
    res.json({ data: orders.map(serializePurchaseOrder) });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const receipts = await GoodsReceiptNote.find()
      .sort({ createdAt: -1 })
      .populate('purchaseOrderId')
      .populate('items.materialId')
      .limit(50);
    res.json({
      data: receipts.map((g) => ({
        id: g._id.toString(),
        grnNumber: g.grnNumber,
        purchaseOrderId: g.purchaseOrderId?._id?.toString(),
        poNumber: g.purchaseOrderId?.poNumber || g.purchaseOrderId?.draftRef,
        status: g.status,
        receivedAt: g.receivedAt?.toISOString?.(),
        itemCount: g.items?.length || 0,
      })),
    });
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

      const { DeliveryVerification } = require('../models');
      const verification = await DeliveryVerification.findOne({ purchaseOrderId: po._id });
      if (!verification) {
        return {
          statusCode: 400,
          body: { statusCode: 400, message: 'Store must verify physical delivery before GRN can be created' },
        };
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
      const allReceived = items.every((i) => i.lineStatus === 'RECEIVED');
      const anyRejected = items.some((i) => i.lineStatus === 'REJECTED');
      const saveDraft = req.body.saveDraft === true;
      const status = saveDraft
        ? 'DRAFT'
        : anyRejected && totalReceived === 0
          ? 'REJECTED'
          : allReceived
            ? 'RECEIVED'
            : 'PARTIALLY_RECEIVED';

      const receiveType =
        req.body.receiveType || (isPartial || status === 'PARTIALLY_RECEIVED' ? 'PARTIAL' : 'FULL');
      const remarks = req.body.remarks || req.body.note || '';
      const attachments = Array.isArray(req.body.attachments)
        ? req.body.attachments.filter((a) => a?.name)
        : [];

      const pr = await PurchaseRequest.findById(po.purchaseRequestId);
      const projectId = pr?.projectId?._id || pr?.projectId;
      if (!projectId) {
        return { statusCode: 400, body: { statusCode: 400, message: 'PO project not found for GRN numbering' } };
      }

      const invoiceValue =
        req.body.invoiceValue != null
          ? Number(req.body.invoiceValue)
          : computeGrnInvoiceValue(items);

      const transportErr = validateGrnTransportFields(invoiceValue, {
        vehicleNo: req.body.vehicleNo,
        vehicleNumber: req.body.vehicleNumber,
        ewayBillNumber: req.body.ewayBillNumber,
      });
      if (transportErr) {
        return {
          statusCode: transportErr.statusCode,
          body: { statusCode: transportErr.statusCode, message: transportErr.message },
        };
      }

      const site =
        (await Site.findOne({ projectId: pr?.projectId })) ||
        (req.user.assignedSiteId ? await Site.findById(req.user.assignedSiteId) : null);
      const siteId = site?._id || req.user.assignedSiteId;
      if (!siteId) {
        return { statusCode: 400, body: { statusCode: 400, message: 'No site for stock update' } };
      }

      const grnNumber = await allocateProjectGrnNumber(projectId);
      const vehicleNo = (req.body.vehicleNo || req.body.vehicleNumber || '').trim();

      const grn = await GoodsReceiptNote.create({
        grnNumber,
        purchaseOrderId: po._id,
        siteId,
        items,
        receivedQuantity: totalReceived,
        status,
        receiveType,
        isPartialGrn: isPartial,
        varianceDetails: isPartial ? { lines: varianceLines } : null,
        invoiceNo: req.body.invoiceNo || '',
        invoiceDate: new Date(req.body.invoiceDate),
        invoiceValue,
        challanNo: req.body.challanNo || '',
        vehicleNo,
        ewayBillNumber: (req.body.ewayBillNumber || '').trim(),
        driverName: req.body.driverName || '',
        deliveryDate: req.body.deliveryDate ? new Date(req.body.deliveryDate) : new Date(),
        note: remarks,
        attachments,
        receivedByUserId: req.user._id,
      });

      if (!saveDraft && status !== 'REJECTED') {
        for (const item of items) {
          if (item.quantityReceived <= 0) continue;
          let ledger = await StockLedger.findOne({ siteId, materialId: item.materialId });
          if (!ledger) {
            ledger = await StockLedger.create({
              siteId,
              materialId: item.materialId,
              quantityOnHand: 0,
              lowStockThreshold: 10,
            });
          }
          ledger.quantityOnHand += item.quantityReceived;
          ledger.lastMovementAt = new Date();
          await ledger.save();
          await StockMovement.create({
            siteId,
            materialId: item.materialId,
            materialRequestId: pr?.materialRequestId || null,
            quantityDelta: item.quantityReceived,
            type: 'INCOMING',
            actorUserId: req.user._id,
          });
        }
      }

      const fulfillment = await syncPoFulfillment(po, req.user._id);

      if (!saveDraft && pr?.materialRequestId && status !== 'REJECTED') {
        const mr = await MaterialRequest.findById(pr.materialRequestId);
        if (
          mr &&
          fulfillment.fulfillmentStatus === 'closed_complete' &&
          ['CHAIRMAN_APPROVED', 'PO_CREATED', 'COORDINATOR_VERIFIED', 'MATERIAL_RECEIVED'].includes(mr.status)
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
            req.user._id,
            `GRN ${grnNumber} — material received at store`
          );
          const storeUsers = await User.find({
            role: UserRole.STORE_INCHARGE,
            assignedSiteId: siteId,
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

      if (!saveDraft && status !== 'REJECTED') {
        const populatedPo = await PurchaseOrder.findById(po._id).populate('vendorId');
        const { createBillFromGrn } = require('../services/financeService');
        await createBillFromGrn(
          grn,
          populatedPo,
          populatedPo?.vendorId,
          projectId,
          req.user._id
        );
      }

      const populated = await GoodsReceiptNote.findById(grn._id)
        .populate('purchaseOrderId')
        .populate('items.materialId');
      const responseGrn = {
        id: populated._id.toString(),
        grnNumber: populated.grnNumber,
        status: populated.status,
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

module.exports = router;
