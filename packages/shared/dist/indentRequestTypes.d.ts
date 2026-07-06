import type { MaterialDto } from './dtos';
export declare const INDENT_VALUE_CAP_INR = 5000;
export type IndentRequestType = 'BELOW_5000' | 'ABOVE_5000';
export declare const INDENT_REQUEST_TYPES: IndentRequestType[];
export declare const INDENT_REQUEST_TYPE_LABELS: Record<IndentRequestType, string>;
export declare function resolveMaterialUnitPrice(material: Pick<MaterialDto, 'unitPrice' | 'referenceUnitPrice'>): number;
export declare function computeIndentLineTotal(quantity: number, unitPrice: number): number;
export declare function computeIndentRunningTotal(lines: Array<{
    quantity: number;
    material: Pick<MaterialDto, 'unitPrice' | 'referenceUnitPrice'>;
}>): number;
/** Site / store must not see pricing on above-cap indents. */
export declare function hideIndentPricingForRole(role: string, indentRequestType?: IndentRequestType | null): boolean;
export declare const INDENT_CAP_REACHED_MESSAGE = "The \u20B95,000 limit for this indent has been reached. Please create an Above \u20B95,000 indent request if additional materials are required.";
