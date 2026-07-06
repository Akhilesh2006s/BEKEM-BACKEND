export declare function round2(n: number): number;
/** Common GST slabs used on site — user picks 5% or 18%. */
export declare const GST_PERCENT_OPTIONS: readonly [5, 18];
export type GstPercentOption = (typeof GST_PERCENT_OPTIONS)[number];
export declare const DEFAULT_GST_PERCENT: GstPercentOption;
export declare function snapGstPercent(value?: number | null): GstPercentOption;
export interface GstBreakdown {
    subtotal: number;
    gstPercent: number;
    gstAmount: number;
    finalAmount: number;
}
/** Pre-tax rate × qty with GST added on top (PO line items). */
export declare function computeGstBreakdown(quantity: number, rate: number, gstPercent?: number): GstBreakdown;
/** Alias used by quotation comparison (qty often 1 or indent total qty). */
export declare function computeInclusiveFinalCost(rate: number, quantity: number, gstPercent: number): number;
export declare function computePoLineTotals(quantity: number, rate: number, gstPercent?: number): {
    lineTotal: number;
    tax: number;
    grandTotal: number;
    amount: number;
    gstPercent: number;
    gstAmount: number;
    finalAmount: number;
};
