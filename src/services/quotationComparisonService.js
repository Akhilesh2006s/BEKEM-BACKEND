const { Quotation, Vendor } = require('../models');
const { computeGstBreakdown } = require('@afios/shared');

function computeFinalCost(rate, quantity, gstPercent = 18) {
  return computeGstBreakdown(quantity, rate, gstPercent).finalAmount;
}

function toId(value) {
  return (value?._id || value)?.toString?.() || '';
}

function buildLineMeta(lineItems = []) {
  return lineItems.map((line) => {
    const materialId = toId(line.materialId);
    const quantity = Number(line.quantityRequested || line.quantity || 0);
    const unit = line.unit || line.materialId?.unit || 'Nos';
    const name = line.materialId?.name || line.material?.name || 'Item';
    return { materialId, quantity, unit, name };
  });
}

function computeQuotationTotals(q, lineItems = [], fallbackQuantity = 1) {
  const lines = buildLineMeta(lineItems);
  if (!lines.length) {
    const rate = q.rate != null ? Number(q.rate) : Number(q.amount || 0) / Math.max(1, fallbackQuantity);
    const gstPercent = Number(q.gstPercent ?? 18);
    const breakdown = computeGstBreakdown(fallbackQuantity, rate, gstPercent);
    return {
      subtotal: breakdown.subtotal,
      gstAmount: breakdown.gstAmount,
      finalCost: q.amount ?? breakdown.finalAmount,
      itemRates: [],
    };
  }

  const selectedIds = (q.selectedMaterialIds || []).map((id) => toId(id)).filter(Boolean);
  // Empty selectedMaterialIds means "all indent lines" (vendor quoted the full RFQ scope).
  const useSubset = Array.isArray(q.selectedMaterialIds) && selectedIds.length > 0;
  const selected = new Set(selectedIds);
  const byMaterial = new Map(
    (q.itemQuotes || []).map((it) => [toId(it.materialId), { rate: Number(it.rate || 0), gstPercent: Number(it.gstPercent ?? 18) }])
  );

  let subtotal = 0;
  let gstAmount = 0;
  const itemRates = [];

  for (const line of lines) {
    if (!line.materialId) continue;
    if (useSubset && !selected.has(line.materialId)) continue;
    const iq = byMaterial.get(line.materialId);
    const rate = iq ? iq.rate : Number(q.rate || 0);
    const gstPercent = iq ? iq.gstPercent : Number(q.gstPercent ?? 18);
    const breakdown = computeGstBreakdown(line.quantity || 0, rate, gstPercent);
    subtotal += breakdown.subtotal;
    gstAmount += breakdown.gstAmount;
    itemRates.push({
      materialId: line.materialId,
      materialName: line.name,
      quantity: line.quantity,
      unit: line.unit,
      rate,
      gstPercent,
      finalCost: breakdown.finalAmount,
    });
  }

  return {
    subtotal: Math.round(subtotal),
    gstAmount: Math.round(gstAmount),
    finalCost: Math.round(subtotal + gstAmount),
    itemRates,
  };
}

function serializeQuotationRow(q, { quantity = 1, isL1 = false, lineItems = [] } = {}) {
  const vendor = q.vendorId;
  const rate = q.rate != null ? q.rate : q.amount / Math.max(1, quantity);
  const gstPercent = q.gstPercent ?? 18;
  const totals = computeQuotationTotals(q, lineItems, quantity);
  const paymentTerms = q.paymentTerms || q.terms || '';
  return {
    id: q._id.toString(),
    rfqId: q.rfqId?.toString?.() || String(q.rfqId),
    vendorId: vendor?._id?.toString() || vendor?.toString(),
    vendorName: vendor?.name || 'Vendor',
    rate,
    gstPercent,
    subtotal: totals.subtotal,
    gstAmount: totals.gstAmount,
    finalCost: totals.finalCost,
    paymentTerms,
    deliveryTerms: q.deliveryTerms || '',
    itemRates: totals.itemRates,
    selectedMaterialIds: (q.selectedMaterialIds || []).map((id) => toId(id)),
    isL1,
    submittedAt: q.submittedAt?.toISOString?.() || q.submittedAt,
  };
}

function pickL1Quotation(quotations, quantity = 1, lineItems = []) {
  if (!quotations?.length) return null;
  return quotations.reduce((best, q) => {
    const cost = computeQuotationTotals(q, lineItems, quantity).finalCost;
    const bestCost = computeQuotationTotals(best, lineItems, quantity).finalCost;
    return cost < bestCost ? q : best;
  });
}

