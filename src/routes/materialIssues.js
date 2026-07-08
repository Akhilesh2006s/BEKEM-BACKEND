const express = require('express');
const { body, param } = require('express-validator');
const {
  MaterialIssue,
  MaterialRequest,
} = require('../models');
const { authenticate } = require('../middleware/auth');
const { requireCapability } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { generateIssueNumber } = require('../services/documentNumberService');
const { getIndentLineItems } = require('../services/materialRequestHelpers');
const statusHistoryService = require('../services/statusHistoryService');
const notificationService = require('../services/notificationService');
const { ISSUE_REASONS } = require('../constants/indentPolicy');
const { serializeMaterialRequestEnriched } = require('../utils/serialize');
const { consumeFifo } = require('../services/fifoStockService');

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
    items: issue.items.map((item) => ({
      materialId: item.materialId?._id?.toString() || item.materialId?.toString(),
      quantity: item.quantity,
      material: item.materialId?.name
        ? {
            id: item.materialId._id.toString(),
            name: item.materialId.name,
            unit: item.materialId.unit,
            hsnCode: item.materialId.hsnCode,
          }
        : undefined,
    })),
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
    })),
    createdAt: issue.createdAt?.toISOString?.(),
  };
}

router.get('/', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.siteId) filter.siteId = req.query.siteId;
    const issues = await MaterialIssue.find(filter)
      .sort({ issuedAt: -1, createdAt: -1 })
      .populate(issuePopulate)
      .limit(100);
    res.json({ data: issues.map(serializeIssue) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', param('id').isMongoId(), validate, async (req, res, next) => {
  try {
    const issue = await MaterialIssue.findById(req.params.id).populate(issuePopulate);
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
  ],
  validate,
  async (req, res, next) => {
    try {
      const mr = await MaterialRequest.findById(req.body.materialRequestId).populate(
        'items.materialId'
      );
      if (!mr) return res.status(404).json({ statusCode: 404, message: 'Indent not found' });

      const issueable = ['MATERIAL_RECEIVED', 'CHAIRMAN_APPROVED', 'ALLOCATED'];
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

      const alreadyAllocated = mr.status === 'ALLOCATED';
      const issueNumber = await generateIssueNumber();
      const issuedAt = req.body.issuedAt ? new Date(req.body.issuedAt) : new Date();
      const issue = await MaterialIssue.create({
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
        attachments: Array.isArray(req.body.attachments)
          ? req.body.attachments
              .filter((a) => a?.name)
              .map((a) => ({
                name: a.name,
                fileType: a.fileType || 'application/octet-stream',
                category: a.category || 'ISSUE_SLIP',
              }))
          : [],
      });

      for (const item of issueItems) {
        if (!alreadyAllocated) {
          await consumeFifo({
            siteId: mr.siteId,
            materialId: item.materialId,
            quantity: item.quantity,
            actorUserId: req.user._id,
            materialRequestId: mr._id,
          });
        }

        const line = mr.items.find((li) => li.materialId._id?.toString() === item.materialId.toString() || li.materialId.toString() === item.materialId.toString());
        if (line) line.quantityIssued = (line.quantityIssued || 0) + item.quantity;
      }

      const fromStatus = mr.status;
      mr.status = 'ISSUED';
      mr.pendingWithRole = 'SITE_INCHARGE';
      await mr.save();

      const reasonLabel = reason === 'other' ? req.body.reasonOtherText : reason.replace(/_/g, ' ');
      await statusHistoryService.record(
        'MaterialRequest',
        mr._id,
        fromStatus,
        'ISSUED',
        req.user._id,
        `Materials issued — ${issueNumber}. Reason: ${reasonLabel}`
      );

      await notificationService.notifyUser(mr.requestedByUserId, {
        title: 'Materials issued to site',
        body: `Indent ${mr.indentNumber} materials have been issued.`,
        relatedEntityType: 'MaterialRequest',
        relatedEntityId: mr._id,
      });

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
