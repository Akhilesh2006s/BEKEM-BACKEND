const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const {
  setupTestDb,
  teardownTestDb,
  loginAs,
  getSeedContext,
  getApp,
} = require('./test/helpers');

describe('Load / soak tests', () => {
  before(async () => {
    await setupTestDb();
  });

  after(async () => {
    await teardownTestDb();
  });

  it('auth endpoint handles 20 concurrent logins', async () => {
    const app = getApp();
    const attempts = Array.from({ length: 20 }, () =>
      request(app).post('/api/auth/login').send({
        email: 'request@bekem.com',
        password: 'Bekem@Demo2026!',
      })
    );

    const results = await Promise.all(attempts);
    const successes = results.filter((r) => r.status === 200);
    assert.strictEqual(successes.length, 20);
  });

  it('allocate endpoint handles sequential requests without 403 for valid store user', async () => {
    const app = getApp();
    const { material } = await getSeedContext();
    const siteToken = await loginAs('request@bekem.com');
    const storeToken = await loginAs('storeincharge@bekem.com');

    for (let i = 0; i < 5; i++) {
      const createRes = await request(app)
        .post('/api/material-requests')
        .set('Authorization', `Bearer ${siteToken}`)
        .send({
          materialId: material._id.toString(),
          quantityRequested: 1,
          purpose: `Load test ${i}`,
          requiredByDate: new Date(Date.now() + 86400000).toISOString(),
        });

      assert.strictEqual(createRes.status, 201);
      const mrId = createRes.body.data.id;

      const allocRes = await request(app)
        .post(`/api/material-requests/${mrId}/allocate`)
        .set('Authorization', `Bearer ${storeToken}`)
        .send({ quantityAllocated: 1 });

      assert.notStrictEqual(allocRes.status, 403, `Allocate returned 403 on iteration ${i}`);
    }
  });
});
