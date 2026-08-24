const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { computeRequiredQty } = require('@afios/shared');
const { computeLineStockFields } = require('./services/indentStockService');

describe('indent stock comparison', () => {
  it('computeRequiredQty matches business rules', () => {
    assert.strictEqual(computeRequiredQty(100, 100), 0);
    assert.strictEqual(computeRequiredQty(100, 150), 0);
    assert.strictEqual(computeRequiredQty(100, 40), 60);
    assert.strictEqual(computeRequiredQty(80, 0), 80);
    assert.strictEqual(computeRequiredQty(0, 0), 0);
  });

  it('computeLineStockFields derives available from ledger', () => {
    const fields = computeLineStockFields(
      { quantityRequested: 80 },
      { quantityOnHand: 0, quantityReserved: 0 }
    );
    assert.strictEqual(fields.requestedQty, 80);
    assert.strictEqual(fields.availableQty, 0);
    assert.strictEqual(fields.requiredQty, 80);
    assert.ok(!('existingStock' in fields));
  });

  it('computeLineStockFields treats reserved stock as unavailable', () => {
    const fields = computeLineStockFields(
      { quantityRequested: 10 },
      { quantityOnHand: 100, quantityReserved: 95 }
    );
    assert.strictEqual(fields.availableQty, 5);
    assert.strictEqual(fields.requiredQty, 5);
    assert.strictEqual(fields.availableToIssueQty, 5);
    assert.strictEqual(fields.pendingReceiptQty, 5);
  });

  it('local stock covering request clears pending receipt and caps ready-to-issue', () => {
    const fields = computeLineStockFields(
      { quantityRequested: 10, quantityIssued: 0 },
      { quantityOnHand: 11, quantityReserved: 0 },
      0
    );
    assert.strictEqual(fields.availableQty, 11);
    assert.strictEqual(fields.requiredQty, 0);
    assert.strictEqual(fields.availableToIssueQty, 10);
    assert.strictEqual(fields.pendingReceiptQty, 0);
  });

  it('pending receipt shrinks after issue and GRN against shortfall', () => {
    const fields = computeLineStockFields(
      { quantityRequested: 10, quantityIssued: 3 },
      { quantityOnHand: 2, quantityReserved: 0 },
      4
    );
    assert.strictEqual(fields.availableToIssueQty, 2);
    assert.strictEqual(fields.pendingReceiptQty, 5);
  });
});
