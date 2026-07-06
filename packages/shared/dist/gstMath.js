"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_GST_PERCENT = exports.GST_PERCENT_OPTIONS = void 0;
exports.round2 = round2;
exports.snapGstPercent = snapGstPercent;
exports.computeGstBreakdown = computeGstBreakdown;
exports.computeInclusiveFinalCost = computeInclusiveFinalCost;
exports.computePoLineTotals = computePoLineTotals;
function round2(n) {
    return Math.round(n * 100) / 100;
}
/** Common GST slabs used on site — user picks 5% or 18%. */
exports.GST_PERCENT_OPTIONS = [5, 18];
exports.DEFAULT_GST_PERCENT = 18;
function snapGstPercent(value) {
    return Number(value) === 5 ? 5 : exports.DEFAULT_GST_PERCENT;
}
/** Pre-tax rate × qty with GST added on top (PO line items). */
function computeGstBreakdown(quantity, rate, gstPercent = 18) {
    const subtotal = round2((Number(quantity) || 0) * (Number(rate) || 0));
    const gst = Number(gstPercent) || 0;
    const gstAmount = round2(subtotal * (gst / 100));
    const finalAmount = round2(subtotal + gstAmount);
    return { subtotal, gstPercent: gst, gstAmount, finalAmount };
}
/** Alias used by quotation comparison (qty often 1 or indent total qty). */
function computeInclusiveFinalCost(rate, quantity, gstPercent) {
    return computeGstBreakdown(quantity, rate, gstPercent).finalAmount;
}
function computePoLineTotals(quantity, rate, gstPercent = 18) {
    const breakdown = computeGstBreakdown(quantity, rate, gstPercent);
    return {
        lineTotal: breakdown.subtotal,
        tax: breakdown.gstAmount,
        grandTotal: breakdown.finalAmount,
        amount: breakdown.subtotal,
        gstPercent: breakdown.gstPercent,
        gstAmount: breakdown.gstAmount,
        finalAmount: breakdown.finalAmount,
    };
}
