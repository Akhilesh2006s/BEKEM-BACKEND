const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const {
  setupTestDb,
  teardownTestDb,
  loginAs,
  getApp,
} = require('./test/helpers');
const { Material, MaterialRequest } = require('./models');
const { computeIndentPricing } = require('./services/indentPricingService');

describe('Indent line pricing', () => {
  let app;
  let pmToken;

  before(async () => {
    await setupTestDb();
    app = getApp();
    pmToken = await loginAs('pm@bekem.com');
  });

  after(async () => {
    await teardownTestDb();
  });

  it('computes line totals from Material Master reference prices', async () => {
    const mr = await MaterialRequest.findOne({ indentNumber: 'IND/FY25-26/PRJ-001/000004' }).populate(
      'items.materialId'
    );
    assert.ok(mr, 'seed should include multi-item PM cost demo indent');

    const pricing = await computeIndentPricing(mr);
    assert.strictEqual(pricing.totalEstimatedValue, 52500);

    const lineItems = [...pricing.byItemId.values()];
    assert.strictEqual(lineItems.length, 3);
    const lineTotalSum = lineItems.reduce((s, row) => s + row.lineTotal, 0);
    assert.strictEqual(lineTotalSum, 52500);
  });

  it('prefers latest approved PO rate over Material Master reference price', async () => {
    const steel = await Material.findOne({ code: 'MAT-STEEL-12MM' });
    const mr = await MaterialRequest.create({
      indentNumber: 'IND/TEST/PRICING/0001',
      projectId: (await MaterialRequest.findOne()).projectId,
      siteId: (await MaterialRequest.findOne()).siteId,
      items: [{ materialId: steel._id, quantityRequested: 2 }],
      purpose: 'Pricing test',
      requestedByUserId: (await MaterialRequest.findOne()).requestedByUserId,
      status: 'FORWARDED_TO_PM',
      pendingWithRole: 'PROJECT_MANAGER',
    });

    const pricing = await computeIndentPricing(mr);
    const row = [...pricing.byItemId.values()][0];
    assert.strictEqual(row.unitPrice, 8500);
    assert.strictEqual(row.lineTotal, 17000);
    assert.strictEqual(pricing.totalEstimatedValue, 17000);
  });

  it('returns item-wise pricing on PM indent detail API', async () => {
    const mr = await MaterialRequest.findOne({ indentNumber: 'IND/FY25-26/PRJ-001/000004' });
    const res = await request(app)
      .get(`/api/material-requests/${mr._id}`)
      .set('Authorization', `Bearer ${pmToken}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.estimatedValue, 52500);
    assert.strictEqual(res.body.data.items.length, 3);

    const lugs = res.body.data.items.find((i) => i.material?.name === '10 Sqmm Cu P/T Lugs');
    const cement = res.body.data.items.find((i) => i.material?.name === 'Cement OPC 53');
    const sand = res.body.data.items.find((i) => i.material?.name === 'River Sand');

    assert.ok(lugs);
    assert.strictEqual(lugs.unitPrice, 250);
    assert.strictEqual(lugs.lineTotal, 2500);

    assert.ok(cement);
    assert.strictEqual(cement.unitPrice, 400);
    assert.strictEqual(cement.lineTotal, 20000);

    assert.ok(sand);
    assert.strictEqual(sand.unitPrice, 600);
    assert.strictEqual(sand.lineTotal, 30000);

    const sum = res.body.data.items.reduce((s, i) => s + i.lineTotal, 0);
    assert.strictEqual(sum, res.body.data.estimatedValue);
  });
});
