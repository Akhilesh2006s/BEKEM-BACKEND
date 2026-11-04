const express = require('express');
const mongoose = require('mongoose');
const { body, param } = require('express-validator');
const {
  MaterialIssue,
  MaterialRequest,
  StatusHistory,
  StockMovement,
} = require('../models');
const { authenticate } = require('../middleware/auth');
const { requireCapability } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { generateIssueNumber } = require('../services/documentNumberService');
const { getIndentLineItems } = require('../services/materialRequestHelpers');
const notificationService = require('../services/notificationService');
const { ISSUE_REASONS } = require('../constants/indentPolicy');
const { serializeMaterialRequestEnriched } = require('../utils/serialize');
const { consumeFifo, consumeReservedFifo } = require('../services/fifoStockService');

const router = express.Router();
router.use(authenticate);

const issuePopulate = [
  { path: 'items.materialId' },
  { path: 'siteId' },
  { path: 'materialRequestId', select: 'indentNumber purpose' },
  { path: 'issuedByUserId', select: 'name' },
];

function serializeIssue(issue) {
  return {
    id: issue._id.toString(),
    issueNumber: issue.issueNumber,
    materialRequestId: issue.materialRequestId?._id?.toString() || issue.materialRequestId?.toString(),
    materialRequest: issue.materialRequestId?.indentNumber
      ? {
          id: issue.materialRequestId._id.toString(),
          indentNumber: issue.materialRequestId.indentNumber,
          purpose: issue.materialRequestId.purpose,
        }
      : undefined,
    siteId: issue.siteId?._id?.toString() || issue.siteId?.toString(),
    site: issue.siteId?.name
      ? {
          id: issue.siteId._id.toString(),
          name: issue.siteId.name,
          chainageLabel: issue.siteId.chainageLabel,
        }
      : undefined,
    items: issue.items.map((item) => {
      const mat = item.materialId;
      const quantity = Number(item.quantity) || 0;
      const rate = Number(mat?.referenceUnitPrice ?? mat?.unitPrice ?? 0);
      const gstPercent = Number(mat?.gstRate ?? 18);
      const taxable = Math.round((quantity * rate + Number.EPSILON) * 100) / 100;
      const gstAmount = Math.round((taxable * (gstPercent / 100) + Number.EPSILON) * 100) / 100;
      const grossAmount = Math.round((taxable + gstAmount + Number.EPSILON) * 100) / 100;
      return {
        materialId: mat?._id?.toString() || mat?.toString(),
        quantity,
        rate,
        gstPercent,
        gstAmount,
        taxableAmount: taxable,
        grossAmount,
        unit: mat?.unit || '',
        material: mat?.name
          ? {
              id: mat._id.toString(),
              name: mat.name,
              unit: mat.unit,
              hsnCode: mat.hsnCode,
              gstRate: mat.gstRate,
              referenceUnitPrice: mat.referenceUnitPrice,
            }
          : undefined,
      };
    }),
    issuedBy: issue.issuedByUserId?.name
      ? { id: issue.issuedByUserId._id.toString(), name: issue.issuedByUserId.name }
      : undefined,
    issuedToType: issue.issuedToType,
    issuedToName: issue.issuedToName || '',
    note: issue.note,
    issueReason: issue.issueReason,
    issueReasonOtherText: issue.issueReasonOtherText || '',
    issueType: issue.issueType,
    issuedAt: (issue.issuedAt || issue.createdAt)?.toISOString?.(),
    attachments: (issue.attachments || []).map((a) => ({
      name: a.name,
      fileType: a.fileType,
      category: a.category,
      url: a.url || '',
    })),
    createdAt: issue.createdAt?.toISOString?.(),
  };
}

