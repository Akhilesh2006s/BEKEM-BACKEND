"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ISSUE_TYPES = exports.ISSUE_TYPE_LABELS = exports.MATERIAL_CATEGORY_OTHERS = exports.MATERIAL_CATEGORY_NAMES = void 0;
/** Canonical material categories for procurement. */
exports.MATERIAL_CATEGORY_NAMES = [
    'Stationery',
    'Electrical Materials',
    'Civil Materials',
    'Mechanical Materials',
    'Others',
];
exports.MATERIAL_CATEGORY_OTHERS = 'Others';
exports.ISSUE_TYPE_LABELS = {
    WORK_ISSUE: 'Work Issue',
    CONTRACT_ISSUE: 'Contract Issue',
};
exports.ISSUE_TYPES = Object.keys(exports.ISSUE_TYPE_LABELS);
