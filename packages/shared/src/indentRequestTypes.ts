import type { MaterialDto } from './dtos';

export const INDENT_VALUE_CAP_INR = 5000;

export type IndentRequestType = 'BELOW_5000' | 'ABOVE_5000';

export const INDENT_REQUEST_TYPES: IndentRequestType[] = ['BELOW_5000', 'ABOVE_5000'];

export const INDENT_REQUEST_TYPE_LABELS: Record<IndentRequestType, string> = {
  BELOW_5000: 'Below ₹5,000',
  ABOVE_5000: 'Above ₹5,000',
};

export function resolveMaterialUnitPrice(material: Pick<MaterialDto, 'unitPrice' | 'referenceUnitPrice'>): number {
  const raw = material.unitPrice ?? material.referenceUnitPrice;
  const n = Number(raw);
  // Treat missing / non-positive catalogue rates as 0 so the ₹5,000 cap
  // still works; callers that need "price unavailable" should check hasMaterialUnitPrice.
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** True when catalogue/API returned a usable positive unit price. */
export function hasMaterialUnitPrice(material: Pick<MaterialDto, 'unitPrice' | 'referenceUnitPrice'>): boolean {
  return resolveMaterialUnitPrice(material) > 0;
}

/**
 * True when the material's own unit price already meets/exceeds the Below ₹5,000 cap.
 * Such materials must not be selectable on Below ₹5,000 indents.
 */
export function isMaterialOverBelowCap(
  material: Pick<MaterialDto, 'unitPrice' | 'referenceUnitPrice'>
): boolean {
  return resolveMaterialUnitPrice(material) >= INDENT_VALUE_CAP_INR;
}

export function computeIndentLineTotal(quantity: number, unitPrice: number): number {
  return Math.round((quantity * unitPrice + Number.EPSILON) * 100) / 100;
}

export function computeIndentRunningTotal(
  lines: Array<{ quantity: number; material: Pick<MaterialDto, 'unitPrice' | 'referenceUnitPrice'> }>
): number {
  const sum = lines.reduce(
    (acc, line) =>
      acc + computeIndentLineTotal(line.quantity, resolveMaterialUnitPrice(line.material)),
    0
  );
  return Math.round((sum + Number.EPSILON) * 100) / 100;
}

/** Site / store must not see pricing on above-cap indents. */
export function hideIndentPricingForRole(
  role: string,
  indentRequestType?: IndentRequestType | null
): boolean {
  if (indentRequestType !== 'ABOVE_5000') return false;
  return role === 'SITE_INCHARGE' || role === 'STORE_INCHARGE';
}

export const INDENT_CAP_REACHED_MESSAGE =
  'The ₹5,000 limit for this indent has been reached. Please create an Above ₹5,000 indent request if additional materials are required.';
