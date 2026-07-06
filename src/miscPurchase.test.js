/**
 * Misc purchase workflow + monthly report smoke tests.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestDb, teardownTestDb, loginAs, getApp } = require('./test/helpers');
const { Project } = require('./models');

describe('Misc purchases & monthly report', () => {
  let app;
  let pmToken;
  let coordToken;
  let projectId;

  before(async () => {
    await setupTestDb();
    app = getApp();
    pmToken = await loginAs('pm@bekem.com');
    coordToken = await loginAs('coordinator@bekem.com');
    const project = await Project.findOne();
    projectId = project?._id?.toString();
  });

  after(async () => {
    await teardownTestDb();
  });

  it('creates grocery misc purchase and PM approves', async () => {
    if (!projectId) return;

    const created = await request(app)
      .post('/api/misc-purchases')
      .set('Authorization', `Bearer ${pmToken}`)
      .send({
        expenseCategoryKey: 'GROCERY',
        description: 'Site tea and snacks',
        amount: 1200,
        projectId,
      });
    assert.strictEqual(created.status, 201);
    assert.ok(created.body.data.referenceNumber);

    const approved = await request(app)
      .post(`/api/misc-purchases/${created.body.data.id}/approve`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({});
    assert.strictEqual(approved.status, 200);
    assert.strictEqual(approved.body.data.status, 'APPROVED');
  });

  it('returns monthly transaction report', async () => {
    const res = await request(app)
      .get('/api/finance/monthly-report')
      .set('Authorization', `Bearer ${coordToken}`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.data.summary);
    assert.ok(Array.isArray(res.body.data.miscByCategory));
  });

  it('returns material category report', async () => {
    const res = await request(app)
      .get('/api/materials/reports/by-category')
      .set('Authorization', `Bearer ${coordToken}`);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.data));
  });
});
