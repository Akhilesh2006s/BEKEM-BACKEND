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

  it('treats requirement as met when current stock + existing BT cover required qty', () => {
    const result = evaluateBranchTransferViability(
      [{ materialId: 'm1', requestedQty: 21, availableQty: 10, materialName: 'Cement' }],
      [{ materialId: 'm1', projects: [{ availableQty: 50 }] }],
      { m1: 11 }
    );
    assert.equal(result.lines[0].remainingNeedQty, 10);
    assert.equal(result.lines[0].shortfallAfterCurrent, 0);
    assert.equal(result.lines[0].shortfallAfterCombined, 0);
    assert.equal(result.currentProjectInsufficient, false);
    assert.equal(result.branchTransferViable, false);
  });

  it('is not viable when combined stock cannot cover full indent (63 need, 5 current, 50 other)', () => {
    const result = evaluateBranchTransferViability(
      [{ materialId: 'm1', requestedQty: 63, availableQty: 5, materialName: 'Anchor Bolts' }],
      [{ materialId: 'm1', projects: [{ availableQty: 50 }] }],
      { m1: 50 }
    );
    assert.equal(result.lines[0].requiredQty, 63);
    assert.equal(result.lines[0].combinedAvailableQty, 55);
    assert.equal(result.lines[0].shortfallAfterCombined, 8);
    assert.equal(result.lines[0].shortfallAfterCurrent, 8);
    assert.equal(result.currentProjectInsufficient, true);
    assert.equal(result.branchTransferViable, false);
  });

  it('still allows branch transfer when combined stock covers full indent but BT is partial', () => {
    const result = evaluateBranchTransferViability(
      [{ materialId: 'm1', requestedQty: 21, availableQty: 10 }],
      [{ materialId: 'm1', projects: [{ availableQty: 50 }] }],
      { m1: 5 }
    );
    assert.equal(result.lines[0].shortfallAfterCurrent, 6);
    assert.equal(result.lines[0].shortfallAfterCombined, 0);
    assert.equal(result.currentProjectInsufficient, true);
    assert.equal(result.branchTransferViable, true);
  });
});