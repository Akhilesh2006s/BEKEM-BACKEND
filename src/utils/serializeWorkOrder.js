const { refId } = require('./serializeProcurement');
const { serializeVendor, serializePurchaseOrder } = require('./serializeProcurement');

function serializeMilestone(m) {
  return {
    id: m._id.toString(),
    name: m.name,
    status: m.status,
    order: m.order,
  };
}

function serializeMaterialIssue(issue) {
  return {
    id: issue._id.toString(),
    materialId: refId(issue.materialId),
    materialName: issue.materialName || issue.materialId?.name || '',
    materialUnit: issue.materialUnit || issue.materialId?.unit || '',
    quantity: issue.quantity,
    issuedByUserId: refId(issue.issuedByUserId),
    issuedByName: issue.issuedByUserId?.name,
    createdAt: issue.createdAt?.toISOString?.(),
  };
}

function serializeCertification(cert) {
  return {
    id: cert._id.toString(),
    quantity: cert.quantity,
    note: cert.note,
    evidenceNote: cert.evidenceNote,
    certifiedByUserId: refId(cert.certifiedByUserId),
    certifiedByName: cert.certifiedByUserId?.name,
    status: cert.status,
    pmVerifiedByUserId: refId(cert.pmVerifiedByUserId),
    pmNote: cert.pmNote,
    createdAt: cert.createdAt?.toISOString?.(),
  };
}

function serializeWorkOrder(wo) {
  const base = {
    id: wo._id.toString(),
    woNumber: wo.woNumber,
    purchaseOrderId: refId(wo.purchaseOrderId),
    projectId: refId(wo.projectId),
    siteId: refId(wo.siteId),
    vendorId: refId(wo.vendorId),
    scope: wo.scope,
    totalQuantity: wo.totalQuantity,
    quantityUnit: wo.quantityUnit,
    completedQuantity: wo.completedQuantity,
    progressPercent: wo.progressPercent,
    contractValue: wo.contractValue,
    status: wo.status,
    createdByUserId: refId(wo.createdByUserId),
    createdAt: wo.createdAt?.toISOString?.(),
    updatedAt: wo.updatedAt?.toISOString?.(),
    milestones: (wo.milestones || []).map(serializeMilestone),
    materialIssues: (wo.materialIssues || []).map(serializeMaterialIssue),
    certifications: (wo.certifications || []).map(serializeCertification),
  };

  if (wo.vendorId?.name) base.vendor = serializeVendor(wo.vendorId);
  if (wo.projectId?.code) {
    base.project = {
      id: wo.projectId._id.toString(),
      code: wo.projectId.code,
      name: wo.projectId.name,
    };
  }
  if (wo.siteId?.name) {
    base.site = {
      id: wo.siteId._id.toString(),
      projectId: refId(wo.siteId.projectId),
      name: wo.siteId.name,
      chainageLabel: wo.siteId.chainageLabel,
    };
  }
  if (wo.purchaseOrderId?.poNumber) {
    base.purchaseOrder = serializePurchaseOrder(wo.purchaseOrderId);
  }

  return base;
}

module.exports = { serializeWorkOrder };
