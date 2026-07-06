const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestDb, teardownTestDb, loginAs, getApp } = require('./test/helpers');
const { loadOrgSettings, updateOrgSettings } = require('./services/orgSettingsService');

describe('Org settings & configurable approval limits', () => {
  let app;
  let coordToken;
  let pmToken;

  before(async () => {
    await setupTestDb();
    app = getApp();
    coordToken = await loginAs('coordinator@bekem.com');
    pmToken = await loginAs('pm@bekem.com');
    await loadOrgSettings();
  });

  after(async () => {
    await updateOrgSettings({ poPmMaxInr: 5000, poCoordinatorMaxInr: 10000, mrPmDailyMaxInr: 5000 });
    await teardownTestDb();
  });

  it('returns approval limits for authenticated users', async () => {
    const res = await request(app)
      .get('/api/admin/org-settings/approval-limits')
      .set('Authorization', `Bearer ${pmToken}`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.data.poPmMaxInr > 0);
    assert.ok(res.body.data.approvalRoutingNote.includes('Project Manager'));
  });

  it('coordinator can read full org settings', async () => {
    const res = await request(app)
      .get('/api/admin/org-settings')
      .set('Authorization', `Bearer ${coordToken}`);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.data.expenseCategories));
    assert.ok(res.body.data.expenseCategories.some((c) => c.key === 'GROCERY'));
  });

  it('pm cannot access admin org settings', async () => {
    const res = await request(app)
      .get('/api/admin/org-settings')
      .set('Authorization', `Bearer ${pmToken}`);
    assert.strictEqual(res.status, 403);
  });

  it('coordinator can update PO approval limits', async () => {
    const res = await request(app)
      .patch('/api/admin/org-settings')
      .set('Authorization', `Bearer ${coordToken}`)
      .send({ poPmMaxInr: 6000, poCoordinatorMaxInr: 12000 });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.poPmMaxInr, 6000);
    assert.strictEqual(res.body.data.poCoordinatorMaxInr, 12000);

    const { requiresPmApproval } = require('./constants/approvalPolicy');
    assert.strictEqual(requiresPmApproval(5999), true);
    assert.strictEqual(requiresPmApproval(6000), false);
  });

  it('rejects coordinator max below PM max', async () => {
    const res = await request(app)
      .patch('/api/admin/org-settings')
      .set('Authorization', `Bearer ${coordToken}`)
      .send({ poPmMaxInr: 8000, poCoordinatorMaxInr: 5000 });
    assert.strictEqual(res.status, 400);
  });

  it('gst lookup preview returns future-ready message', async () => {
    const res = await request(app)
      .get('/api/vendors/gst-lookup/preview')
      .set('Authorization', `Bearer ${coordToken}`)
      .query({ gstNumber: '29AAAAA0000A1Z5' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.available, false);
    assert.ok(res.body.data.message);
  });
});
