const { UserRole } = require('@afios/shared');
const { RFQ, Quotation, PurchaseRequest, MaterialRequest, Material, Vendor } = require('../models');
const { HO_ROLES } = require('./executiveIndentService');
const { getIndentLineItems } = require('./materialRequestHelpers');
const { enrichIndentWithStock } = require('./indentStockService');
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

/**
 * Resolve indent lines for RFQ/PO procurement.
 * - Default: only lines with stock shortfall (requiredQty > 0), qty = shortfall
 * - includeMaterialIds: force-include those materials (qty = shortfall or full request)
 */
async function resolveRfqProcurementLines(mr, { includeMaterialIds } = {}) {
  const lineItems = getIndentLineItems(mr);
  if (!lineItems.length) return [];

  const { stockByLine } = await enrichIndentWithStock(mr);
  const stockMap = new Map(stockByLine.map((s) => [s.materialId, s]));
  const includeSet =
    Array.isArray(includeMaterialIds) && includeMaterialIds.length
      ? new Set(includeMaterialIds.map(String))
      : null;

  const result = [];
  for (const line of lineItems) {
    const materialId = (line.materialId?._id || line.materialId)?.toString();
    if (!materialId) continue;
    const stock = stockMap.get(materialId) || {
      requestedQty: line.quantityRequested || 0,
      availableQty: 0,
      requiredQty: line.quantityRequested || 0,
    };
    const forceInclude = includeSet ? includeSet.has(materialId) : null;
    const needsProcurement = (stock.requiredQty || 0) > 0;
    const included = includeSet ? forceInclude : needsProcurement;
    if (!included) continue;

    const quantity = needsProcurement
      ? stock.requiredQty
      : stock.requestedQty || line.quantityRequested || 0;
    if (!(quantity > 0)) continue;

    result.push({
      ...line,
      materialId: line.materialId,
      quantityRequested: quantity,
      _stock: stock,
      _coveredByStock: !needsProcurement,
    });
  }
  return result;
}

async function buildStockCoveredSummary(mr) {
  const lineItems = getIndentLineItems(mr);
  const { stockByLine } = await enrichIndentWithStock(mr);
  const stockMap = new Map(stockByLine.map((s) => [s.materialId, s]));
  const covered = [];
  for (const line of lineItems) {
    const materialId = (line.materialId?._id || line.materialId)?.toString();
    if (!materialId) continue;
    const stock = stockMap.get(materialId);
    if (!stock || stock.requiredQty > 0) continue;
    const mat =
      line.materialId && typeof line.materialId === 'object'
        ? line.materialId
        : await Material.findById(materialId);
    covered.push({
      materialId,
      name: mat?.name || 'Item',
      code: mat?.code || '',
      requestedQty: stock.requestedQty,
      availableQty: stock.availableQty,
      requiredQty: 0,
      unit: line.unit || mat?.unit || 'Nos',
    });
  }
  return covered;
}

async function loadRfqContext(rfqId, { includeMaterialIds } = {}) {
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
  const lineItems = mr
    ? await resolveRfqProcurementLines(mr, { includeMaterialIds })
    : [];
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
    const stock = line._stock;
    items.push({
      materialId: mat?._id?.toString() || line.materialId?.toString(),
      name: mat?.name || 'Item',
      code: mat?.code || '',
      quantity: line.quantityRequested,
      unit: line.unit || mat?.unit || 'Nos',
      requestedQty: stock?.requestedQty ?? line.quantityRequested,
      availableQty: stock?.availableQty,
      requiredQty: stock?.requiredQty ?? line.quantityRequested,
      coveredByStock: Boolean(line._coveredByStock),
    });
  }
  return items;
}

async function getRfqComparison(rfqId, user) {
  assertRfqAccess(user);
  const rfqPeek = await RFQ.findById(rfqId).select('procurementMaterialIds').lean();
  const storedIds = (rfqPeek?.procurementMaterialIds || []).map(String);
  const { rfq, mr, lineItems, quantity, materialIds } = await loadRfqContext(rfqId, {
    includeMaterialIds: storedIds.length ? storedIds : undefined,
  });
  // When nothing stored and no shortfall lines, fall back to full indent (legacy RFQs)
  let activeLines = lineItems;
  let activeQty = quantity;
  let activeMaterialIds = materialIds;
  if (!activeLines.length && mr) {
    const all = getIndentLineItems(mr);
    activeLines = all;
    activeQty = all.reduce((s, l) => s + (l.quantityRequested || 0), 0) || 1;
    activeMaterialIds = all
      .map((l) => (l.materialId?._id || l.materialId)?.toString())
      .filter(Boolean);
  }

  const quotations = await Quotation.find({ rfqId: rfq._id }).populate('vendorId').sort({ amount: 1 });
  const hasAssignments = quotations.some((q) => (q.selectedMaterialIds || []).length > 0);
  if (!hasAssignments) {
    await ensureDefaultVendorQuotations(rfq, rfq.purchaseRequestId, activeMaterialIds);
  }
  const freshQuotations = await Quotation.find({ rfqId: rfq._id }).populate('vendorId').sort({ amount: 1 });
  const comparison = buildComparisonTable(freshQuotations, activeQty, activeLines);
  const purchaseHistory = await buildPurchaseHistoryRows(activeLines);

  return {
    rfqId: rfq._id.toString(),
    rfqNumber: rfq.rfqNumber,
    status: rfq.status,
    quantity: activeQty,
    comparison,
    purchaseHistory,
    selectedVendorId: rfq.selectedVendorId?.toString(),
    vendorSelectionReason: rfq.vendorSelectionReason || '',
    whyWeChoseThisVendor: rfq.whyWeChoseThisVendor || '',
    items: await buildItemsPayload(activeLines),
    stockCoveredItems: mr ? await buildStockCoveredSummary(mr) : [],
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

async function getRfqDetailForVendor(rfqId, user, vendorId) {
  const detail = await getRfqDetail(rfqId, user);
  if (!vendorId) return detail;

  const quotation = await Quotation.findOne({ rfqId, vendorId }).populate('vendorId').lean();
  if (!quotation) {
    const err = new Error('Vendor quotation not found for this RFQ');
    err.statusCode = 404;
    throw err;
  }

  const selectedIds = new Set((quotation.selectedMaterialIds || []).map((id) => id.toString()));
  const items = selectedIds.size
    ? (detail.items || []).filter((item) => selectedIds.has(item.materialId))
    : detail.items || [];

  const vendor = quotation.vendorId;
  const vendorName = vendor?.name || 'Vendor';
  const comparisonVendor = (detail.quotations || []).find((v) => v.vendorId === vendorId);

  return {
    ...detail,
    items,
    vendorId,
    vendorName,
    paymentTerms: quotation.paymentTerms || comparisonVendor?.paymentTerms || '',
    deliveryTerms: quotation.deliveryTerms || comparisonVendor?.deliveryTerms || '',
  };
}

async function saveRfqQuotations(rfqId, user, { quotations: rows }) {
  assertRfqAccess(user);
  const { rfq, quantity, lineItems } = await loadRfqContext(rfqId);
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
      itemRates: Array.isArray(row.itemRates) ? row.itemRates : [],
      selectedMaterialIds: Array.isArray(row.selectedMaterialIds) ? row.selectedMaterialIds : [],
  }));
  await upsertRfqQuotations(rfq, normalized, quantity, lineItems);
  return getRfqComparison(rfqId, user);
}

