const express = require('express');
const { param } = require('express-validator');
const { UserRole } = require('@afios/shared');
const {
  StockLedger,
  StockMovement,
  MaterialRequest,
  PurchaseOrder,
  PurchaseRequest,
  GoodsReceiptNote,
  DeliveryVerification,
  Site,
} = require('../models');
const { authenticate } = require('../middleware/auth');
const { userCanAccessSite } = require('../utils/serialize');
const { getFinancialYear } = require('../services/procurementReferenceService');
const { validate } = require('../middleware/validate');

const router = express.Router();

router.use(authenticate);

router.get('/site/:siteId', async (req, res, next) => {
  try {
    const siteId = req.params.siteId;
    if (!userCanAccessSite(req.user, siteId)) {
      return res.status(403).json({ statusCode: 403, message: 'Forbidden' });
    }

    const ledgers = await StockLedger.find({ siteId }).populate('materialId');
    res.json({
      data: ledgers.map((l) => ({
        id: l._id.toString(),
        siteId: l.siteId.toString(),
        materialId: l.materialId._id?.toString() || l.materialId.toString(),
        quantityOnHand: l.quantityOnHand,
        quantityReserved: l.quantityReserved || 0,
        availableQty: Math.max(0, l.quantityOnHand - (l.quantityReserved || 0)),
        lowStockThreshold: l.lowStockThreshold,
        lastMovementAt: l.lastMovementAt.toISOString(),
        material: {
          id: l.materialId._id.toString(),
          code: l.materialId.code,
          name: l.materialId.name,
          description: l.materialId.description || '',
          unit: l.materialId.unit,
          grade: l.materialId.grade || '',
          category: l.materialId.category || '',
        },
        isLowStock: l.quantityOnHand <= l.lowStockThreshold,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/site/:siteId/po-index', async (req, res, next) => {
  try {
    const siteId = req.params.siteId;
    if (!userCanAccessSite(req.user, siteId)) {
      return res.status(403).json({ statusCode: 403, message: 'Forbidden' });
    }

    const site = await Site.findById(siteId);
    if (!site) return res.status(404).json({ statusCode: 404, message: 'Site not found' });

    const purchaseRequests = await PurchaseRequest.find({ projectId: site.projectId }).select('_id');
    const prIds = purchaseRequests.map((p) => p._id);
    const orders = await PurchaseOrder.find({
      purchaseRequestId: { $in: prIds },
      status: 'APPROVED',
    })
      .sort({ createdAt: -1 })
      .populate([
        { path: 'vendorId' },
        { path: 'purchaseRequestId', populate: { path: 'projectId' } },
      ]);

    const poIds = orders.map((o) => o._id);
    const [grns, verifications, ledgers] = await Promise.all([
      GoodsReceiptNote.find({ purchaseOrderId: { $in: poIds } }),
      DeliveryVerification.find({ purchaseOrderId: { $in: poIds } }),
      StockLedger.find({ siteId }).populate('materialId'),
    ]);

    const grnByPo = new Map(grns.map((g) => [g.purchaseOrderId.toString(), g]));
    const verifyByPo = new Map(verifications.map((v) => [v.purchaseOrderId.toString(), v]));
    const stockByMaterial = new Map(
      ledgers.map((l) => [l.materialId._id.toString(), l])
    );

    const rows = [];
    let slNo = 1;
    for (const po of orders) {
      const project = po.purchaseRequestId?.projectId;
      const grn = grnByPo.get(po._id.toString());
      const verified = verifyByPo.get(po._id.toString());
      const lineItems = po.lineItems?.length ? po.lineItems : [];

      for (const line of lineItems) {
        const materialId = line.materialId?._id?.toString() || line.materialId?.toString();
        const ledger = materialId ? stockByMaterial.get(materialId) : null;
        const grnLine = grn?.items?.find(
          (i) => i.materialId.toString() === materialId
        );

        let receiptStatus = 'Awaiting delivery';
        if (grn?.status === 'RECEIVED' || grn?.status === 'PARTIALLY_RECEIVED') {
          receiptStatus = 'Received';
        } else if (grn?.status === 'DRAFT') {
          receiptStatus = 'GRN draft';
        } else if (verified) {
          receiptStatus = 'Pending GRN';
        } else {
          receiptStatus = 'Pending verification';
        }

        rows.push({
          slNo: slNo++,
          purchaseOrderId: po._id.toString(),
          projectCode: project?.code || '',
          projectName: project?.name || '',
          supplier: po.vendorId?.name || '',
          vendorCode: po.vendorId?.code || '',
          poNo: po.procurementRef || po.poNumber || po.draftRef,
          displayPoNumber: po.poSeq ? String(po.poSeq).padStart(4, '0') : '—',
          procurementRef: po.procurementRef || '',
          financialYear: po.financialYear || getFinancialYear(po.createdAt),
          poDate: po.createdAt?.toISOString?.(),
          materialName: line.description,
          materialId,
          orderedQty: line.quantity,
          receivedQty: grnLine?.quantityReceived ?? 0,
          stockOnHand: ledger?.quantityOnHand ?? 0,
          unit: ledger?.materialId?.unit || '',
          invoiceNo: grn?.invoiceNo || '',
          challanNo: grn?.challanNo || '',
          grnNumber: grn?.grnNumber || '',
          grnStatus: grn?.status || '',
          receiptStatus,
          verified: Boolean(verified),
        });
      }

      if (!lineItems.length) {
        rows.push({
          slNo: slNo++,
          purchaseOrderId: po._id.toString(),
          projectCode: project?.code || '',
          projectName: project?.name || '',
          supplier: po.vendorId?.name || '',
          vendorCode: po.vendorId?.code || '',
          poNo: po.procurementRef || po.poNumber || po.draftRef,
          displayPoNumber: po.poSeq ? String(po.poSeq).padStart(4, '0') : '—',
          procurementRef: po.procurementRef || '',
          financialYear: po.financialYear || getFinancialYear(po.createdAt),
          poDate: po.createdAt?.toISOString?.(),
          materialName: '—',
          materialId: null,
          orderedQty: 0,
          receivedQty: 0,
          stockOnHand: 0,
          unit: '',
          invoiceNo: grn?.invoiceNo || '',
          challanNo: grn?.challanNo || '',
          grnNumber: grn?.grnNumber || '',
          grnStatus: grn?.status || '',
          receiptStatus: verified ? 'Pending GRN' : 'Pending verification',
          verified: Boolean(verified),
        });
      }
    }

    res.json({ data: rows, financialYear: getFinancialYear() });
  } catch (err) {
    next(err);
  }
});

/** Fields after Delivery Date — full access for Coordinator / Chairman only. */
const INVENTORY_RESTRICTED_FIELDS = [
  'advancePaid',
  'invoiceNumber',
  'invoiceDate',
  'qtyReceived',
  'qtyBalance',
  'qtyAvailable',
  'invoiceAmount',
  'deliveryLocation',
  'transport',
  'materialReceived',
  'invoiceEntry',
  'purpose',
];

function hasFullInventoryAccess(role) {
  return [UserRole.COORDINATOR, UserRole.CHAIRMAN, UserRole.EXECUTIVE].includes(role);
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Late when actual delivery (or today if not delivered) is after expected delivery date. */
function isDeliveryLate(expectedDeliveryDate, deliveryDate) {
  if (!expectedDeliveryDate) return false;
  const expected = startOfDay(expectedDeliveryDate);
  const compare = deliveryDate ? startOfDay(deliveryDate) : startOfDay(new Date());
  return compare.getTime() > expected.getTime();
}

function serializeInventoryRecord(r, role) {
  const expectedDeliveryDate = r.expectedDeliveryDate?.toISOString?.() || null;
  const deliveryDate = r.deliveryDate?.toISOString?.() || null;
  const late = isDeliveryLate(r.expectedDeliveryDate, r.deliveryDate);

  const full = {
    id: r._id.toString(),
    poSlNo: r.poSlNo,
    project: r.project,
    indentNo: r.indentNo,
    date: r.recordDate?.toISOString?.() || null,
    supplier: r.supplier,
    poNo: r.poNo,
    poDate: r.poDate?.toISOString?.() || null,
    itemCode: r.itemCode,
    itemDescription: r.itemDescription,
    qty: r.qty,
    units: r.units,
    poQty: r.poQty,
    unitRate: r.unitRate,
    basicTotal: r.basicTotal,
    gst: r.gst,
    netTotal: r.netTotal,
    deliveryDate,
    expectedDeliveryDate,
    isDeliveryLate: late,
    delayReason: r.delayReason || '',
    delayReasonUpdatedAt: r.delayReasonUpdatedAt?.toISOString?.() || null,
    delayReasonBy: r.delayReasonByUserId?.name
      ? { id: r.delayReasonByUserId._id.toString(), name: r.delayReasonByUserId.name }
      : undefined,
    advancePaid: r.advancePaid,
    invoiceNumber: r.invoiceNumber,
    invoiceDate: r.invoiceDate?.toISOString?.() || null,
    qtyReceived: r.qtyReceived,
    qtyBalance: r.qtyBalance,
    qtyAvailable: r.qtyAvailable,
    invoiceAmount: r.invoiceAmount,
    deliveryLocation: r.deliveryLocation,
    transport: r.transport,
    materialReceived: r.materialReceived,
    invoiceEntry: r.invoiceEntry,
    purpose: r.purpose,
    financialYear: r.financialYear,
  };

  if (hasFullInventoryAccess(role)) return full;

  // Store Manager: through delivery date + delay reason (for late deliveries)
  const limited = { ...full };
  for (const field of INVENTORY_RESTRICTED_FIELDS) {
    delete limited[field];
  }
  return limited;
}

router.get('/inventory', async (req, res, next) => {
  try {
    const { StockInventoryRecord } = require('../models');
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(10, parseInt(req.query.limit, 10) || 50));
    const search = (req.query.search || '').trim();
    const project = (req.query.project || '').trim();
    const financialYear = (req.query.financialYear || '25-26').trim();

    const filter = { financialYear };
    if (project) filter.project = new RegExp(project, 'i');
    if (search) {
      filter.$or = [
        { poNo: { $regex: search, $options: 'i' } },
        { supplier: { $regex: search, $options: 'i' } },
        { project: { $regex: search, $options: 'i' } },
        { itemDescription: { $regex: search, $options: 'i' } },
        { itemCode: { $regex: search, $options: 'i' } },
        { invoiceNumber: { $regex: search, $options: 'i' } },
      ];
    }

    const [total, records, projects, latestImport] = await Promise.all([
      StockInventoryRecord.countDocuments(filter),
      StockInventoryRecord.find(filter)
        .sort({ poSlNo: 1, poNo: 1, itemDescription: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('delayReasonByUserId', 'name'),
      StockInventoryRecord.distinct('project', { financialYear }),
      StockInventoryRecord.findOne({ financialYear }).sort({ createdAt: -1 }).select('createdAt'),
    ]);

    const fullAccess = hasFullInventoryAccess(req.user.role);
    res.json({
      data: records.map((r) => serializeInventoryRecord(r, req.user.role)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        financialYear,
        projects: projects.filter(Boolean).sort(),
        importedAt: latestImport?.createdAt?.toISOString?.() || null,
        ledgerType: 'historical',
        liveLedgerPath: '/store',
        fieldAccess: fullAccess ? 'full' : 'through_delivery_date',
      },
    });
  } catch (err) {
    next(err);
  }
});

const inventoryEditableFieldsThroughDelivery = [
  'poSlNo',
  'project',
  'indentNo',
  'supplier',
  'poNo',
  'itemCode',
  'itemDescription',
  'qty',
  'units',
  'poQty',
  'unitRate',
  'basicTotal',
  'gst',
  'netTotal',
  'delayReason',
];

const inventoryEditableFieldsFull = [
  ...inventoryEditableFieldsThroughDelivery,
  'advancePaid',
  'invoiceNumber',
  'qtyReceived',
  'qtyBalance',
  'qtyAvailable',
  'invoiceAmount',
  'deliveryLocation',
  'transport',
  'materialReceived',
  'invoiceEntry',
  'purpose',
];

const inventoryDateFieldsThroughDelivery = [
  'recordDate',
  'poDate',
  'deliveryDate',
  'expectedDeliveryDate',
];
const inventoryDateFieldsFull = [...inventoryDateFieldsThroughDelivery, 'invoiceDate'];

router.patch(
  '/inventory/:id',
  param('id').isMongoId(),
  validate,
  async (req, res, next) => {
    try {
      const canEdit = [
        UserRole.STORE_INCHARGE,
        UserRole.COORDINATOR,
        UserRole.EXECUTIVE,
        UserRole.CHAIRMAN,
      ].includes(req.user.role);
      if (!canEdit) {
        return res.status(403).json({ statusCode: 403, message: 'Forbidden' });
      }

      const fullAccess = hasFullInventoryAccess(req.user.role);
      const editableFields = fullAccess
        ? inventoryEditableFieldsFull
        : inventoryEditableFieldsThroughDelivery;
      const dateFields = fullAccess ? inventoryDateFieldsFull : inventoryDateFieldsThroughDelivery;

      const { StockInventoryRecord } = require('../models');
      const record = await StockInventoryRecord.findById(req.params.id);
      if (!record) {
        return res.status(404).json({ statusCode: 404, message: 'Record not found' });
      }

      for (const field of editableFields) {
        if (req.body[field] !== undefined) {
          record[field] = req.body[field];
        }
      }
      if (req.body.date !== undefined) {
        record.recordDate = req.body.date ? new Date(req.body.date) : null;
      }
      for (const field of dateFields) {
        if (field === 'recordDate') continue;
        if (req.body[field] !== undefined) {
          record[field] = req.body[field] ? new Date(req.body[field]) : null;
        }
      }

      if (req.body.delayReason !== undefined) {
        record.delayReason = String(req.body.delayReason || '').trim();
        record.delayReasonUpdatedAt = new Date();
        record.delayReasonByUserId = req.user._id;
      }

      await record.save();
      await record.populate('delayReasonByUserId', 'name');
      res.json({ data: serializeInventoryRecord(record, req.user.role) });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/site/:siteId/summary', async (req, res, next) => {
  try {
    const siteId = req.user.assignedSiteId || req.params.siteId;
    if (!userCanAccessSite(req.user, siteId)) {
      return res.status(403).json({ statusCode: 403, message: 'Forbidden' });
    }

    const ledgers = await StockLedger.find({ siteId });
    const lowStock = ledgers.filter((l) => l.quantityOnHand <= l.lowStockThreshold).length;
    const pendingRequests = await MaterialRequest.countDocuments({
      siteId,
      status: 'PENDING_STORE',
    });

    const incoming = await MaterialRequest.countDocuments({
      siteId,
      status: { $in: ['PO_CREATED', 'COORDINATOR_VERIFIED', 'CHAIRMAN_APPROVED'] },
    });

    res.json({
      data: {
        waiting: pendingRequests,
        stockItems: ledgers.length,
        lowStock,
        incoming,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/site/:siteId/movements', async (req, res, next) => {
  try {
    const siteId = req.params.siteId;
    if (!userCanAccessSite(req.user, siteId)) {
      return res.status(403).json({ statusCode: 403, message: 'Forbidden' });
    }

    const movements = await StockMovement.find({ siteId, type: 'ALLOCATION' })
      .sort({ timestamp: -1 })
      .limit(50)
      .populate('materialId')
      .populate('actorUserId', 'name');

    res.json({
      data: movements.map((m) => ({
        id: m._id.toString(),
        siteId: m.siteId.toString(),
        materialId: m.materialId._id.toString(),
        materialRequestId: m.materialRequestId?.toString() || null,
        quantityDelta: m.quantityDelta,
        type: m.type,
        actorUserId: m.actorUserId._id.toString(),
        actorName: m.actorUserId.name,
        timestamp: m.timestamp.toISOString(),
        material: {
          id: m.materialId._id.toString(),
          code: m.materialId.code,
          name: m.materialId.name,
          unit: m.materialId.unit,
        },
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/my-site', async (req, res, next) => {
  try {
    if (![UserRole.STORE_INCHARGE, UserRole.SITE_INCHARGE].includes(req.user.role)) {
      return res.status(403).json({ statusCode: 403, message: 'Forbidden' });
    }
    req.params.siteId = req.user.assignedSiteId.toString();
    return router.handle(
      { ...req, url: `/site/${req.user.assignedSiteId}`, method: 'GET' },
      res,
      next
    );
  } catch (err) {
    next(err);
  }
});

module.exports = router;