function filterActiveQuotations(quotations) {
  const assigned = quotations.filter((q) => (q.selectedMaterialIds || []).length > 0);
  return assigned.length ? assigned : quotations;
}

function buildMaterialOffers(quotations, line) {
  const offers = [];
  const active = filterActiveQuotations(quotations);
  for (const q of active) {
    const vendor = q.vendorId;
    const vendorId = toId(vendor);
    if (!vendorId) continue;
    const selected = (q.selectedMaterialIds || []).map((id) => toId(id));
    const hasExplicitSelection = selected.length > 0;
    // Vendor must be assigned to this material when RFQ has per-item vendor assignment.
    if (hasExplicitSelection && !selected.includes(line.materialId)) continue;

    const vendorName = vendor?.name || 'Vendor';
    const iq = (q.itemQuotes || []).find((it) => toId(it.materialId) === line.materialId);
    const hasAnyItemRates = (q.itemQuotes || []).some((it) => Number(it.rate || 0) > 0);
    let rate = 0;
    let gstPercent = Number(q.gstPercent ?? 18);
    if (iq && Number(iq.rate || 0) > 0) {
      rate = Number(iq.rate || 0);
      gstPercent = Number(iq.gstPercent ?? 18);
    } else if (!hasAnyItemRates && Number(q.rate || 0) > 0) {
      // Header-only quote (no per-item rates) — still show on this line for approval.
      rate = Number(q.rate || 0);
    } else {
      // Vendor quoted other items but not this one — skip.
      continue;
    }

    const breakdown = computeGstBreakdown(line.quantity || 0, rate, gstPercent);
    offers.push({
      vendorId,
      vendorName,
      rate,
      gstPercent,
      finalCost: breakdown.finalAmount,
    });
  }
  offers.sort((a, b) => {
    if (a.rate != null && b.rate != null) return a.rate - b.rate;
    return a.vendorName.localeCompare(b.vendorName);
  });
  return offers;
}

function buildComparisonTable(quotations, quantity = 1, lineItems = []) {
  const activeQuotations = filterActiveQuotations(quotations);
  const l1 = pickL1Quotation(activeQuotations, quantity, lineItems);
  const l1Id = l1?._id?.toString();
  const vendors = activeQuotations.map((q) =>
    serializeQuotationRow(q, { quantity, isL1: q._id.toString() === l1Id, lineItems })
  );
  vendors.sort((a, b) => a.finalCost - b.finalCost);
  const lines = buildLineMeta(lineItems);
  const itemComparisons = lines.map((line) => {
    const offers = buildMaterialOffers(activeQuotations, line);
    const pricedOffers = offers.filter((o) => o.rate != null);
    const minOffer = pricedOffers.length
      ? pricedOffers.reduce((a, b) => (a.rate <= b.rate ? a : b))
      : null;
    const maxOffer = pricedOffers.length
      ? pricedOffers.reduce((a, b) => (a.rate >= b.rate ? a : b))
      : null;
    return {
      materialId: line.materialId,
      materialName: line.name,
      quantity: line.quantity,
      unit: line.unit,
      minOffer,
      maxOffer,
      offers,
    };
  });
  return {
    vendors,
    itemComparisons,
    l1VendorId: l1?.vendorId?._id?.toString() || l1?.vendorId?.toString(),
    l1QuotationId: l1Id,
  };
}

