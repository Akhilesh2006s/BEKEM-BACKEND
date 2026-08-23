const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateBranchTransferViability,
} = require('./services/pmCrossProjectStockService');

describe('PM branch-transfer combined-stock formula', () => {
  it('is viable when current + other projects cover the required qty', () => {
    const result = evaluateBranchTransferViability(
      [{ materialId: 'm1', requestedQty: 10, availableQty: 3, materialName: 'Cement' }],
      [{ materialId: 'm1', projects: [{ availableQty: 8 }] }]
    );
    assert.equal(result.currentProjectInsufficient, true);
    assert.equal(result.branchTransferViable, true);
    assert.equal(result.lines[0].combinedAvailableQty, 11);
    assert.equal(result.lines[0].shortfallAfterCombined, 0);
  });

  it('is not viable when combined stock is still short', () => {
    const result = evaluateBranchTransferViability(
      [{ materialId: 'm1', requestedQty: 10, availableQty: 3 }],
      [{ materialId: 'm1', projects: [{ availableQty: 4 }] }]
    );
    assert.equal(result.currentProjectInsufficient, true);
    assert.equal(result.branchTransferViable, false);
    assert.equal(result.lines[0].shortfallAfterCombined, 3);
  });

  it('is not a branch-transfer decision when current project already covers', () => {
    const result = evaluateBranchTransferViability(
      [{ materialId: 'm1', requestedQty: 10, availableQty: 12 }],
      [{ materialId: 'm1', projects: [{ availableQty: 50 }] }]
    );
    assert.equal(result.currentProjectInsufficient, false);
    assert.equal(result.branchTransferViable, false);
  });
});
