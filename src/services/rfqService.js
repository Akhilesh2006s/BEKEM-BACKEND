const { UserRole } = require('@afios/shared');
const { RFQ, Quotation, PurchaseRequest, MaterialRequest, Material, Vendor } = require('../models');
const { HO_ROLES } = require('./executiveIndentService');
const { getIndentLineItems } = require('./materialRequestHelpers');
const { DEFAULT_PO_TERMS } = require('../constants/poTerms');
  const { buildPurchaseHistoryRows } = require('./materialPricingService');
const {
  buildComparisonTable,
  upsertRfqQuotations,
  ensureDefaultVendorQuotations,
  computeFinalCost,
  pickL1Quotation,
} = require('./quotationComparisonService');

function assertRfqAccess(user) {
  if (!HO_ROLES.includes(user.role)) {
    const err = new Error('Forbidden');
    err.statusCode = 403;
    throw err;
  }
}

async function loadRfqContext(rfqId) {
  const rfq = await RFQ.findById(rfqId)
    .populate({
      path: 'purchaseRequestId',
      populate: [
        { path: 'materialRequestId', populate: [{ path: 'items.materialId' }, { path: 'projectId' }] },
        { path: 'projectId' },
      ],
    })
    .populate('vendorIds');
  if (!rfq) {
    const err = new Error('RFQ not found');
    err.statusCode = 404;
    throw err;
  }
  const mr = rfq.purchaseRequestId?.materialRequestId;
  const lineItems = mr ? getIndentLineItems(mr) : [];
  const quantity = lineItems.reduce((s, l) => s + (l.quantityRequested || 0), 0) || 1;
  const materialIds = lineItems
    .map((l) => (l.materialId?._id || l.materialId)?.toString())
    .filter(Boolean);
  return { rfq, mr, lineItems, quantity, materialIds };
}

async function buildItemsPayload(lineItems) {
  const items = [];
  for (const line of lineItems) {
    const mat =
      line.materialId && typeof line.materialId === 'object'
        ? line.materialId
        : await Material.findById(line.materialId);
    items.push({
      materialId: mat?._id?.toString() || line.materialId?.toString(),
      name: mat?.name || 'Item',
      code: mat?.code || '',
      quantity: line.quantityRequested,
      unit: line.unit || mat?.unit || 'Nos',
    });
  }
  return items;
}

async function getRfqComparison(rfqId, user) {
  assertRfqAccess(user);
  const { rfq, mr, lineItems, quantity, materialIds } = await loadRfqContext(rfqId);
  await ensureDefaultVendorQuotations(rfq, rfq.purchaseRequestId, materialIds);
  const quotations = await Quotation.find({ rfqId: rfq._id }).populate('vendorId').sort({ amount: 1 });
  const comparison = buildComparisonTable(quotations, quantity);
  const purchaseHistory = await buildPurchaseHistoryRows(lineItems);

  return {
    rfqId: rfq._id.toString(),
    rfqNumber: rfq.rfqNumber,
    status: rfq.status,
    quantity,
    comparison,
    purchaseHistory,
    selectedVendorId: rfq.selectedVendorId?.toString(),
    vendorSelectionReason: rfq.vendorSelectionReason || '',
    whyWeChoseThisVendor: rfq.whyWeChoseThisVendor || '',
    items: await buildItemsPayload(lineItems),
    indentNumber: mr?.indentNumber,
    purchaseRequestId: rfq.purchaseRequestId?._id?.toString(),
  };
}

async function getRfqByPurchaseRequest(purchaseRequestId, user) {
  assertRfqAccess(user);
  const rfq = await RFQ.findOne({ purchaseRequestId });
  if (!rfq) return null;
  return getRfqComparison(rfq._id.toString(), user);
}

async function listRfqs(user) {
  assertRfqAccess(user);
  const rfqs = await RFQ.find()
    .sort({ createdAt: -1 })
    .limit(100)
    .populate({
      path: 'purchaseRequestId',
      populate: { path: 'materialRequestId', select: 'indentNumber origin projectId' },
    })
    .lean();

  return rfqs.map((r) => ({
    id: r._id.toString(),
    rfqNumber: r.rfqNumber,
    status: r.status,
    dueDate: r.dueDate?.toISOString?.() || r.dueDate,
    indentNumber: r.purchaseRequestId?.materialRequestId?.indentNumber,
    purchaseRequestId: r.purchaseRequestId?._id?.toString(),
    createdAt: r.createdAt?.toISOString?.() || r.createdAt,
  }));
}

