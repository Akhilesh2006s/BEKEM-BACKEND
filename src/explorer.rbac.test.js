const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { Project } = require('./models');
const {
  setupTestDb,
  teardownTestDb,
  loginAs,
  getApp,
} = require('./test/helpers');

describe('Portfolio explorer RBAC', () => {
  before(async () => {
    await setupTestDb();
  });

  after(async () => {
    await teardownTestDb();
  });

  it('Executive sees all active projects', async () => {
    const app = getApp();
    const token = await loginAs('executive@bekem.com');
    const activeCount = await Project.countDocuments({ status: 'ACTIVE' });

    const res = await request(app)
      .get('/api/dashboard/explorer')
      .set('Authorization', `Bearer ${token}`);

    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.data));
    assert.strictEqual(res.body.data.length, activeCount);
    assert.ok(res.body.data.length >= 3);
    assert.ok(res.body.data.every((p) => p.code && p.name && p.procurementStatus));
  });

  it('Coordinator sees all active projects', async () => {
    const app = getApp();
    const token = await loginAs('coordinator@bekem.com');
    const activeCount = await Project.countDocuments({ status: 'ACTIVE' });

    const res = await request(app)
      .get('/api/dashboard/explorer')
      .set('Authorization', `Bearer ${token}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.length, activeCount);
  });

  it('Chairman sees all active projects', async () => {
    const app = getApp();
    const token = await loginAs('chairman@bekem.com');
    const activeCount = await Project.countDocuments({ status: 'ACTIVE' });

    const res = await request(app)
      .get('/api/dashboard/explorer')
      .set('Authorization', `Bearer ${token}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.length, activeCount);
  });

  it('Project Manager sees only assigned projects', async () => {
    const app = getApp();
    const token = await loginAs('pm@bekem.com');

    const res = await request(app)
      .get('/api/dashboard/explorer')
      .set('Authorization', `Bearer ${token}`);

    assert.strictEqual(res.status, 200);
    assert.ok(res.body.data.length >= 3);
    const codes = res.body.data.map((p) => p.code).sort();
    assert.deepStrictEqual(codes, ['PRJ-001', 'PRJ-002', 'PRJ-003']);
  });

  it('Store Manager sees only assigned project', async () => {
    const app = getApp();
    const token = await loginAs('storeincharge@bekem.com');

    const res = await request(app)
      .get('/api/dashboard/explorer')
      .set('Authorization', `Bearer ${token}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.length, 1);
    assert.strictEqual(res.body.data[0].code, 'PRJ-001');
  });

  it('Site Incharge sees only assigned project', async () => {
    const app = getApp();
    const token = await loginAs('request@bekem.com');

    const res = await request(app)
      .get('/api/dashboard/explorer')
      .set('Authorization', `Bearer ${token}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.length, 1);
    assert.strictEqual(res.body.data[0].code, 'PRJ-001');
  });
});
