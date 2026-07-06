/** Canonical material categories for procurement. */
export declare const MATERIAL_CATEGORY_NAMES: readonly ["Stationery", "Electrical Materials", "Civil Materials", "Mechanical Materials", "Others"];
export type MaterialCategoryName = (typeof MATERIAL_CATEGORY_NAMES)[number];
export declare const MATERIAL_CATEGORY_OTHERS: "Others";
export declare const ISSUE_TYPE_LABELS: {
    readonly WORK_ISSUE: "Work Issue";
    readonly CONTRACT_ISSUE: "Contract Issue";
};
export type IssueType = keyof typeof ISSUE_TYPE_LABELS;
export declare const ISSUE_TYPES: IssueType[];