async function getRfqDetail(rfqId, user) {
  const comparison = await getRfqComparison(rfqId, user);
  const { rfq } = await loadRfqContext(rfqId);
  return {
    id: comparison.rfqId,
    rfqNumber: comparison.rfqNumber,
    status: comparison.status,
    dueDate: rfq.dueDate?.toISOString?.() || null,
    termsAndConditions: [...DEFAULT_PO_TERMS],
    indentNumber: comparison.indentNumber,
    projectCode: rfq.purchaseRequestId?.projectId?.code,
    projectName: rfq.purchaseRequestId?.projectId?.name,
    items: comparison.items,
    quotations: comparison.comparison.vendors,
    comparison: comparison.comparison,
    purchaseHistory: comparison.purchaseHistory,
    selectedVendorId: comparison.selectedVendorId,
    vendorSelectionReason: comparison.vendorSelectionReason,
    whyWeChoseThisVendor: comparison.whyWeChoseThisVendor,
    purchaseRequestId: comparison.purchaseRequestId,
    createdAt: rfq.createdAt?.toISOString?.(),
  };
}

async function saveRfqQuotations(rfqId, user, { quotations: rows }) {
  assertRfqAccess(user);
  const { rfq, quantity } = await loadRfqContext(rfqId);
  if (!Array.isArray(rows) || !rows.length) {
    const err = new Error('At least one vendor quotation is required');
    err.statusCode = 400;
    throw err;
  }
  const normalized = rows.map((row) => ({
    vendorId: row.vendorId,
    rate: Number(row.rate),
    gstPercent: Number(row.gstPercent ?? 18),
    paymentTerms: row.paymentTerms || '',
    deliveryTerms: row.deliveryTerms || '',
  }));
  await upsertRfqQuotations(rfq, normalized, quantity);
  return getRfqComparison(rfqId, user);
}

async function addRfqVendorQuotation(rfqId, user, body) {
  assertRfqAccess(user);
  const { rfq, quantity } = await loadRfqContext(rfqId);
  const vendor = await Vendor.findById(body.vendorId);
  if (!vendor) {
    const err = new Error('Vendor not found');
    err.statusCode = 404;
    throw err;
  }
  await upsertRfqQuotations(
    rfq,
    [
      {
        vendorId: vendor._id,
        rate: Number(body.rate) || 0,
        gstPercent: Number(body.gstPercent ?? 18),
        paymentTerms: body.paymentTerms || '',
        deliveryTerms: body.deliveryTerms || '',
      },
    ],
    quantity
  );
  return getRfqComparison(rfqId, user);
}

async function finalizeRfq(rfqId, user, { selectedVendorId, whyWeChoseThisVendor, vendorSelectionReason }) {
  assertRfqAccess(user);
  const why = String(whyWeChoseThisVendor || '').trim();
  if (!why) {
    const err = new Error('Why We Chose This Vendor is required');
    err.statusCode = 400;
    throw err;
  }
  if (!selectedVendorId) {
    const err = new Error('Selected vendor is required');
    err.statusCode = 400;
    throw err;
  }

  const { rfq, quantity } = await loadRfqContext(rfqId);
  const quotations = await Quotation.find({ rfqId: rfq._id }).populate('vendorId');
  const l1 = pickL1Quotation(quotations, quantity);
  const l1VendorId = l1?.vendorId?._id?.toString() || l1?.vendorId?.toString();
  const isL1 = l1VendorId === selectedVendorId;

  if (!isL1) {
    const reason = String(vendorSelectionReason || '').trim();
    if (!reason) {
      const err = new Error('Reason for Selection is required when not choosing L1');
      err.statusCode = 400;
      throw err;
    }
    rfq.vendorSelectionReason = reason;
  } else {
    rfq.vendorSelectionReason = '';
  }

  rfq.selectedVendorId = selectedVendorId;
  rfq.whyWeChoseThisVendor = why;
  rfq.status = 'FINALIZED';
  rfq.finalizedAt = new Date();
  rfq.finalizedByUserId = user._id;
  await rfq.save();

  return getRfqComparison(rfqId, user);
}

function buildRfqShareText(detail) {
  const lines = [
    `RFQ ${detail.rfqNumber}`,
    detail.projectCode ? `Project: ${detail.projectCode}` : '',
    '',
    'Items:',
    ...detail.items.map((i, idx) => `${idx + 1}. ${i.name} — ${i.quantity} ${i.unit}`),
    '',
    'Terms & Conditions:',
    ...detail.termsAndConditions.map((t, i) => `${i + 1}. ${t}`),
  ].filter(Boolean);
  return lines.join('\n');
}

async function sendRfqEmail(rfqId, user, { vendorId, vendorEmail } = {}) {
  const detail = await getRfqDetail(rfqId, user);
  const { generateRfqPdfBuffer } = require('./pdfService');
  const { sendRfqToVendor } = require('./emailService');

  let vendor = null;
  if (vendorId) {
    vendor = await Vendor.findById(vendorId);
  } else if (vendorEmail) {
    vendor = { email: vendorEmail, name: 'Vendor', contactPerson: 'Sir/Madam' };
  } else if (detail.quotations?.length) {
    vendor = await Vendor.findById(detail.quotations[0].vendorId);
  }

  if (!vendor?.email && !vendorEmail) {
    const err = new Error('No vendor email available');
    err.statusCode = 400;
    throw err;
  }

  const pdfBuffer = await generateRfqPdfBuffer(detail);
  return sendRfqToVendor(detail, vendor, { pdfBuffer });
}

