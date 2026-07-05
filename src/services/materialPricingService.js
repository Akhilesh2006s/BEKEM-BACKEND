const mongoose = require('mongoose');
const { PurchaseOrder } = require('../models');

const APPROVED_PO_STATUSES = ['APPROVED'];

/**
 * Latest approved purchase rate per material from PO line items.
 * @param {string[]} materialIds
 * @returns {Promise<Map<string, number>>}
 */
async function getLatestApprovedRates(materialIds) {
  const ids = [...new Set((materialIds || []).map((id) => id?.toString()).filter(Boolean))];
  const rateByMaterial = new Map();
  if (!ids.length) return rateByMaterial;

  const rows = await PurchaseOrder.aggregate([
    { $match: { status: { $in: APPROVED_PO_STATUSES } } },
    { $sort: { finalApprovedAt: -1, updatedAt: -1 } },
    { $unwind: '$lineItems' },
    {
      $match: {
        'lineItems.materialId': {
          $in: ids
            .filter((id) => mongoose.Types.ObjectId.isValid(id))
            .map((id) => new mongoose.Types.ObjectId(id)),
        },
      },
    },
    {
      $group: {
        _id: '$lineItems.materialId',
        rate: { $first: '$lineItems.rate' },
      },
    },
  ]);

  for (const row of rows) {
    const mid = row._id?.toString();
    if (mid && row.rate != null) rateByMaterial.set(mid, Number(row.rate));
  }

  return rateByMaterial;
}

async function getLatestApprovedRate(materialId) {
  if (!materialId) return null;
  const map = await getLatestApprovedRates([materialId.toString()]);
  return map.get(materialId.toString()) ?? null;
}

function attachUnitPrices(materials, rateByMaterial) {
  return materials.map((m) => {
    const id = m.id || m._id?.toString();
    const unitPrice = id ? rateByMaterial.get(id) ?? null : null;
    return { ...m, unitPrice };
  });
}

module.exports = {
  getLatestApprovedRate,
  getLatestApprovedRates,
  attachUnitPrices,
};
