const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const {
  setupTestDb,
  teardownTestDb,
  loginAs,
  getApp,
  getSeedContext,
} = require('./test/helpers');
const { Material } = require('./models');

describe('Site Material Master — indent workflow', () => {
  let app;
  let siteToken;
  let indentCategoryId;

  before(async () => {
    await setupTestDb();
    app = getApp();
    siteToken = await loginAs('request@bekem.com');
    const ctx = await getSeedContext();
    indentCategoryId = ctx.indentCategory._id.toString();
  });

  after(async () => {
    await teardownTestDb();
  });

  it('POST /materials/site-request creates a permanent Material Master row', async () => {
    const res = await request(app)
      .post('/api/materials/site-request')
      .set('Authorization', `Bearer ${siteToken}`)
      .send({
        name: 'Sand',
        unit: 'Mts',
        category: 'Civil Materials',
        description: 'River sand for plaster',
      });

    assert.strictEqual(res.status, 201);
    assert.ok(res.body.data.id);
    assert.ok(res.body.data.code);
    assert.notStrictEqual(res.body.data.code, 'NEW');
    assert.strictEqual(res.body.data.name, 'Sand');
    assert.strictEqual(res.body.data.unit, 'Mts');
    assert.strictEqual(res.body.data.category, 'Civil Materials');
    assert.strictEqual(res.body.meta.created, true);

    const persisted = await Material.findById(res.body.data.id);
    assert.ok(persisted);
    assert.strictEqual(persisted.hsnCode, '99999999');
    assert.strictEqual(persisted.gstRate, 18);
    assert.ok(persisted.createdByUserId);
  });

  it('reuses existing material instead of creating a duplicate', async () => {
    const first = await request(app)
      .post('/api/materials/site-request')
      .set('Authorization', `Bearer ${siteToken}`)
      .send({ name: 'Cement', unit: 'Bags', category: 'Civil Materials' });
    assert.strictEqual(first.status, 201);

    const second = await request(app)
      .post('/api/materials/site-request')
      .set('Authorization', `Bearer ${siteToken}`)
      .send({ name: 'cement', unit: 'Mts', category: 'Civil Materials' });

    assert.strictEqual(second.status, 200);
    assert.strictEqual(second.body.data.id, first.body.data.id);
    assert.strictEqual(second.body.meta.reused, true);

    const active = await Material.find({
      name: /^cement$/i,
      isActive: { $ne: false },
    });
    assert.strictEqual(active.length, 1);
  });

  it('new site material appears in GET /materials search immediately', async () => {
    const uniqueName = `Panel Board ${Date.now()}`;
    await request(app)
      .post('/api/materials/site-request')
      .set('Authorization', `Bearer ${siteToken}`)
      .send({ name: uniqueName, unit: 'Nos', category: 'Stationery' });

    const list = await request(app)
      .get('/api/materials')
      .query({ search: uniqueName })
      .set('Authorization', `Bearer ${siteToken}`);

    assert.strictEqual(list.status, 200);
    assert.ok(list.body.data.some((m) => m.name === uniqueName));
  });

  it('indent submit with customName still resolves to Material Master', async () => {
    const name = `Site-Legacy-${Date.now()}`;
    const indent = await request(app)
      .post('/api/material-requests')
      .set('Authorization', `Bearer ${siteToken}`)
      .send({
        indentRequestType: 'ABOVE_5000',
        requestedByName: 'Test Requester',
        indentCategoryId: indentCategoryId,
        purpose: 'Legacy custom name path',
        items: [{ customName: name, unit: 'Nos', quantityRequested: 2 }],
      });

    assert.strictEqual(indent.status, 201);
    const mat = await Material.findOne({ name });
    assert.ok(mat);
    assert.ok(mat.code);
  });
});
