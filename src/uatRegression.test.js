const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const {
  setupTestDb,
  teardownTestDb,
  loginAs,
  getApp,
} = require('./test/helpers');

describe('UAT regression fixes', () => {
  before(async () => {
    await setupTestDb();
  });

  after(async () => {
    await teardownTestDb();
  });

  it('C1: PM can list material-requests without 500', async () => {
    const app = getApp();
    const token = await loginAs('pm@bekem.com');

    const res = await request(app)
      .get('/api/material-requests')
      .set('Authorization', `Bearer ${token}`);

    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.data));
  });

  it('L1: Site cannot list branch-transfers', async () => {
    const app = getApp();
    const token = await loginAs('request@bekem.com');

    const res = await request(app)
      .get('/api/branch-transfers')
      .set('Authorization', `Bearer ${token}`);

    assert.strictEqual(res.status, 403);
  });
});
