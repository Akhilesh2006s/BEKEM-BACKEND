const {
  PurchaseRequest,
  RFQ,
  Quotation,
  PurchaseOrder,
  MaterialRequest,
  Material,
  Vendor,
  User,
  Site,
} = require('../models');
const { UserRole } = require('@afios/shared');
const statusHistoryService = require('./statusHistoryService');
const { recordPoCreated } = require('./poTimelineService');
const notificationService = require('./notificationService');
const { generateRfqNumber, generatePoNumber, generateDraftPoRef } = require('./documentNumberService');
const { getIndentLineItems } = require('./materialRequestHelpers');
const { BEKEM_BUYER_ADDRESS } = require('../constants/bekemAddresses');

async function resolveVendorsForIndent(materialIds) {
  if (!materialIds?.length) {
    return Vendor.find({ isActive: { $ne: false } }).limit(5);
  }
  const materials = await Material.find({ _id: { $in: materialIds } });
  const categories = [...new Set(materials.map((m) => m.category).filter(Boolean))];
  const vendors = await Vendor.find({
    isActive: { $ne: false },
    $or: [
      { materialIds: { $in: materialIds } },
      { suppliedCategories: { $in: categories } },
      { category: { $in: categories } },
    ],
  }).limit(5);
  if (vendors.length) return vendors;
  return Vendor.find({ isActive: { $ne: false } }).limit(3);
}

const { buildConsigneeAddress } = require('./consigneeAddressService');
const { validatePoLinePayload, computePoLineTotals } = require('./poLineCalculation');
const { resolveBillingAddress, resolveDeliveryAddress } = require('./addressResolutionService');

async function buildLineItemsFromIndent(mr, budgetAmount) {
  const items = getIndentLineItems(mr);
  if (!items.length) return { lineItems: [], subtotal: budgetAmount };

  const lineItems = [];
  let subtotal = 0;
  const perItemBudget = budgetAmount / items.length;

  for (const item of items) {
    const matRef = item.materialId;
    const mat =
      matRef && typeof matRef === 'object' && matRef.name
        ? matRef
        : await Material.findById(matRef?._id || matRef);
    if (!mat) continue;

    const qty = item.quantityRequested || 1;
    const rate = Math.max(1, Math.round(perItemBudget / qty));
    const amount = qty * rate;
    subtotal += amount;

    lineItems.push({
      description: mat.description ? `${mat.name} — ${mat.description}` : mat.name,
      materialId: mat._id,
      itemCode: mat.code,
      hsnCode: mat.hsnCode || '',
      quantity: qty,
      rate,
      gstPercent: mat.gstRate ?? 18,
      amount,
    });
  }

  return { lineItems, subtotal: subtotal || budgetAmount };
}

async function ensureRfqAndQuotations(purchaseRequest, projectCode, actorUserId, materialIds) {
  let rfq = await RFQ.findOne({ purchaseRequestId: purchaseRequest._id });
  const vendors = await resolveVendorsForIndent(materialIds);

  if (!rfq) {
    const rfqNumber = await generateRfqNumber(projectCode);
    rfq = await RFQ.create({
      rfqNumber,
      purchaseRequestId: purchaseRequest._id,
      vendorIds: vendors.map((v) => v._id),
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      status: 'OPEN',
    });

    await statusHistoryService.record(
      'RFQ',
      rfq._id,
      null,
      'OPEN',
      actorUserId,
      'RFQ auto-generated during PO wizard'
    );

    let totalQty = 1;
    if (purchaseRequest.materialRequestId) {
      const mr = await MaterialRequest.findById(purchaseRequest.materialRequestId);
      if (mr) {
        totalQty =
          getIndentLineItems(mr).reduce((s, l) => s + (l.quantityRequested || 0), 0) || 1;
      }
    }

    for (const vendor of vendors.slice(0, 3)) {
      const baseAmount = purchaseRequest.amountEstimate || 100000;
      const variance = 0.9 + Math.random() * 0.2;
      const lineSubtotal = Math.round(baseAmount * variance);
      const rate = Math.max(1, Math.round(lineSubtotal / totalQty));
      const { computeFinalCost } = require('./quotationComparisonService');
      await Quotation.create({
        rfqId: rfq._id,
        vendorId: vendor._id,
        rate,
        gstPercent: 18,
        paymentTerms: '100% payment within 30 days from the date of supply',
        deliveryTerms: 'Delivery as per project schedule',
        amount: computeFinalCost(rate, totalQty, 18),
        terms: '100% payment within 30 days from the date of supply',
        submittedAt: new Date(),
      });
    }
  }

  const quotations = await Quotation.find({ rfqId: rfq._id }).populate('vendorId');
  const { ensureDefaultVendorQuotations } = require('./quotationComparisonService');
  await ensureDefaultVendorQuotations(rfq, purchaseRequest, materialIds);
  const allQuotes = await Quotation.find({ rfqId: rfq._id }).populate('vendorId');
  return { rfq, quotations: allQuotes.length ? allQuotes : quotations };
}

