const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const {
  setupTestDb,
  teardownTestDb,
  loginAs,
  getApp,
} = require('./test/helpers');
const { Material } = require('./models');
const { findMaterialDuplicate, dedupeAllMaterials } = require('./services/materialDedupService');

describe('Material deduplication', () => {
  let app;
  let storeToken;

  before(async () => {
    await setupTestDb();
    app = getApp();
    storeToken = await loginAs('storeincharge@bekem.com');
  });

  after(async () => {
    await teardownTestDb();
  });

  it('rejects duplicate material name on create', async () => {
    const existing = await Material.findOne({ isActive: { $ne: false } });
    assert.ok(existing);

    const res = await request(app)
      .post('/api/materials')
      .set('Authorization', `Bearer ${storeToken}`)
      .send({
        code: 'DUP-TEST-001',
        name: existing.name,
        unit: 'Nos',
        hsnCode: '12345678',
      });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.message, 'Material already exists.');
  });

  it('dedupeAllMaterials keeps one row per normalized name', async () => {
    await Material.create({
      code: 'DUP-A',
      name: 'Duplicate Widget',
      unit: 'Nos',
    });
    await Material.create({
      code: 'DUP-B',
      name: 'duplicate widget',
      unit: 'Nos',
    });

    const { merged } = await dedupeAllMaterials();
    assert.ok(merged >= 1);

    const active = await Material.find({
      name: /duplicate widget/i,
      isActive: { $ne: false },
    });
    assert.strictEqual(active.length, 1);
  });

  it('findMaterialDuplicate matches hsn and name', async () => {
    const mat = await Material.create({
      code: 'HSN-DUP',
      name: 'Battery 12V',
      hsnCode: '8507',
      unit: 'Nos',
    });
    const dup = await findMaterialDuplicate({
      name: 'Battery 12V',
      hsnCode: '8507',
    });
    assert.strictEqual(dup._id.toString(), mat._id.toString());
  });
});
