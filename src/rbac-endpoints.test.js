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

describe('RBAC endpoint enforcement', () => {
  before(async () => {
    await setupTestDb();
  });

  after(async () => {
    await teardownTestDb();
  });

  it('Coordinator cannot create material request', async () => {
    const app = getApp();
    const token = await loginAs('coordinator@bekem.com');
    const { material } = await getSeedContext();

    const res = await request(app)
      .post('/api/material-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        indentRequestType: 'ABOVE_5000',
        materialId: material._id.toString(),
        quantityRequested: 5,
        purpose: 'Should fail',
        requiredByDate: new Date().toISOString(),
      });

    assert.strictEqual(res.status, 403);
  });

  it('Coordinator is permitted to create purchase orders', async () => {
    const app = getApp();
    const token = await loginAs('coordinator@bekem.com');
    const vendors = await request(app)
      .get('/api/vendors')
      .set('Authorization', `Bearer ${token}`);

    const res = await request(app)
      .post('/api/purchase-orders/wizard')
      .set('Authorization', `Bearer ${token}`)
      .send({
        vendorId: vendors.body.data[0]?.id || '507f1f77bcf86cd799439011',
        paymentTerms: 'Net 30',
      });

    assert.notStrictEqual(res.status, 403);
  });

  it('Chairman can view user analytics', async () => {
    const app = getApp();
    const token = await loginAs('chairman@bekem.com');

    const res = await request(app)
      .get('/api/dashboard/user-analytics')
      .set('Authorization', `Bearer ${token}`);

    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.data));
  });

  it('Coordinator cannot view user analytics', async () => {
    const app = getApp();
    const token = await loginAs('coordinator@bekem.com');

    const res = await request(app)
      .get('/api/dashboard/user-analytics')
      .set('Authorization', `Bearer ${token}`);

    assert.strictEqual(res.status, 403);
  });

  it('Chairman cannot allocate material', async () => {
    const app = getApp();
    const token = await loginAs('chairman@bekem.com');

    const res = await request(app)
      .post('/api/material-requests/507f1f77bcf86cd799439011/allocate')
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'issue', remark: 'test' });

    assert.strictEqual(res.status, 403);
  });

  it('Chairman cannot create purchase request', async () => {
    const app = getApp();
    const token = await loginAs('chairman@bekem.com');

    const res = await request(app)
      .post('/api/purchase-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ materialRequestId: '507f1f77bcf86cd799439011', amountEstimate: 1000 });

    assert.strictEqual(res.status, 403);
  });

  it('Site Incharge cannot verify purchase orders', async () => {
    const app = getApp();
    const token = await loginAs('request@bekem.com');

    const res = await request(app)
      .post('/api/purchase-orders/507f1f77bcf86cd799439011/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'APPROVE' });

    assert.strictEqual(res.status, 403);
  });

  it('Site Incharge cannot view audit logs', async () => {
    const app = getApp();
    const token = await loginAs('request@bekem.com');

    const res = await request(app)
      .get('/api/audit-logs')
      .set('Authorization', `Bearer ${token}`);

    assert.strictEqual(res.status, 403);
  });
});
