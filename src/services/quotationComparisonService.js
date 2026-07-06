const { Quotation, Vendor } = require('../models');
const { computeGstBreakdown } = require('@afios/shared');

function computeFinalCost(rate, quantity, gstPercent = 18) {
  return computeGstBreakdown(quantity, rate, gstPercent).finalAmount;
}

function serializeQuotationRow(q, { quantity = 1, isL1 = false } = {}) {
  const vendor = q.vendorId;
  const rate = q.rate != null ? q.rate : q.amount / Math.max(1, quantity);
  const gstPercent = q.gstPercent ?? 18;
  const breakdown = computeGstBreakdown(quantity, rate, gstPercent);
  const finalCost = q.amount ?? breakdown.finalAmount;
  const paymentTerms = q.paymentTerms || q.terms || '';
  return {
    id: q._id.toString(),
    rfqId: q.rfqId?.toString?.() || String(q.rfqId),
    vendorId: vendor?._id?.toString() || vendor?.toString(),
    vendorName: vendor?.name || 'Vendor',
    rate,
    gstPercent,
    subtotal: breakdown.subtotal,
    gstAmount: breakdown.gstAmount,
    finalCost,
    paymentTerms,
    deliveryTerms: q.deliveryTerms || '',
    isL1,
    submittedAt: q.submittedAt?.toISOString?.() || q.submittedAt,
  };
}

function pickL1Quotation(quotations, quantity = 1) {
  if (!quotations?.length) return null;
  return quotations.reduce((best, q) => {
    const cost = q.amount ?? computeFinalCost(q.rate, quantity, q.gstPercent);
    const bestCost = best.amount ?? computeFinalCost(best.rate, quantity, best.gstPercent);
    return cost < bestCost ? q : best;
  });
}

function buildComparisonTable(quotations, quantity = 1) {
  const l1 = pickL1Quotation(quotations, quantity);
  const l1Id = l1?._id?.toString();
  const vendors = quotations.map((q) =>
    serializeQuotationRow(q, { quantity, isL1: q._id.toString() === l1Id })
  );
  vendors.sort((a, b) => a.finalCost - b.finalCost);
  return {
    vendors,
    l1VendorId: l1?.vendorId?._id?.toString() || l1?.vendorId?.toString(),
    l1QuotationId: l1Id,
  };
}

async function upsertRfqQuotations(rfq, vendorQuotes, quantity) {
  const results = [];
  for (const row of vendorQuotes) {
    const { vendorId, rate, gstPercent, paymentTerms, deliveryTerms } = row;
    const finalCost = computeFinalCost(rate, quantity, gstPercent);
    const terms = paymentTerms || '';
    let q = await Quotation.findOne({ rfqId: rfq._id, vendorId });
    if (q) {
      q.rate = rate;
      q.gstPercent = gstPercent ?? 18;
      q.paymentTerms = paymentTerms || '';
      q.deliveryTerms = deliveryTerms || '';
      q.amount = finalCost;
      q.terms = terms;
      await q.save();
    } else {
      q = await Quotation.create({
        rfqId: rfq._id,
        vendorId,
        rate,
        gstPercent: gstPercent ?? 18,
        paymentTerms: paymentTerms || '',
        deliveryTerms: deliveryTerms || '',
        amount: finalCost,
        terms,
      });
    }
    results.push(q);
  }
  const vendorObjectIds = vendorQuotes.map((v) => v.vendorId);
  const existingIds = (rfq.vendorIds || []).map((id) =>
    (id?._id || id)?.toString()
  );
  const merged = [...new Set([...existingIds, ...vendorObjectIds.map((id) => id.toString())])];
  const mongoose = require('mongoose');
  rfq.vendorIds = merged.map((id) => new mongoose.Types.ObjectId(id));
  await rfq.save();
  return Quotation.find({ rfqId: rfq._id }).populate('vendorId');
}

async function ensureDefaultVendorQuotations(rfq, purchaseRequest, materialIds) {
  const existing = await Quotation.find({ rfqId: rfq._id }).populate('vendorId');
  if (existing.length >= 3) return existing;

  let vendors = [];
  if (materialIds?.length) {
    const { Material } = require('../models');
    const materials = await Material.find({ _id: { $in: materialIds } });
    const categories = [...new Set(materials.map((m) => m.category).filter(Boolean))];
    vendors = await Vendor.find({
      isActive: { $ne: false },
      $or: [
        { materialIds: { $in: materialIds } },
        { suppliedCategories: { $in: categories } },
        { category: { $in: categories } },
      ],
    }).limit(5);
  }
  if (!vendors.length) {
    vendors = await Vendor.find({ isActive: { $ne: false } }).limit(5);
  }

  const baseAmount = purchaseRequest?.amountEstimate || 100000;
  const qty = 1;
  const rows = [];
  const usedIds = new Set(existing.map((q) => (q.vendorId._id || q.vendorId).toString()));

  for (const vendor of vendors) {
    if (usedIds.has(vendor._id.toString())) continue;
    if (existing.length + rows.length >= 3) break;
    const variance = 0.9 + Math.random() * 0.2;
    rows.push({
      vendorId: vendor._id,
      rate: Math.round((baseAmount * variance) / qty),
      gstPercent: 18,
      paymentTerms: '100% payment within 30 days from the date of supply',
      deliveryTerms: 'Delivery as per project schedule',
    });
    usedIds.add(vendor._id.toString());
  }

  if (rows.length) {
    return upsertRfqQuotations(rfq, rows, qty);
  }
  return existing;
}

module.exports = {
  computeFinalCost,
  serializeQuotationRow,
  pickL1Quotation,
  buildComparisonTable,
  upsertRfqQuotations,
  ensureDefaultVendorQuotations,
};
