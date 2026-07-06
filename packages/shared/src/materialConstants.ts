/** Canonical material categories for procurement. */
export const MATERIAL_CATEGORY_NAMES = [
  'Stationery',
  'Electrical Materials',
  'Civil Materials',
  'Mechanical Materials',
  'Others',
] as const;

export type MaterialCategoryName = (typeof MATERIAL_CATEGORY_NAMES)[number];

export const MATERIAL_CATEGORY_OTHERS = 'Others' as const;

export const ISSUE_TYPE_LABELS = {
  WORK_ISSUE: 'Work Issue',
  CONTRACT_ISSUE: 'Contract Issue',
} as const;

export type IssueType = keyof typeof ISSUE_TYPE_LABELS;

export const ISSUE_TYPES = Object.keys(ISSUE_TYPE_LABELS) as IssueType[];