async function validatePoVendorSelection(
  purchaseRequestId,
  vendorIds,
  { vendorSelectionReasons = {}, whyWeChoseThisVendor, actorUserId, skipFinalizeRequirement = false } = {}
) {
  const rfq = await RFQ.findOne({ purchaseRequestId });
  if (!rfq) return;

  const pr = await PurchaseRequest.findById(purchaseRequestId);
  let quantity = 1;
  if (pr?.materialRequestId) {
    const mr = await MaterialRequest.findById(pr.materialRequestId);
    if (mr) {
      quantity = getIndentLineItems(mr).reduce((s, l) => s + (l.quantityRequested || 0), 0) || 1;
    }
  }

  const quotations = await Quotation.find({ rfqId: rfq._id }).populate('vendorId');
  const l1 = pickL1Quotation(quotations, quantity);
  const l1VendorId = l1?.vendorId?._id?.toString() || l1?.vendorId?.toString();

  for (const vendorId of vendorIds) {
    if (l1VendorId && vendorId !== l1VendorId) {
      const reason = String(vendorSelectionReasons[vendorId] || rfq.vendorSelectionReason || '').trim();
      if (!reason) {
        const err = new Error(
          'Reason for Selection is required when PO vendor is not L1 (lowest quote)'
        );
        err.statusCode = 400;
        throw err;
      }
    }
  }

  if (!skipFinalizeRequirement && (rfq.status !== 'FINALIZED' || !rfq.whyWeChoseThisVendor?.trim())) {
    const why = String(whyWeChoseThisVendor || rfq.whyWeChoseThisVendor || '').trim();
    if (!why) {
      const err = new Error(
        'Why We Chose This Vendor is required before generating PO'
      );
      err.statusCode = 400;
      throw err;
    }
    rfq.whyWeChoseThisVendor = why;
    rfq.selectedVendorId = vendorIds[0];
    if (vendorIds[0] !== l1VendorId) {
      rfq.vendorSelectionReason = String(
        vendorSelectionReasons[vendorIds[0]] || rfq.vendorSelectionReason || ''
      ).trim();
    }
    rfq.status = 'FINALIZED';
    rfq.finalizedAt = new Date();
    if (actorUserId) rfq.finalizedByUserId = actorUserId;
    await rfq.save();
  }
}

async function previewRfqWizard(purchaseRequestId, user) {
  assertRfqAccess(user);
  const pr = await PurchaseRequest.findById(purchaseRequestId).populate('projectId');
  if (!pr) {
    const err = new Error('Purchase request not found');
    err.statusCode = 404;
    throw err;
  }

  let materialIds = [];
  if (pr.materialRequestId) {
    const mr = await MaterialRequest.findById(pr.materialRequestId);
    if (mr) {
      materialIds = getIndentLineItems(mr)
        .map((i) => (i.materialId?._id || i.materialId)?.toString())
        .filter(Boolean);
    }
  }

  const { ensureRfqAndQuotations, resolveVendorsForIndent } = require('./procurementService');
  const projectCode = pr.projectId?.code || 'HO';
  const { rfq } = await ensureRfqAndQuotations(pr, projectCode, user._id, materialIds, {
    creationNote: 'RFQ created via RFQ wizard',
  });

  const comparison = await getRfqComparison(rfq._id.toString(), user);
  const suggestedVendors = (await resolveVendorsForIndent(materialIds)).slice(0, 5).map((v) => ({
    id: v._id.toString(),
    name: v.name,
    gstNumber: v.gstNumber || '',
    code: v.code || '',
  }));

  return { ...comparison, suggestedVendors };
}

async function submitRfqWizard(
  user,
  { rfqId, quotations, selectedVendorId, whyWeChoseThisVendor, vendorSelectionReason, dueDate, finalize }
) {
  assertRfqAccess(user);
  if (!rfqId) {
    const err = new Error('rfqId is required');
    err.statusCode = 400;
    throw err;
  }

  if (dueDate) {
    await RFQ.findByIdAndUpdate(rfqId, { dueDate: new Date(dueDate) });
  }

  if (Array.isArray(quotations) && quotations.length) {
    await saveRfqQuotations(rfqId, user, { quotations });
  }

  if (finalize) {
    if (!selectedVendorId || !whyWeChoseThisVendor?.trim()) {
      const err = new Error('Selected vendor and Why We Chose This Vendor are required to finalize');
      err.statusCode = 400;
      throw err;
    }
    await finalizeRfq(rfqId, user, {
      selectedVendorId,
      whyWeChoseThisVendor,
      vendorSelectionReason,
    });
    return getRfqDetail(rfqId, user);
  }

  return getRfqComparison(rfqId, user);
}

module.exports = {
  listRfqs,
  getRfqDetail,
  getRfqComparison,
  getRfqByPurchaseRequest,
  saveRfqQuotations,
  addRfqVendorQuotation,
  finalizeRfq,
  previewRfqWizard,
  submitRfqWizard,
  validatePoVendorSelection,
  buildRfqShareText,
  sendRfqEmail,
  computeFinalCost,
};
