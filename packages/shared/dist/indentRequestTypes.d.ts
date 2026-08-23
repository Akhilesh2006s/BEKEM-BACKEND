import type { MaterialDto } from './dtos';
export declare const INDENT_VALUE_CAP_INR = 5000;
export type IndentRequestType = 'BELOW_5000' | 'ABOVE_5000';
export declare const INDENT_REQUEST_TYPES: IndentRequestType[];
export declare const INDENT_REQUEST_TYPE_LABELS: Record<IndentRequestType, string>;
export declare function resolveMaterialUnitPrice(material: Pick<MaterialDto, 'unitPrice' | 'referenceUnitPrice'>): number;
/** True when catalogue/API returned a usable positive unit price. */
export declare function hasMaterialUnitPrice(material: Pick<MaterialDto, 'unitPrice' | 'referenceUnitPrice'>): boolean;
/**
 * True when the material's own unit price already meets/exceeds the Below ₹5,000 cap.
 * Such materials must not be selectable on Below ₹5,000 indents.
 */
export declare function isMaterialOverBelowCap(material: Pick<MaterialDto, 'unitPrice' | 'referenceUnitPrice'>): boolean;
export declare function computeIndentLineTotal(quantity: number, unitPrice: number): number;
export declare function computeIndentRunningTotal(lines: Array<{
    quantity: number;
    material: Pick<MaterialDto, 'unitPrice' | 'referenceUnitPrice'>;
}>): number;
/** Site / store must not see pricing on indents (Below or Above ₹5,000). */
export declare function hideIndentPricingForRole(role: string, indentRequestType?: IndentRequestType | null): boolean;
export declare const INDENT_CAP_REACHED_MESSAGE = "The \u20B95,000 limit for this indent has been reached. Please create an Above \u20B95,000 indent request if additional materials are required.";
/** PM may close a single indent only up to this value. Above this, routing goes to HO. */
export declare const PM_INDENT_APPROVAL_LIMIT_INR = 5000;
export declare const PM_ABOVE_APPROVAL_LEVEL_MESSAGE = "This indent value is higher than the PM approval level. Please proceed to HO level for further approvals.";
export declare const PM_APPROVED_FORWARDED_TO_HO_MESSAGE = "Approved and forwarded to HO level.";
/** True when this indent's value is above the PM's per-indent approval limit. */
export declare function indentExceedsPmApprovalLevel(estimatedValue?: number | null, indentRequestType?: IndentRequestType | null): boolean;
