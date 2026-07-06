export function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Common GST slabs used on site — user picks 5% or 18%. */
export const GST_PERCENT_OPTIONS = [5, 18] as const;
export type GstPercentOption = (typeof GST_PERCENT_OPTIONS)[number];
export const DEFAULT_GST_PERCENT: GstPercentOption = 18;

export function snapGstPercent(value?: number | null): GstPercentOption {
  return Number(value) === 5 ? 5 : DEFAULT_GST_PERCENT;
}

export interface GstBreakdown {
  subtotal: number;
  gstPercent: number;
  gstAmount: number;
  finalAmount: number;
}

/** Pre-tax rate × qty with GST added on top (PO line items). */
export function computeGstBreakdown(
  quantity: number,
  rate: number,
  gstPercent = 18
): GstBreakdown {
  const subtotal = round2((Number(quantity) || 0) * (Number(rate) || 0));
  const gst = Number(gstPercent) || 0;
  const gstAmount = round2(subtotal * (gst / 100));
  const finalAmount = round2(subtotal + gstAmount);
  return { subtotal, gstPercent: gst, gstAmount, finalAmount };
}

/** Alias used by quotation comparison (qty often 1 or indent total qty). */
export function computeInclusiveFinalCost(rate: number, quantity: number, gstPercent: number) {
  return computeGstBreakdown(quantity, rate, gstPercent).finalAmount;
}

export function computePoLineTotals(quantity: number, rate: number, gstPercent = 18) {
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
