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
  });
});
