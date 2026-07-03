const express = require('express');
const { body, param } = require('express-validator');
const {
  DeliveryVerification,
  PurchaseOrder,
  PurchaseRequest,
  Site,
} = require('../models');
const { authenticate } = require('../middleware/auth');
const { requireCapability } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const notificationService = require('../services/notificationService');
const { UserRole } = require('@afios/shared');
const { User } = require('../models');

const router = express.Router();
router.use(authenticate);

router.get('/pending', async (req, res, next) => {
  try {
    const verifiedIds = await DeliveryVerification.distinct('purchaseOrderId');
    const orders = await PurchaseOrder.find({
      status: 'APPROVED',
      _id: { $nin: verifiedIds },
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

router.post(
  '/',
  requireCapability('VERIFY_DELIVERY'),
  [
    body('purchaseOrderId').isMongoId(),
    body('items').isArray({ min: 1 }),
    body('items.*.materialId').isMongoId(),
    body('items.*.quantityOrdered').isFloat({ min: 0 }),
    body('items.*.quantityVerified').isFloat({ min: 0 }),
    body('items.*.condition').optional().isIn(['OK', 'DAMAGED', 'SHORT']),
    body('remarks').optional().trim(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const po = await PurchaseOrder.findById(req.body.purchaseOrderId).populate({
        path: 'purchaseRequestId',
        populate: { path: 'projectId' },
      });
      if (!po) return res.status(404).json({ statusCode: 404, message: 'PO not found' });
      if (po.status !== 'APPROVED') {
        return res.status(400).json({ statusCode: 400, message: 'PO must be approved before verification' });
      }

      const existing = await DeliveryVerification.findOne({ purchaseOrderId: po._id });
      if (existing) {
        return res.status(400).json({ statusCode: 400, message: 'Delivery already verified for this PO' });
      }

      const siteId = req.user.assignedSiteId;
      if (!siteId) {
        return res.status(400).json({ statusCode: 400, message: 'No assigned site for verification' });
      }

      const verification = await DeliveryVerification.create({
        purchaseOrderId: po._id,
        siteId,
        items: req.body.items.map((i) => ({
          materialId: i.materialId,
          quantityOrdered: i.quantityOrdered,
          quantityVerified: i.quantityVerified,
          condition: i.condition || 'OK',
        })),
        remarks: req.body.remarks || '',
        verifiedByUserId: req.user._id,
      });

      const coordinators = await User.find({ role: UserRole.COORDINATOR });
      await notificationService.notifyUsers(
        coordinators.map((u) => u._id),
        {
          title: 'Delivery verified — create GRN',
          body: `${po.procurementRef || po.poNumber} physically verified at store. Create GRN to update inventory.`,
          relatedEntityType: 'PurchaseOrder',
          relatedEntityId: po._id,
        }
      );

      res.status(201).json({
        data: {
          id: verification._id.toString(),
          purchaseOrderId: po._id.toString(),
          status: verification.status,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/:purchaseOrderId', param('purchaseOrderId').isMongoId(), validate, async (req, res, next) => {
  try {
    const verification = await DeliveryVerification.findOne({
      purchaseOrderId: req.params.purchaseOrderId,
    }).populate('items.materialId');
    if (!verification) return res.status(404).json({ statusCode: 404, message: 'Not found' });
    res.json({
      data: {
        id: verification._id.toString(),
        purchaseOrderId: verification.purchaseOrderId.toString(),
        status: verification.status,
        remarks: verification.remarks,
        verifiedAt: verification.verifiedAt?.toISOString?.(),
        items: verification.items.map((i) => ({
          materialId: i.materialId._id.toString(),
          materialName: i.materialId.name,
          quantityOrdered: i.quantityOrdered,
          quantityVerified: i.quantityVerified,
          condition: i.condition,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
