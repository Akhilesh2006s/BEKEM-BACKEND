const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const {
  setupTestDb,
  teardownTestDb,
  loginAs,
  getSeedContext,
  getApp,
} = require('./test/helpers');
const { computePoLineTotals, validatePoLinePayload } = require('./services/poLineCalculation');

describe('PO line calculation', () => {
  it('computes line total, tax, and grand total', () => {
    const cases = [
      { qty: 10, rate: 100, gst: 18, lineTotal: 1000, tax: 180, grandTotal: 1180 },
      { qty: 5, rate: 2500, gst: 12, lineTotal: 12500, tax: 1500, grandTotal: 14000 },
      { qty: 1, rate: 999.99, gst: 28, lineTotal: 999.99, tax: 280, grandTotal: 1279.99 },
    ];
    for (const c of cases) {
      const t = computePoLineTotals(c.qty, c.rate, c.gst);
      assert.strictEqual(t.lineTotal, c.lineTotal);
      assert.strictEqual(t.tax, c.tax);
      assert.strictEqual(t.grandTotal, c.grandTotal);
    }
  });

  it('rejects raw materialName in payload', () => {
    assert.throws(
      () =>
        validatePoLinePayload({
          materialName: 'Free text cement',
          materialId: '507f1f77bcf86cd799439011',
          quantity: 1,
          rate: 100,
        }),
      (err) => err.statusCode === 400
    );
  });

  it('rejects mismatched client line total', () => {
    assert.throws(
      () =>
        validatePoLinePayload({
          materialId: '507f1f77bcf86cd799439011',
          quantity: 2,
          rate: 50,
          amount: 500,
        }),
      (err) => err.statusCode === 400 && /mismatch/.test(err.message)
    );
  });
});

describe('Search & executive dashboard APIs', () => {
  let app;
  let execToken;
  let material;

  before(async () => {
    await setupTestDb();
    app = getApp();
    execToken = await loginAs('executive@bekem.com');
    const ctx = await getSeedContext();
    material = ctx.material;
  });

  after(async () => {
    await teardownTestDb();
  });

  it('GET /materials/search returns material master fields', async () => {
    const res = await request(app)
      .get('/api/materials/search')
      .query({ q: material.code.slice(0, 6) })
      .set('Authorization', `Bearer ${execToken}`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.data.length >= 1);
    const hit = res.body.data.find((m) => m.id === material._id.toString());
    assert.ok(hit);
    assert.ok(hit.itemCode);
    assert.ok(hit.hsnCode);
    assert.strictEqual(hit.gstRate, 18);
  });

  it('GET /dashboard/executive returns multiple projects', async () => {
    const res = await request(app)
      .get('/api/dashboard/executive')
      .set('Authorization', `Bearer ${execToken}`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.data.projects.length >= 2);
  });

  it('GET /projects/:id/billing-address exposes project billing when configured', async () => {
    const projectsRes = await request(app)
      .get('/api/projects/search')
      .query({ q: 'PRJ-002' })
      .set('Authorization', `Bearer ${execToken}`);
    const project2 = projectsRes.body.data.find((p) => p.code === 'PRJ-002');
    assert.ok(project2);

    const res = await request(app)
      .get(`/api/projects/${project2.id}/billing-address`)
      .set('Authorization', `Bearer ${execToken}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.hasProjectBillingAddress, true);
    assert.ok(res.body.data.billingAddress);
    assert.ok(res.body.data.registeredOfficeAddress);
  });
});
