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
const { generateGrnNumber } = require('../services/documentNumberService');

const router = express.Router();
router.use(authenticate);

router.get('/pending-purchase-orders', async (req, res, next) => {
  try {
    const { DeliveryVerification } = require('../models');
    const receivedPoIds = await GoodsReceiptNote.distinct('purchaseOrderId', {
      status: { $in: ['RECEIVED', 'PARTIALLY_RECEIVED'] },
    });
    const verifiedPoIds = await DeliveryVerification.distinct('purchaseOrderId');
    const orders = await PurchaseOrder.find({
      status: 'APPROVED',
      _id: { $in: verifiedPoIds, $nin: receivedPoIds },
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
    body('items.*.lineStatus').optional().isIn(['RECEIVED', 'PARTIAL', 'REJECTED']),
    body('note').optional().trim(),
    body('remarks').optional().trim(),
    body('invoiceNo').optional().trim(),
    body('challanNo').optional().trim(),
    body('vehicleNo').optional().trim(),
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
    try {
      const po = await PurchaseOrder.findById(req.body.purchaseOrderId);
      if (!po) return res.status(404).json({ statusCode: 404, message: 'PO not found' });
      if (po.status !== 'APPROVED') {
        return res.status(400).json({ statusCode: 400, message: 'PO must be approved before receipt' });
      }

      const { DeliveryVerification } = require('../models');
      const verification = await DeliveryVerification.findOne({ purchaseOrderId: po._id });
      if (!verification) {
        return res.status(400).json({
          statusCode: 400,
          message: 'Store must verify physical delivery before GRN can be created',
        });
      }

      const existingGrn = await GoodsReceiptNote.findOne({
        purchaseOrderId: po._id,
        status: { $in: ['RECEIVED', 'PARTIALLY_RECEIVED'] },
      });
      if (existingGrn) {
        return res.status(400).json({
          statusCode: 400,
          message: 'This PO has already been fully received',
        });
      }

      const pr = await PurchaseRequest.findById(po.purchaseRequestId);
      const site =
        (await Site.findOne({ projectId: pr?.projectId })) ||
        (req.user.assignedSiteId ? await Site.findById(req.user.assignedSiteId) : null);
      const siteId = site?._id || req.user.assignedSiteId;
      if (!siteId) {
        return res.status(400).json({ statusCode: 400, message: 'No site for stock update' });
      }

      const grnNumber = await generateGrnNumber();
      const items = req.body.items.map((i) => ({
        materialId: i.materialId,
        quantityOrdered: i.quantityOrdered,
        quantityReceived: i.quantityReceived,
        lineStatus: i.lineStatus || (i.quantityReceived >= i.quantityOrdered ? 'RECEIVED' : 'PARTIAL'),
      }));

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

      const receiveType = req.body.receiveType || 'FULL';
      const remarks = req.body.remarks || req.body.note || '';
      const attachments = Array.isArray(req.body.attachments)
        ? req.body.attachments.filter((a) => a?.name)
        : [];

      const grn = await GoodsReceiptNote.create({
        grnNumber,
        purchaseOrderId: po._id,
        siteId,
        items,
        receivedQuantity: totalReceived,
        status,
        receiveType,
        invoiceNo: req.body.invoiceNo || '',
        challanNo: req.body.challanNo || '',
        vehicleNo: req.body.vehicleNo || '',
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

      if (!saveDraft && pr?.materialRequestId && status !== 'REJECTED') {
        const mr = await MaterialRequest.findById(pr.materialRequestId);
        if (
          mr &&
          ['CHAIRMAN_APPROVED', 'PO_CREATED', 'COORDINATOR_VERIFIED'].includes(mr.status)
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

      const populated = await GoodsReceiptNote.findById(grn._id)
        .populate('purchaseOrderId')
        .populate('items.materialId');
      res.status(201).json({
        data: {
          id: populated._id.toString(),
          grnNumber: populated.grnNumber,
          status: populated.status,
          items: populated.items.map((i) => ({
            materialId: i.materialId._id.toString(),
            materialName: i.materialId.name,
            quantityReceived: i.quantityReceived,
            lineStatus: i.lineStatus,
          })),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