async function addRfqVendorQuotation(rfqId, user, body) {
  assertRfqAccess(user);
  const { rfq, quantity, lineItems } = await loadRfqContext(rfqId);
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
        itemRates: Array.isArray(body.itemRates) ? body.itemRates : [],
        selectedMaterialIds: Array.isArray(body.selectedMaterialIds) ? body.selectedMaterialIds : [],
      },
    ],
    quantity,
    lineItems
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

  const { rfq, quantity, lineItems } = await loadRfqContext(rfqId);
  const quotations = await Quotation.find({ rfqId: rfq._id }).populate('vendorId');
  const l1 = pickL1Quotation(quotations, quantity, lineItems);
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
    detail.vendorName ? `RFQ ${detail.rfqNumber} — ${detail.vendorName}` : `RFQ ${detail.rfqNumber}`,
    detail.projectCode ? `Project: ${detail.projectCode}` : '',
    '',
    'Items:',
    ...(detail.items || []).map((i, idx) => `${idx + 1}. ${i.name} — ${i.quantity} ${i.unit}`),
    '',
    'Terms & Conditions:',
    ...(detail.termsAndConditions || []).map((t, i) => `${i + 1}. ${t}`),
  ].filter(Boolean);
  return lines.join('\n');
}

async function sendRfqEmail(rfqId, user, { vendorId, vendorEmail } = {}) {
  const detail = vendorId
    ? await getRfqDetailForVendor(rfqId, user, vendorId)
    : await getRfqDetail(rfqId, user);
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
  let lineItems = [];
  if (pr?.materialRequestId) {
    const mr = await MaterialRequest.findById(pr.materialRequestId);
    if (mr) {
      lineItems = getIndentLineItems(mr);
      quantity = lineItems.reduce((s, l) => s + (l.quantityRequested || 0), 0) || 1;
    }
  }

  const quotations = await Quotation.find({ rfqId: rfq._id }).populate('vendorId');
  const l1 = pickL1Quotation(quotations, quantity, lineItems);
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

async function previewRfqWizard(purchaseRequestId, user, { includeMaterialIds } = {}) {
  assertRfqAccess(user);
  const pr = await PurchaseRequest.findById(purchaseRequestId).populate('projectId');
  if (!pr) {
    const err = new Error('Purchase request not found');
    err.statusCode = 404;
    throw err;
  }

  let materialIds = [];
  let mr = null;
  if (pr.materialRequestId) {
    mr = await MaterialRequest.findById(pr.materialRequestId).populate('items.materialId');
    if (mr) {
      const procurementLines = await resolveRfqProcurementLines(mr, {
        includeMaterialIds:
          Array.isArray(includeMaterialIds) && includeMaterialIds.length
            ? includeMaterialIds
            : undefined,
      });
      materialIds = procurementLines
        .map((i) => (i.materialId?._id || i.materialId)?.toString())
        .filter(Boolean);

      // Explicit empty include list with no auto-shortfall → error
      if (
        Array.isArray(includeMaterialIds) &&
        includeMaterialIds.length === 0 &&
        !materialIds.length
      ) {
        const err = new Error('Select at least one material that needs procurement for the RFQ');
        err.statusCode = 400;
        throw err;
      }

      if (!materialIds.length) {
        const err = new Error(
          'All indent materials are covered by available stock — nothing to include in RFQ'
        );
        err.statusCode = 400;
        throw err;
      }
    }
  }

  const { ensureRfqAndQuotations, resolveVendorsForIndent } = require('./procurementService');
  const projectCode = pr.projectId?.code || 'HO';
  const { rfq } = await ensureRfqAndQuotations(pr, projectCode, user._id, materialIds, {
    creationNote: 'RFQ created via RFQ wizard',
  });

  rfq.procurementMaterialIds = materialIds;
  await rfq.save();

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
  getRfqDetailForVendor,
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
