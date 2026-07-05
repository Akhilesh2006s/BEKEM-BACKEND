const { poApprovalRoutingNote } = require('../constants/approvalPolicy');
const { sanitizeProcurementRef } = require('../services/procurementReferenceService');

function refId(value) {
  if (value == null) return undefined;
  if (typeof value === 'object' && value._id != null) return value._id.toString();
  return value.toString();
}

function serializeVendor(v) {
  const materialIds = (v.materialIds || []).map((m) =>
    typeof m === 'object' && m._id ? m._id.toString() : m.toString()
  );
  const base = {
    id: v._id.toString(),
    name: v.name,
    code: v.code || '',
    address: v.address || '',
    gstNumber: v.gstNumber || '',
    email: v.email || '',
    contactPerson: v.contactPerson || '',
    phone: v.phone || '',
    contactInfo: v.contactInfo || v.phone || '',
    category: v.category || '',
    suppliedCategories: v.suppliedCategories || [],
    materialIds,
    rating: v.rating,
    isMsme: !!v.isMsme,
    msmeNumber: v.isMsme ? v.msmeNumber || '' : undefined,
    msmeCertificateUrl: v.isMsme ? v.msmeCertificateUrl || '' : undefined,
    panNumber: v.panNumber || '',
    bankName: v.bankName || '',
    bankAccountNumber: v.bankAccountNumber || '',
    ifscCode: v.ifscCode || '',
    authorizationStatus: v.authorizationStatus || 'AUTHORIZED',
    createdByUserId: v.createdByUserId?.toString?.() || v.createdByUserId || undefined,
    authorizedAt: v.authorizedAt?.toISOString?.() || undefined,
  };
  if (v.materialIds?.length && typeof v.materialIds[0] === 'object' && v.materialIds[0].code) {
    base.materials = v.materialIds.map((m) => ({
      id: m._id.toString(),
      code: m.code,
      name: m.name,
      unit: m.unit,
    }));
  }
  return base;
}

function serializePurchaseRequest(pr) {
  const base = {
    id: pr._id.toString(),
    prNumber: pr.prNumber,
    materialRequestId: refId(pr.materialRequestId),
    projectId: refId(pr.projectId),
    status: pr.status,
    createdByUserId: refId(pr.createdByUserId),
    amountEstimate: pr.amountEstimate,
    createdAt: pr.createdAt?.toISOString?.(),
    updatedAt: pr.updatedAt?.toISOString?.(),
  };
  if (pr.projectId?.code) {
    base.project = {
      id: pr.projectId._id.toString(),
      code: pr.projectId.code,
      name: pr.projectId.name,
    };
  }
  if (pr.materialRequestId?.indentNumber) {
    base.materialRequest = {
      id: pr.materialRequestId._id.toString(),
      indentNumber: pr.materialRequestId.indentNumber,
      status: pr.materialRequestId.status,
    };
  }
  return base;
}

function serializeQuotation(q) {
  return {
    id: q._id.toString(),
    rfqId: refId(q.rfqId) || '',
    vendorId: refId(q.vendorId) || '',
    vendor: q.vendorId?.name ? serializeVendor(q.vendorId) : undefined,
    amount: q.amount,
    terms: q.terms,
    submittedAt: q.submittedAt?.toISOString?.(),
  };
}

function serializePurchaseOrder(po) {
  const displayPoNumber = po.poSeq
    ? String(po.poSeq).padStart(4, '0')
    : po.poNumber?.split('/')?.[2]?.trim() || po.draftRef || 'Draft';
  const base = {
    id: po._id.toString(),
    poNumber: po.poNumber || po.draftRef || 'Draft',
    displayPoNumber,
    procurementRef: sanitizeProcurementRef(po.procurementRef || po.poNumber || po.draftRef || ''),
    financialYear: po.financialYear || '',
    poSeq: po.poSeq,
    vendorPoSeq: po.vendorPoSeq,
    draftRef: po.draftRef,
    purchaseRequestId: refId(po.purchaseRequestId),
    vendorId: refId(po.vendorId),
    quotationId: refId(po.quotationId),
    amount: po.amount,
    paymentTerms: po.paymentTerms,
    billingAddress: po.billingAddress || '',
    billingAddressType: po.billingAddressType || 'registered_office',
    deliveryAddress: po.deliveryAddress || '',
    deliveryAddressType: po.deliveryAddressType || 'site',
    deliveryAddressOtherText: po.deliveryAddressOtherText || '',
    expectedDeliveryDate: po.expectedDeliveryDate?.toISOString?.() || null,
    referenceNote: po.referenceNote || '',
    lineItems: (po.lineItems || []).map((li) => ({
      id: li._id?.toString(),
      description: li.description,
      materialId: refId(li.materialId),
      itemCode: li.itemCode || '',
      hsnCode: li.hsnCode,
      quantity: li.quantity,
      rate: li.rate,
      gstPercent: li.gstPercent,
      amount: li.amount,
    })),
    attachments: (po.attachments || []).map((a) => ({
      id: a._id?.toString(),
      name: a.name,
      fileType: a.fileType,
      url: a.url,
    })),
    status: po.status,
    fulfillmentStatus: po.fulfillmentStatus || 'open_partial',
    approvalRoutingNote: poApprovalRoutingNote(po),
    officialPdfGeneratedAt: po.officialPdfGeneratedAt?.toISOString?.(),
    emailSentAt: po.emailSentAt?.toISOString?.() || po.sentToVendorAt?.toISOString?.() || null,
    emailStatus: po.emailStatus || 'pending',
    approvedAsChairmanOverride: !!po.approvedAsChairmanOverride,
    overrideRemark: po.overrideRemark || '',
    finalApprovedAt: po.finalApprovedAt?.toISOString?.() || null,
    createdAt: po.createdAt?.toISOString?.(),
    updatedAt: po.updatedAt?.toISOString?.(),
  };
  if (po.vendorId?.name) base.vendor = serializeVendor(po.vendorId);
  if (po.purchaseRequestId?.prNumber) {
    base.purchaseRequest = serializePurchaseRequest(po.purchaseRequestId);
  }
  if (po.quotationId && typeof po.quotationId === 'object' && po.quotationId.amount != null) {
    base.quotation = serializeQuotation(po.quotationId);
  }
  return base;
}

function serializeAuditLog(log) {
  return {
    id: log._id.toString(),
    actorUserId: log.actorUserId?.toString() || null,
    actorName: log.actorUserId?.name || 'System',
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId?.toString() || null,
    beforeState: log.beforeState,
    afterState: log.afterState,
    ipAddress: log.ipAddress,
    timestamp: log.timestamp?.toISOString?.(),
  };
}

module.exports = {
  refId,
  serializeVendor,
  serializePurchaseRequest,
  serializeQuotation,
  serializePurchaseOrder,
  serializeAuditLog,
};