router.get('/', async (req, res, next) => {
  try {
    const { resolveRegisterSiteFilter, applySiteFilterToQuery } = require('../services/registerScopeService');
    const scope = await resolveRegisterSiteFilter(req.user, req.query.siteId);
    const filter = {};
    if (!applySiteFilterToQuery(filter, scope)) {
      return res.json({ data: [] });
    }

    const issues = await MaterialIssue.find(filter)
      .sort({ issuedAt: -1, createdAt: -1 })
      .populate(issuePopulate)
      .limit(100);

    const { StockBatch, GoodsReceiptNote } = require('../models');
    const siteIds = [...new Set(issues.map((i) => i.siteId?._id || i.siteId).filter(Boolean))];
    const materialIds = [
      ...new Set(
        issues.flatMap((i) => i.items.map((it) => it.materialId?._id || it.materialId).filter(Boolean))
      ),
    ];

    const batches =
      siteIds.length && materialIds.length
        ? await StockBatch.find({
            siteId: { $in: siteIds },
            materialId: { $in: materialIds },
            grnId: { $ne: null },
          })
            .sort({ receivedAt: -1 })
            .select('siteId materialId grnId')
            .lean()
        : [];

    const grnIds = [...new Set(batches.map((b) => b.grnId).filter(Boolean))];
    const grns = grnIds.length
      ? await GoodsReceiptNote.find({ _id: { $in: grnIds } })
          .select('invoiceNo invoiceDate items')
          .lean()
      : [];
    const grnById = new Map(grns.map((g) => [g._id.toString(), g]));

    const latestGrnBySiteMaterial = new Map();
    for (const batch of batches) {
      const key = `${batch.siteId.toString()}::${batch.materialId.toString()}`;
      if (!latestGrnBySiteMaterial.has(key)) {
        latestGrnBySiteMaterial.set(key, grnById.get(batch.grnId?.toString?.() || ''));
      }
    }

    const data = issues.map((issue) => {
      const serialized = serializeIssue(issue);
      const siteId = (issue.siteId?._id || issue.siteId)?.toString?.() || '';
      serialized.items = serialized.items.map((item) => {
        const grn = latestGrnBySiteMaterial.get(`${siteId}::${item.materialId}`);
        const grnLine = (grn?.items || []).find(
          (line) => (line.materialId?._id || line.materialId)?.toString?.() === item.materialId
        );
        const rateFromGrn = Number(grnLine?.invoiceUnitPrice || grnLine?.orderedUnitPrice || 0);
        const rate = rateFromGrn > 0 ? rateFromGrn : item.rate;
        const quantity = Number(item.quantity) || 0;
        const gstPercent = Number(item.gstPercent ?? 18);
        const taxable = Math.round((quantity * rate + Number.EPSILON) * 100) / 100;
        const gstAmount = Math.round((taxable * (gstPercent / 100) + Number.EPSILON) * 100) / 100;
        const grossAmount = Math.round((taxable + gstAmount + Number.EPSILON) * 100) / 100;
        return {
          ...item,
          rate,
          gstAmount,
          taxableAmount: taxable,
          grossAmount,
          invoiceNo: grn?.invoiceNo || '',
          invoiceDate: grn?.invoiceDate?.toISOString?.() || null,
        };
      });
      return serialized;
    });

    res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', param('id').isMongoId(), validate, async (req, res, next) => {
  try {
    const { resolveRegisterSiteFilter, applySiteFilterToQuery } = require('../services/registerScopeService');
    const filter = { _id: req.params.id };
    const scope = await resolveRegisterSiteFilter(req.user);
    if (!applySiteFilterToQuery(filter, scope)) return res.status(404).json({ statusCode: 404, message: 'Not found' });
    const issue = await MaterialIssue.findOne(filter).populate(issuePopulate);
    if (!issue) return res.status(404).json({ statusCode: 404, message: 'Not found' });
    res.json({ data: serializeIssue(issue) });
  } catch (err) {
    next(err);
  }
});

const populateFields = [
  { path: 'items.materialId' },
  { path: 'materialId' },
  { path: 'siteId' },
  { path: 'projectId' },
  { path: 'requestedByUserId', select: 'name' },
];

router.post(
  '/',
  requireCapability('ISSUE_MATERIAL'),
  [
    body('materialRequestId').isMongoId(),
    body('items').optional().isArray({ min: 1 }),
    body('items.*.materialId').optional().isMongoId(),
    body('items.*.quantity').optional().isFloat({ min: 0.01 }),
    body('reason').isIn(ISSUE_REASONS).withMessage('Issue reason is required'),
    body('issueType').isIn(['WORK_ISSUE', 'CONTRACT_ISSUE']).withMessage('Issue type is required'),
    body('issuedToType').optional().isIn(['EMPLOYEE', 'CONTRACTOR']),
    body('issuedToName').trim().notEmpty().withMessage('Issued to name is required'),
    body('issuedAt').optional().isISO8601(),
    body('reasonOtherText').optional().trim(),
    body('note').optional().trim(),
    body('remark').optional().trim(),
    body('attachments').optional().isArray(),
    body('attachments.*.name').optional().isString(),
    body('attachments.*.fileType').optional().isString(),
    body('attachments.*.category').optional().isString(),
    body('attachments.*.dataBase64').optional().isString(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const { resolveRegisterSiteFilter, applySiteFilterToQuery } = require('../services/registerScopeService');
      const filter = { _id: req.body.materialRequestId };
      const scope = await resolveRegisterSiteFilter(req.user);
      if (!applySiteFilterToQuery(filter, scope)) return res.status(404).json({ statusCode: 404, message: 'Indent not found' });
      const mr = await MaterialRequest.findOne(filter).populate(
        'items.materialId'
      );
      if (!mr) return res.status(404).json({ statusCode: 404, message: 'Indent not found' });

      const issueable = ['MATERIAL_RECEIVED', 'CHAIRMAN_APPROVED', 'ALLOCATED', 'ISSUED', 'PARTIALLY_ISSUED'];
      if (!issueable.includes(mr.status)) {
        return res.status(400).json({
          statusCode: 400,
          message: 'Indent is not ready for issue. Complete GRN receipt first if PO was raised.',
        });
      }

      const reason = req.body.reason;
      if (reason === 'other') {
        const otherText = String(req.body.reasonOtherText || '').trim();
        if (!otherText) {
          return res.status(400).json({
            statusCode: 400,
            message: 'Please provide details when reason is Other',
          });
        }
      }

      const issueType = req.body.issueType;
      const issuedToType =
        issueType === 'CONTRACT_ISSUE' ? 'CONTRACTOR' : 'EMPLOYEE';
      if (!String(req.body.issuedToName || '').trim()) {
        return res.status(400).json({
          statusCode: 400,
          message:
            issueType === 'CONTRACT_ISSUE'
              ? 'Contractor name is required for Contract Issue'
              : 'Employee name is required for Work Issue',
        });
      }

      let issueItems = req.body.items;
      if (!issueItems?.length) {
        const lines = getIndentLineItems(mr);
        issueItems = lines.map((line) => ({
          materialId: line.materialId._id || line.materialId,
          quantity: line.quantityAllocated || line.quantityRequested,
        }));
      }

      for (const item of issueItems) {
        const qty = Number(item.quantity) || 0;
        if (qty <= 0) {
          return res.status(400).json({
            statusCode: 400,
            message: 'Issue quantity must be greater than zero',
          });
        }
        const line = getIndentLineItems(mr).find((li) => {
          const mid = li.materialId._id?.toString?.() || li.materialId.toString();
          return mid === String(item.materialId);
        });
        if (!line) {
          return res.status(400).json({
            statusCode: 400,
            message: 'Issue item is not part of this indent',
          });
        }
        const remaining = Math.max(
          0,
          Number(line.quantityRequested || 0) - Number(line.quantityIssued || 0)
        );
        if (qty > remaining + 1e-9) {
          return res.status(400).json({
            statusCode: 400,
            message: `Cannot issue more than remaining request (${remaining}) for this material`,
          });
        }
      }

      const issueNumber = await generateIssueNumber();
      const issuedAt = req.body.issuedAt ? new Date(req.body.issuedAt) : new Date();
      if ((req.body.attachments || []).some((a) => a?.category === 'CONTRACTOR_ACK' && !a.dataBase64)) {
        return res.status(400).json({ statusCode: 400, message: 'The contractor acknowledgement file must be uploaded' });
      }
      const issuePayload = {
        issueNumber,
        materialRequestId: mr._id,
        siteId: mr.siteId,
        items: issueItems,
        issuedByUserId: req.user._id,
        issueReason: reason,
        issueReasonOtherText: reason === 'other' ? String(req.body.reasonOtherText || '').trim() : '',
        issueType,
        issuedToType,
        issuedToName: req.body.issuedToName.trim(),
        issuedAt,
        note: req.body.note || req.body.remark || '',
        attachments: require('../services/grnFileService').persistGrnAttachments(req.body.attachments || []),
      };

      // Stock, the issue slip, the indent and its history must commit together.
      // Never fall back to non-transactional writes: a failed issue must not
      // leave a slip or consume only part of a multi-line request.
      const session = await mongoose.startSession();
      let issue;
      try {
        await session.withTransaction(async () => {
          const current = await MaterialRequest.findById(mr._id).session(session).populate('items.materialId');
          if (!current || !issueable.includes(current.status)) {
            const err = new Error('Indent is no longer ready for issue'); err.statusCode = 400; throw err;
          }
          const quantities = new Map();
          for (const item of issueItems) {
            const key = String(item.materialId);
            quantities.set(key, (quantities.get(key) || 0) + Number(item.quantity));
          }
          for (const [materialId, quantity] of quantities) {
            const line = getIndentLineItems(current).find((li) => String(li.materialId?._id || li.materialId) === materialId);
            if (!line || quantity > Number(line.quantityRequested || 0) - Number(line.quantityIssued || 0) + 1e-9) {
              const err = new Error('Cannot issue more than the remaining request'); err.statusCode = 400; throw err;
            }
            const debits = await StockMovement.find({ siteId: current.siteId, materialId, materialRequestId: current._id, type: 'ALLOCATION', quantityDelta: { $lt: 0 } }).session(session).lean();
            const alreadyDebited = debits.reduce((sum, entry) => sum - Number(entry.quantityDelta || 0), 0);
            const reserved = Math.min(quantity, Math.max(0, alreadyDebited - Number(line.quantityIssued || 0)));
            if (reserved > 0) await consumeReservedFifo({ siteId: current.siteId, materialId, quantity: reserved, session });
            if (quantity > reserved) await consumeFifo({ siteId: current.siteId, materialId, quantity: quantity - reserved, actorUserId: req.user._id, materialRequestId: current._id, session });
            line.quantityIssued = Number(line.quantityIssued || 0) + quantity;
            line.quantityAllocated = Math.max(Number(line.quantityAllocated || 0), line.quantityIssued);
          }
          const fromStatus = current.status;
          const fullyIssued = getIndentLineItems(current).every((line) => Number(line.quantityIssued || 0) >= Number(line.quantityRequested || 0));
          current.status = fullyIssued ? 'ISSUED' : 'PARTIALLY_ISSUED';
          current.pendingWithRole = fullyIssued ? 'SITE_INCHARGE' : 'STORE_INCHARGE';
          await current.save({ session });
          [issue] = await MaterialIssue.create([issuePayload], { session });
          const reasonLabel = reason === 'other' ? req.body.reasonOtherText : reason.replace(/_/g, ' ');
          await StatusHistory.create([{ entityType: 'MaterialRequest', entityId: current._id, fromStatus, toStatus: current.status, actorUserId: req.user._id, note: `Materials issued — ${issueNumber}${fullyIssued ? '' : ' (partial)'}. Reason: ${reasonLabel}`, timestamp: new Date() }], { session });
        });
      } catch (err) {
        if (err.code === 20 || err.codeName === 'IllegalOperation') {
          const unavailable = new Error('Material issue requires a MongoDB replica set for safe stock updates');
          unavailable.statusCode = 503; throw unavailable;
        }
        throw err;
      } finally {
        await session.endSession();
      }

      try {
        await notificationService.notifyUser(mr.requestedByUserId, {
          title: 'Materials issued to site',
          body: `Indent ${mr.indentNumber} materials have been issued.`,
          relatedEntityType: 'MaterialRequest',
          relatedEntityId: mr._id,
        });
      } catch (err) {
        console.error('Issue notification failed after commit:', err.message);
      }

      const populated = await MaterialRequest.findById(mr._id).populate(populateFields);
      res.status(201).json({
        data: {
          issue: { id: issue._id.toString(), issueNumber },
          indent: await serializeMaterialRequestEnriched(populated),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