function normalizeWizardLineItems(rawItems, mr, fallbackAmount) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return buildLineItemsFromIndent(mr, fallbackAmount);
  }

  const indentItems = mr ? getIndentLineItems(mr) : [];
  const lineItems = [];
  let subtotal = 0;

  for (let i = 0; i < rawItems.length; i++) {
    const row = rawItems[i];
    const indentLine = indentItems[i];
    const mat = indentLine?.materialId;
    const gstPercent =
      row.gstPercent != null
        ? Number(row.gstPercent)
        : mat && typeof mat === 'object'
          ? mat.gstRate ?? 18
          : 18;

    const computed = validatePoLinePayload(
      {
        ...row,
        gstPercent,
        materialId: row.materialId || mat?._id || mat,
      },
      i
    );

    lineItems.push({
      description:
        row.description ||
        (mat && typeof mat === 'object' && mat.name
          ? mat.description
            ? `${mat.name} — ${mat.description}`
            : mat.name
          : 'Item'),
      materialId: row.materialId || mat?._id || mat,
      itemCode: (mat && typeof mat === 'object' ? mat.code : row.itemCode) || '',
      hsnCode: row.hsnCode || (mat && typeof mat === 'object' ? mat.hsnCode : '') || '',
      quantity: Number(row.quantity),
      rate: Number(row.rate),
      gstPercent,
      amount: computed.amount,
    });
    subtotal += computed.grandTotal;
  }

  return { lineItems, subtotal: subtotal || fallbackAmount };
}

async function createPurchaseOrderFromWizard({
  materialRequestId,
  purchaseRequestId,
  vendorId,
  paymentTerms,
  additionalTerms,
  billingAddress,
  billingAddressType,
  deliveryAddress: deliveryOverride,
  deliveryAddressType,
  deliveryAddressOtherText,
  expectedDeliveryDate,
  referenceNote,
  lineItems: lineItemsOverride,
  attachments,
  vendorSelectionReason,
  actorUserId,
  skipIndentStatusUpdate = false,
}) {
  let mr = null;
  let pr = null;

  if (purchaseRequestId) {
    pr = await PurchaseRequest.findById(purchaseRequestId).populate('projectId');
    if (pr?.materialRequestId) {
      mr = await MaterialRequest.findById(pr.materialRequestId)
        .populate('items.materialId')
        .populate('siteId');
    }
  } else if (materialRequestId) {
    mr = await MaterialRequest.findById(materialRequestId)
      .populate('items.materialId')
      .populate('siteId')
      .populate('projectId');
    pr = await PurchaseRequest.findOne({ materialRequestId: mr._id });
    if (!pr && mr) {
      const { generatePrNumber } = require('./documentNumberService');
      pr = await PurchaseRequest.create({
        prNumber: await generatePrNumber(mr.projectId.code),
        materialRequestId: mr._id,
        projectId: mr.projectId._id,
        status: 'OPEN',
        createdByUserId: actorUserId,
        amountEstimate: mr.quantityRequested * 5000,
      });
    }
  }

  if (!pr) throw Object.assign(new Error('Purchase request not found'), { statusCode: 404 });

  const materialIds = mr
    ? getIndentLineItems(mr).map((i) => (i.materialId?._id || i.materialId)?.toString()).filter(Boolean)
    : [];

  const projectCode =
    pr.projectId?.code || (await require('../models').Project.findById(pr.projectId))?.code;
  const { rfq, quotations } = await ensureRfqAndQuotations(
    pr,
    projectCode,
    actorUserId,
    materialIds
  );

  let quotation = quotations.find((q) => q.vendorId._id.toString() === vendorId.toString());
  if (!quotation) {
    quotation = await Quotation.create({
      rfqId: rfq._id,
      vendorId,
      amount: pr.amountEstimate,
      terms: paymentTerms || '100% payment within 30 days from the date of supply',
      submittedAt: new Date(),
    });
  }

  const draftRef = await generateDraftPoRef(projectCode);
  const projectId = pr.projectId?._id || pr.projectId;
  const resolvedBilling =
    (await resolveBillingAddress({
      billingAddressType: billingAddressType || 'registered_office',
      projectId,
      overrideText: billingAddress,
    })) || BEKEM_BUYER_ADDRESS;
  const deliveryAddress =
    deliveryOverride ||
    (await resolveDeliveryAddress({
      deliveryAddressType: deliveryAddressType || 'site',
      deliveryAddressOtherText,
      mr,
    }));
  const { lineItems, subtotal } = normalizeWizardLineItems(
    lineItemsOverride,
    mr,
    quotation.amount
  );

  const poAttachments = Array.isArray(attachments)
    ? attachments
        .filter((a) => a?.name)
        .map((a) => ({
          name: a.name,
          fileType: a.fileType || 'application/pdf',
          url: a.url || '',
          uploadedByUserId: actorUserId,
        }))
    : [];

  const poAmount = subtotal || quotation.amount;
  const { initialPoStatusForAmount, requiresPmApproval } = require('../constants/approvalPolicy');
  const initialStatus = initialPoStatusForAmount(poAmount);

  const po = await PurchaseOrder.create({
    draftRef,
    purchaseRequestId: pr._id,
    vendorId,
    quotationId: quotation._id,
    amount: poAmount,
    paymentTerms: paymentTerms || quotation.terms,
    additionalTerms: additionalTerms || '',
    billingAddress: resolvedBilling,
    billingAddressType: billingAddressType || 'registered_office',
    deliveryAddress,
    deliveryAddressType: deliveryAddressType || 'site',
    deliveryAddressOtherText: deliveryAddressOtherText || '',
    expectedDeliveryDate: expectedDeliveryDate ? new Date(expectedDeliveryDate) : undefined,
    referenceNote: referenceNote || (mr?.indentNumber ? `Indent ${mr.indentNumber}` : ''),
    vendorSelectionReason: vendorSelectionReason || '',
    lineItems,
    attachments: poAttachments,
    status: initialStatus,
  });

  await statusHistoryService.record(
    'PurchaseOrder',
    po._id,
    null,
    initialStatus,
    actorUserId,
    requiresPmApproval(poAmount)
      ? 'PO created — pending Project Manager approval (under ₹5,000)'
      : 'PO created — pending coordinator review'
  );

  await recordPoCreated(po._id, actorUserId);

  if (requiresPmApproval(poAmount) && pr.projectId) {
    const projectId = pr.projectId._id || pr.projectId;
    const pms = await User.find({
      role: 'PROJECT_MANAGER',
      assignedProjectIds: projectId,
    });
    if (pms.length) {
      await notificationService.notifyUsers(
        pms.map((u) => u._id),
        {
          title: 'PO awaiting PM approval',
          body: `${po.draftRef} (₹${Number(poAmount).toLocaleString('en-IN')}) needs Project Manager approval.`,
          relatedEntityType: 'PurchaseOrder',
          relatedEntityId: po._id,
        }
      );
    }
  }

  if (mr && !skipIndentStatusUpdate && !['PO_CREATED', 'CHAIRMAN_APPROVED', 'MATERIAL_RECEIVED', 'ISSUED', 'COMPLETED'].includes(mr.status)) {
    const fromStatus = mr.status;
    mr.status = 'PO_CREATED';
    mr.pendingWithRole = 'COORDINATOR';
    await mr.save();
    await statusHistoryService.record(
      'MaterialRequest',
      mr._id,
      fromStatus,
      'PO_CREATED',
      actorUserId,
      `PO draft ${draftRef} created`
    );
  }

  if (pr.status === 'OPEN') {
    pr.status = 'PO_CREATED';
    await pr.save();
  }

  const { poRequiresCoordinatorVerification } = require('./coordinatorPoQueueService');
  if (poRequiresCoordinatorVerification(initialStatus)) {
    const coordinators = await User.find({ role: UserRole.COORDINATOR });
    await notificationService.notifyUsers(
      coordinators.map((u) => u._id),
      {
        title: 'PO pending review',
        body: `${draftRef} requires coordinator review.`,
        relatedEntityType: 'PurchaseOrder',
        relatedEntityId: po._id,
      }
    );
  }

  return { po, rfq, quotation, quotations };
}

