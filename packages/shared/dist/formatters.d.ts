export declare function formatDate(date: Date | string | null | undefined): string;
export declare function formatCurrency(amount: number | null | undefined): string;
export declare function formatQuantity(qty: number, unit?: string): string;
/** Whole-unit counts for inventory dashboards (no float artifacts). */
export declare function formatUnitCount(value: number | null | undefined): string;
export declare function getGreeting(): string;
export declare function getFirstName(fullName: string): string;
/** Shortfall quantity for indent stock comparison (never negative). */
export declare function computeRequiredQty(requestedQty: number, availableQty: number): number;
