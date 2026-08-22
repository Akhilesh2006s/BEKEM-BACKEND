const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  indentExceedsPmApprovalLevel,
  PM_INDENT_APPROVAL_LIMIT_INR,
} = require('./services/indentApprovalRouting');

describe('PM per-indent approval routing', () => {
  it('₹6,800 is above the ₹5,000 PM approval level', () => {
    assert.strictEqual(PM_INDENT_APPROVAL_LIMIT_INR, 5000);
    assert.strictEqual(indentExceedsPmApprovalLevel(6800, 'ABOVE_5000'), true);
  });

  it('values at or below the PM limit do not require HO for approval level', () => {
    assert.strictEqual(indentExceedsPmApprovalLevel(5000, 'ABOVE_5000'), false);
    assert.strictEqual(indentExceedsPmApprovalLevel(4999, 'BELOW_5000'), false);
  });
});