async function createPurchaseOrdersFromWizardBatch({
  purchaseRequestId,
  materialRequestId,
  orders,
  paymentTerms,
  additionalTerms,
  billingAddress,
  billingAddressType,
  deliveryAddress,
  deliveryAddressType,
  deliveryAddressOtherText,
  expectedDeliveryDate,
  referenceNote,
  actorUserId,
  whyWeChoseThisVendor,
  vendorSelectionReasons,
}) {
  if (!Array.isArray(orders) || orders.length === 0) {
    throw Object.assign(new Error('At least one vendor order required'), { statusCode: 400 });
  }

  const vendorIds = orders.map((o) => o.vendorId);
  const { validatePoVendorSelection } = require('./rfqService');
  await validatePoVendorSelection(purchaseRequestId, vendorIds, {
    vendorSelectionReasons: vendorSelectionReasons || {},
    whyWeChoseThisVendor,
    actorUserId,
  });

  const created = [];
  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
    const selectionReason =
      order.vendorSelectionReason ||
      vendorSelectionReasons?.[order.vendorId] ||
      '';
    const result = await createPurchaseOrderFromWizard({
      purchaseRequestId,
      materialRequestId,
      vendorId: order.vendorId,
      paymentTerms: order.paymentTerms || paymentTerms,
      additionalTerms: order.additionalTerms || additionalTerms,
      billingAddress,
      billingAddressType,
      deliveryAddress,
      deliveryAddressType,
      deliveryAddressOtherText,
      expectedDeliveryDate: order.expectedDeliveryDate || expectedDeliveryDate,
      referenceNote,
      lineItems: order.lineItems,
      attachments: order.attachments,
      vendorSelectionReason: selectionReason,
      actorUserId,
      skipIndentStatusUpdate: i > 0,
    });
    created.push(result);
  }
  return created;
}

module.exports = {
  ensureRfqAndQuotations,
  createPurchaseOrderFromWizard,
  createPurchaseOrdersFromWizardBatch,
  buildLineItemsFromIndent,
};
