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
const { findMaterialDuplicate, dedupeAllMaterials, dedupeMaterialListResults } = require('./services/materialDedupService');

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

  it('dedupeMaterialListResults collapses duplicate names for indent picker', () => {
    const rows = [
      { id: '1', code: 'AC', name: 'AC', unit: 'Nos' },
      { id: '2', code: 'AC4', name: 'AC', unit: 'Nos' },
      { id: '3', code: 'AC2', name: 'AC', unit: 'Nos' },
      { id: '4', code: 'BATTERY', name: 'Battery', unit: 'Nos' },
      { id: '5', code: 'BATTERY6', name: 'Battery', unit: 'Sets' },
    ];
    const out = dedupeMaterialListResults(rows, { collapseDuplicateNames: true });
    assert.strictEqual(out.length, 2);
    assert.ok(out.some((m) => m.name === 'AC' && m.code === 'AC'));
    assert.ok(out.some((m) => m.name === 'Battery' && m.code === 'BATTERY'));
  });

  it('dedupeMaterialListResults removes duplicate ids and codes', () => {
    const rows = [
      { id: '1', code: 'MAT-A', name: 'Widget', unit: 'Nos' },
      { id: '1', code: 'MAT-A', name: 'Widget', unit: 'Nos' },
      { id: '2', code: 'MAT-A', name: 'Widget copy', unit: 'Nos' },
    ];
    const out = dedupeMaterialListResults(rows, { collapseDuplicateNames: false });
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].id, '1');
  });

  it('GET /materials returns each material name once for site indent picker', async () => {
    await Material.create({ code: 'AC-ALT', name: 'AC', unit: 'Nos' });
    await Material.create({ code: 'BAT-ALT', name: 'Battery', unit: 'Sets' });

    const siteToken = await loginAs('request@bekem.com');
    const res = await request(app)
      .get('/api/materials')
      .set('Authorization', `Bearer ${siteToken}`);
    assert.strictEqual(res.status, 200);

    const names = res.body.data.map((m) => m.name.toLowerCase());
    const unique = new Set(names);
    assert.strictEqual(names.length, unique.size);

    const ids = res.body.data.map((m) => m.id);
    assert.strictEqual(ids.length, new Set(ids).size);
    const codes = res.body.data.map((m) => m.code.toUpperCase());
    assert.strictEqual(codes.length, new Set(codes).size);
  });
});
