/**
 * RBAC permission matrix tests
 * Run: npm run test -w @afios/api
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { PERMISSION_MATRIX, UserRole } = require('@afios/shared');

describe('Permission Matrix', () => {
  it('Site Manager can create material requests but not allocate', () => {
    const caps = PERMISSION_MATRIX[UserRole.SITE_INCHARGE];
    assert.ok(caps.includes('CREATE_MATERIAL_REQUEST'));
    assert.ok(!caps.includes('ALLOCATE_MATERIAL_REQUEST'));
  });

  it('Store Manager can allocate and forward but not create PO', () => {
    const caps = PERMISSION_MATRIX[UserRole.STORE_INCHARGE];
    assert.ok(caps.includes('ALLOCATE_MATERIAL_REQUEST'));
    assert.ok(caps.includes('FORWARD_MATERIAL_REQUEST'));
    assert.ok(caps.includes('VIEW_FINANCE'));
    assert.ok(!caps.includes('CREATE_PO'));
    assert.ok(!caps.includes('VERIFY_RECORDS'));
    assert.ok(!caps.includes('FINAL_APPROVAL'));
  });

  it('Project Manager approves PR but cannot create or edit PO', () => {
    const caps = PERMISSION_MATRIX[UserRole.PROJECT_MANAGER];
    assert.ok(caps.includes('APPROVE_MATERIAL_REQUEST'));
    assert.ok(caps.includes('CREATE_PURCHASE_REQUEST'));
    assert.ok(!caps.includes('CREATE_PO'));
    assert.ok(!caps.includes('VERIFY_RECORDS'));
    assert.ok(!caps.includes('FINAL_APPROVAL'));
  });

  it('Chairman cannot create PO', () => {
    const caps = PERMISSION_MATRIX[UserRole.CHAIRMAN];
    assert.ok(!caps.includes('CREATE_PO'));
    assert.ok(caps.includes('FINAL_APPROVAL'));
  });

  it('Site Manager has no PO capabilities', () => {
    const caps = PERMISSION_MATRIX[UserRole.SITE_INCHARGE];
    assert.ok(!caps.includes('CREATE_PO'));
    assert.ok(!caps.includes('VERIFY_RECORDS'));
    assert.ok(!caps.includes('FINAL_APPROVAL'));
  });

  it('Coordinator verifies POs but cannot create PO or final-approve', () => {
    const caps = PERMISSION_MATRIX[UserRole.COORDINATOR];
    assert.ok(caps.includes('VERIFY_RECORDS'));
    assert.ok(!caps.includes('CREATE_PO'));
    assert.ok(!caps.includes('FINAL_APPROVAL'));
    assert.ok(caps.includes('MANAGE_VENDORS'));
  });

  it('Chairman has final approval and analytics', () => {
    const caps = PERMISSION_MATRIX[UserRole.CHAIRMAN];
    assert.ok(caps.includes('FINAL_APPROVAL'));
    assert.ok(caps.includes('VIEW_USER_ANALYTICS'));
    assert.ok(!caps.includes('VERIFY_RECORDS'));
  });

  it('Coordinator has destructive admin permissions', () => {
    const caps = PERMISSION_MATRIX[UserRole.COORDINATOR];
    assert.ok(caps.includes('DELETE_RECORDS'));
    assert.ok(caps.includes('DELETE_INVENTORY_ITEM'));
  });

  it('Chairman has no destructive edit permissions', () => {
    const caps = PERMISSION_MATRIX[UserRole.CHAIRMAN];
    const editCaps = ['EDIT_ALLOCATION_QTY', 'EDIT_PROJECT_SCOPE', 'EDIT_PROCUREMENT'];
    for (const c of editCaps) {
      assert.ok(!caps.includes(c), `Chairman should not have ${c}`);
    }
    assert.ok(!caps.includes('DELETE_RECORDS'));
    assert.ok(!caps.includes('DELETE_INVENTORY_ITEM'));
  });

  it('Executive has full procurement capabilities', () => {
    const caps = PERMISSION_MATRIX[UserRole.EXECUTIVE];
    assert.ok(caps.includes('CREATE_RFQ'));
    assert.ok(caps.includes('CREATE_PO'));
    assert.ok(caps.includes('VIEW_ALL_PROJECTS'));
  });

  it('Every role has at least VIEW capability', () => {
    for (const role of Object.values(UserRole)) {
      const caps = PERMISSION_MATRIX[role];
      const hasView = caps.includes('VIEW_OWN_SCOPE') || caps.includes('VIEW_ALL_PROJECTS');
      assert.ok(hasView, `${role} should have view capability`);
    }
  });
});
