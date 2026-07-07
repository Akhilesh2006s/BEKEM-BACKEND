const { StatusHistory } = require('../models');
const { getIndentLineItems } = require('./materialRequestHelpers');
const { serializePurchaseRequest } = require('../utils/serializeProcurement');

function derivePriority(amountEstimate, escalatedToHo) {
  if (escalatedToHo) return 'HIGH';
  const amount = Number(amountEstimate) || 0;
  if (amount >= 50000) return 'HIGH';
  if (amount >= 5000) return 'MEDIUM';
  return 'NORMAL';
}

async function resolvePmName(materialRequestId) {
  if (!materialRequestId) return null;
  const history = await StatusHistory.findOne({
    entityType: 'MaterialRequest',
    entityId: materialRequestId,
    toStatus: {
      $in: ['PM_APPROVED', 'PENDING_HO', 'PENDING_EXECUTIVE_DECISION', 'PURCHASE_REQUESTED'],
    },
  })
    .sort({ timestamp: -1 })
    .populate('actorUserId', 'name')
    .lean();
  return history?.actorUserId?.name || null;
}

function buildMaterialsSummary(mr) {
  if (!mr) return '';
  const items = getIndentLineItems(mr);
  const names = items.map((item) => {
    const mat = item.materialId;
    return mat?.name || 'Material';
  });
  const summary = names.join(', ');
  return summary.length > 120 ? `${summary.slice(0, 117)}…` : summary;
}

async function serializeExecutivePurchaseRequestListItem(pr) {
  const base = serializePurchaseRequest(pr);
  const mr = pr.materialRequestId;
  const pmName = mr?._id ? await resolvePmName(mr._id) : null;

  return {
    ...base,
    pmName,
    materialsSummary: buildMaterialsSummary(mr),
    totalValue: pr.amountEstimate,
    requestDate: pr.createdAt?.toISOString?.() || null,
    priority: derivePriority(pr.amountEstimate, mr?.escalatedToHo),
    pmRemarks: mr?.pmForwardRemark || '',
    executiveRecommendation: pr.executiveRecommendation || null,
    executiveRecommendationRemark: pr.executiveRecommendationRemark || '',
  };
}

async function enrichPurchaseRequestDetail(pr) {
  const base = serializePurchaseRequest(pr);
  const mr = pr.materialRequestId;
  if (!mr || typeof mr !== 'object') return base;

  const lineItems = getIndentLineItems(mr);
  const pmName = await resolvePmName(mr._id);

  return {
    ...base,
    pmName,
    pmRemarks: mr.pmForwardRemark || '',
    requestedBy: mr.requestedByUserId?.name || null,
    indentDate: mr.createdAt?.toISOString?.() || null,
    requestDate: pr.createdAt?.toISOString?.() || null,
    priority: derivePriority(pr.amountEstimate, mr.escalatedToHo),
    materialsSummary: buildMaterialsSummary(mr),
    totalValue: pr.amountEstimate,
    executiveRecommendation: pr.executiveRecommendation || null,
    executiveRecommendationRemark: pr.executiveRecommendationRemark || '',
    executiveRecommendedAt: pr.executiveRecommendedAt?.toISOString?.() || null,
    canExecutiveDecide: pr.status === 'OPEN' && !pr.executiveRecommendation,
    items: lineItems.map((item) => {
      const mat = item.materialId;
      return {
        id: item._id.toString(),
        materialId: (mat?._id || mat)?.toString(),
        materialName: mat?.name || 'Material',
        unit: item.unit || mat?.unit || '',
        quantityRequested: item.quantityRequested,
      };
    }),
  };
}

module.exports = {
  derivePriority,
  serializeExecutivePurchaseRequestListItem,
  enrichPurchaseRequestDetail,
};
