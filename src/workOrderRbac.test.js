const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestDb, teardownTestDb, loginAs, getApp } = require('./test/helpers');

describe('Work order RBAC — Store and Site blocked', () => {
  let app;
  let storeToken;
  let siteToken;
  let executiveToken;

  before(async () => {
    await setupTestDb();
    app = getApp();
    storeToken = await loginAs('storeincharge@bekem.com');
    siteToken = await loginAs('request@bekem.com');
    executiveToken = await loginAs('executive@bekem.com');
  });

  after(async () => {
    await teardownTestDb();
  });

  it('Store cannot list work orders', async () => {
    const res = await request(app)
      .get('/api/work-orders')
      .set('Authorization', `Bearer ${storeToken}`);
    assert.strictEqual(res.status, 403);
  });

  it('Site cannot list work orders', async () => {
    const res = await request(app)
      .get('/api/work-orders')
      .set('Authorization', `Bearer ${siteToken}`);
    assert.strictEqual(res.status, 403);
  });

  it('Store cannot view a work order by id', async () => {
    const listRes = await request(app)
      .get('/api/work-orders')
      .set('Authorization', `Bearer ${executiveToken}`);
    const woId = listRes.body.data?.[0]?.id;
    if (!woId) return;

    const res = await request(app)
      .get(`/api/work-orders/${woId}`)
      .set('Authorization', `Bearer ${storeToken}`);
    assert.strictEqual(res.status, 403);
  });

  it('Site cannot create a work order', async () => {
    const res = await request(app)
      .post('/api/work-orders')
      .set('Authorization', `Bearer ${siteToken}`)
      .send({
        purchaseOrderId: '507f1f77bcf86cd799439011',
        scope: 'Test',
        totalQuantity: 1,
        quantityUnit: 'Units',
      });
    assert.strictEqual(res.status, 403);
  });
});
