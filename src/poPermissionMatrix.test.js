const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const {
  setupTestDb,
  teardownTestDb,
  loginAs,
  getApp,
} = require('./test/helpers');
const { PurchaseOrder } = require('./models');

describe('Final PO permission matrix (spec 41–42)', () => {
  let app;
  let siteToken;
  let storeToken;
  let pmToken;
  let executiveToken;
  let coordinatorToken;
  let chairmanToken;
  let samplePoId;

  before(async () => {
    await setupTestDb();
    app = getApp();
    siteToken = await loginAs('request@bekem.com');
    storeToken = await loginAs('storeincharge@bekem.com');
    pmToken = await loginAs('pm@bekem.com');
    executiveToken = await loginAs('executive@bekem.com');
    coordinatorToken = await loginAs('coordinator@bekem.com');
    chairmanToken = await loginAs('chairman@bekem.com');
    const po = await PurchaseOrder.findOne({ status: 'APPROVED' });
    samplePoId = po?._id?.toString();
  });

  after(async () => {
    await teardownTestDb();
  });

  describe('Site Incharge — no PO access', () => {
    it('GET /purchase-orders returns 403', async () => {
      const res = await request(app)
        .get('/api/purchase-orders')
        .set('Authorization', `Bearer ${siteToken}`);
      assert.strictEqual(res.status, 403);
    });

    it('GET /purchase-orders/:id returns 403', async () => {
      if (!samplePoId) return;
      const res = await request(app)
        .get(`/api/purchase-orders/${samplePoId}`)
        .set('Authorization', `Bearer ${siteToken}`);
      assert.strictEqual(res.status, 403);
    });

    it('POST /purchase-orders/wizard returns 403', async () => {
      const res = await request(app)
        .post('/api/purchase-orders/wizard')
        .set('Authorization', `Bearer ${siteToken}`)
        .send({ vendorId: '507f1f77bcf86cd799439011', paymentTerms: 'Net 30' });
      assert.strictEqual(res.status, 403);
    });
  });

  describe('Store Incharge — view only', () => {
    it('GET /purchase-orders/:id succeeds when in scope', async () => {
      if (!samplePoId) return;
      const res = await request(app)
        .get(`/api/purchase-orders/${samplePoId}`)
        .set('Authorization', `Bearer ${storeToken}`);
      assert.strictEqual(res.status, 200);
    });

    it('PATCH /purchase-orders/:id returns 403', async () => {
      if (!samplePoId) return;
      const res = await request(app)
        .patch(`/api/purchase-orders/${samplePoId}`)
        .set('Authorization', `Bearer ${storeToken}`)
        .send({ paymentTerms: 'Changed' });
      assert.strictEqual(res.status, 403);
    });

    it('POST /purchase-orders/wizard returns 403', async () => {
      const res = await request(app)
        .post('/api/purchase-orders/wizard')
        .set('Authorization', `Bearer ${storeToken}`)
        .send({ vendorId: '507f1f77bcf86cd799439011', paymentTerms: 'Net 30' });
      assert.strictEqual(res.status, 403);
    });
  });

  describe('Project Manager — PR/WO scope, no PO create/edit', () => {
    it('GET /purchase-orders without queue returns 403', async () => {
      const res = await request(app)
        .get('/api/purchase-orders')
        .set('Authorization', `Bearer ${pmToken}`);
      assert.strictEqual(res.status, 403);
    });

    it('GET /purchase-orders?queue=pm succeeds', async () => {
      const res = await request(app)
        .get('/api/purchase-orders')
        .query({ queue: 'pm' })
        .set('Authorization', `Bearer ${pmToken}`);
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.data));
    });

    it('POST /purchase-orders/wizard returns 403', async () => {
      const res = await request(app)
        .post('/api/purchase-orders/wizard')
        .set('Authorization', `Bearer ${pmToken}`)
        .send({ vendorId: '507f1f77bcf86cd799439011', paymentTerms: 'Net 30' });
      assert.strictEqual(res.status, 403);
    });

    it('PATCH /purchase-orders/:id returns 403', async () => {
      if (!samplePoId) return;
      const res = await request(app)
        .patch(`/api/purchase-orders/${samplePoId}`)
        .set('Authorization', `Bearer ${pmToken}`)
        .send({ paymentTerms: 'Changed' });
      assert.strictEqual(res.status, 403);
    });
  });

  describe('Executive — view/create, no edit', () => {
    it('GET /purchase-orders succeeds', async () => {
      const res = await request(app)
        .get('/api/purchase-orders')
        .set('Authorization', `Bearer ${executiveToken}`);
      assert.strictEqual(res.status, 200);
    });

    it('POST /purchase-orders/wizard is not forbidden by RBAC', async () => {
      const vendors = await request(app)
        .get('/api/vendors')
        .set('Authorization', `Bearer ${executiveToken}`);
      const res = await request(app)
        .post('/api/purchase-orders/wizard')
        .set('Authorization', `Bearer ${executiveToken}`)
        .send({
          vendorId: vendors.body.data[0]?.id || '507f1f77bcf86cd799439011',
          paymentTerms: 'Net 30',
        });
      assert.notStrictEqual(res.status, 403);
    });

    it('PATCH /purchase-orders/:id returns 403', async () => {
      if (!samplePoId) return;
      const res = await request(app)
        .patch(`/api/purchase-orders/${samplePoId}`)
        .set('Authorization', `Bearer ${executiveToken}`)
        .send({ paymentTerms: 'Changed' });
      assert.strictEqual(res.status, 403);
    });
  });

  describe('Coordinator — view/create/edit/verify', () => {
    it('GET /purchase-orders succeeds', async () => {
      const res = await request(app)
        .get('/api/purchase-orders')
        .set('Authorization', `Bearer ${coordinatorToken}`);
      assert.strictEqual(res.status, 200);
    });

    it('POST /purchase-orders/wizard is not forbidden', async () => {
      const vendors = await request(app)
        .get('/api/vendors')
        .set('Authorization', `Bearer ${coordinatorToken}`);
      const res = await request(app)
        .post('/api/purchase-orders/wizard')
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({
          vendorId: vendors.body.data[0]?.id || '507f1f77bcf86cd799439011',
          paymentTerms: 'Net 30',
        });
      assert.notStrictEqual(res.status, 403);
    });
  });

  describe('Chairman — view/edit/final-approve, no create', () => {
    it('GET /purchase-orders succeeds', async () => {
      const res = await request(app)
        .get('/api/purchase-orders')
        .set('Authorization', `Bearer ${chairmanToken}`);
      assert.strictEqual(res.status, 200);
    });

    it('POST /purchase-orders/wizard returns 403', async () => {
      const res = await request(app)
        .post('/api/purchase-orders/wizard')
        .set('Authorization', `Bearer ${chairmanToken}`)
        .send({ vendorId: '507f1f77bcf86cd799439011', paymentTerms: 'Net 30' });
      assert.strictEqual(res.status, 403);
    });

    it('PATCH /purchase-orders/:id is not blocked by RBAC middleware', async () => {
      const chairmanPending = await PurchaseOrder.findOne({
        status: { $in: ['CHAIRMAN_PENDING', 'PENDING_APPROVAL'] },
      });
      if (!chairmanPending) return;
      const res = await request(app)
        .patch(`/api/purchase-orders/${chairmanPending._id}`)
        .set('Authorization', `Bearer ${chairmanToken}`)
        .send({ referenceNote: 'Chairman correction' });
      assert.notStrictEqual(res.status, 403);
    });
  });
});