async function upsertRfqQuotations(rfq, vendorQuotes, quantity, lineItems = []) {
  const results = [];
  const lineMap = new Map(buildLineMeta(lineItems).map((line) => [line.materialId, line]));
  for (const row of vendorQuotes) {
    const { vendorId, rate, gstPercent, paymentTerms, deliveryTerms, itemRates, selectedMaterialIds } = row;
    let finalCost = computeFinalCost(rate, quantity, gstPercent);
    const normalizedItemQuotes = Array.isArray(itemRates)
      ? itemRates
          .map((it) => {
            const materialId = toId(it.materialId);
            const line = lineMap.get(materialId);
            if (!materialId || !line) return null;
            const itemRate = Number(it.rate || 0);
            const itemGst = Number(it.gstPercent ?? 18);
            return {
              materialId,
              rate: itemRate,
              gstPercent: itemGst,
              amount: computeFinalCost(itemRate, line.quantity, itemGst),
            };
          })
          .filter(Boolean)
      : [];
    if (normalizedItemQuotes.length) {
      finalCost = Math.round(normalizedItemQuotes.reduce((sum, it) => sum + Number(it.amount || 0), 0));
    }
    const terms = paymentTerms || '';
    let q = await Quotation.findOne({ rfqId: rfq._id, vendorId });
    if (q) {
      q.rate = rate;
      q.gstPercent = gstPercent ?? 18;
      q.paymentTerms = paymentTerms || '';
      q.deliveryTerms = deliveryTerms || '';
      q.amount = finalCost;
      q.terms = terms;
      q.itemQuotes = normalizedItemQuotes;
      q.selectedMaterialIds = (selectedMaterialIds || []).map((id) => id);
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
        itemQuotes: normalizedItemQuotes,
        selectedMaterialIds: (selectedMaterialIds || []).map((id) => id),
      });
    }
    results.push(q);
  }
  const vendorObjectIds = vendorQuotes.map((v) => v.vendorId);
  const submittedIds = new Set(vendorObjectIds.map((id) => id.toString()));
  const mongoose = require('mongoose');
  await Quotation.deleteMany({
    rfqId: rfq._id,
    vendorId: { $nin: Array.from(submittedIds).map((id) => new mongoose.Types.ObjectId(id)) },
  });
  rfq.vendorIds = vendorObjectIds.map((id) => new mongoose.Types.ObjectId(id));
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
  let qty = 1;
  const prId = purchaseRequest?._id || purchaseRequest;
  if (prId) {
    const { PurchaseRequest, MaterialRequest } = require('../models');
    const { getIndentLineItems } = require('./materialRequestHelpers');
    const pr =
      typeof purchaseRequest === 'object' && purchaseRequest.materialRequestId
        ? purchaseRequest
        : await PurchaseRequest.findById(prId).lean();
    if (pr?.materialRequestId) {
      const mr = await MaterialRequest.findById(pr.materialRequestId);
      if (mr) {
        qty =
          getIndentLineItems(mr).reduce((s, l) => s + (l.quantityRequested || 0), 0) || 1;
      }
    }
  }
  qty = Math.max(1, qty);
  const rows = [];
  const usedIds = new Set(existing.map((q) => (q.vendorId._id || q.vendorId).toString()));

  for (const vendor of vendors) {
    if (usedIds.has(vendor._id.toString())) continue;
    if (existing.length + rows.length >= 3) break;
    const variance = 0.9 + Math.random() * 0.2;
    const lineSubtotal = Math.round(baseAmount * variance);
    rows.push({
      vendorId: vendor._id,
      rate: Math.max(1, Math.round(lineSubtotal / qty)),
      gstPercent: 18,
      paymentTerms: '100% payment within 30 days from the date of supply',
      deliveryTerms: 'Delivery as per project schedule',
    });
    usedIds.add(vendor._id.toString());
  }

  if (existing.length + rows.length < 3) {
    const fallback = await Vendor.find({
      isActive: { $ne: false },
      authorizationStatus: { $in: ['AUTHORIZED', null] },
      _id: { $nin: [...usedIds] },
    })
      .sort({ name: 1 })
      .limit(5);
    for (const vendor of fallback) {
      if (usedIds.has(vendor._id.toString())) continue;
      if (existing.length + rows.length >= 3) break;
      const variance = 0.9 + Math.random() * 0.2;
      const lineSubtotal = Math.round(baseAmount * variance);
      rows.push({
        vendorId: vendor._id,
        rate: Math.max(1, Math.round(lineSubtotal / qty)),
        gstPercent: 18,
        paymentTerms: '100% payment within 30 days from the date of supply',
        deliveryTerms: 'Delivery as per project schedule',
      });
      usedIds.add(vendor._id.toString());
    }
  }

  if (rows.length) {
    return upsertRfqQuotations(rfq, rows, qty);
  }
  return existing;
}

function applyL1QuoteRatesToLineItems(lineItems, quotations) {
  if (!lineItems?.length || !quotations?.length) return lineItems;
  const l1 = pickL1Quotation(quotations);
  if (!l1) return lineItems;
  const totalQty = lineItems.reduce((s, row) => s + (row.quantity || 0), 0) || 1;
  const unitRate = l1.rate != null ? Number(l1.rate) : Number(l1.amount) / totalQty;
  return lineItems.map((row) => {
    const rate = unitRate;
    const amount = (row.quantity || 0) * rate;
    return { ...row, rate, amount };
  });
}

module.exports = {
  computeFinalCost,
  serializeQuotationRow,
  pickL1Quotation,
  buildComparisonTable,
  applyL1QuoteRatesToLineItems,
  upsertRfqQuotations,
  ensureDefaultVendorQuotations,
};
