const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const {
  setupTestDb,
  teardownTestDb,
  loginAs,
  getApp,
} = require('./test/helpers');
const { Project, StockInventoryRecord } = require('./models');

async function seedInventoryRows(projectA, projectB) {
  await StockInventoryRecord.deleteMany({ financialYear: '25-26' });
  await StockInventoryRecord.insertMany([
    {
      poSlNo: 1,
      project: projectA.name,
      supplier: 'Vendor A',
      poNo: 'PO-A-001',
      itemDescription: 'Item for project A',
      financialYear: '25-26',
    },
    {
      poSlNo: 2,
      project: projectB.name,
      supplier: 'Vendor B',
      poNo: 'PO-B-001',
      itemDescription: 'Item for project B',
      financialYear: '25-26',
    },
  ]);
}

describe('Stock inventory RBAC', () => {
  let app;
  let storeToken;
  let pmToken;
  let coordinatorToken;
  let projectA;
  let projectB;

  before(async () => {
    await setupTestDb();
    app = getApp();
    storeToken = await loginAs('storeincharge@bekem.com');
    pmToken = await loginAs('pm@bekem.com');
    coordinatorToken = await loginAs('coordinator@bekem.com');

    const projects = await Project.find().sort({ code: 1 });
    projectA = projects[0];
    projectB = projects[1];
    assert.ok(projectA && projectB, 'seed should include two projects');
    await seedInventoryRows(projectA, projectB);
  });

  after(async () => {
    await teardownTestDb();
  });

  it('Store Manager sees only assigned project inventory', async () => {
    const res = await request(app)
      .get('/api/stock/inventory')
      .set('Authorization', `Bearer ${storeToken}`);

    assert.strictEqual(res.status, 200);
    assert.ok(res.body.data.length >= 1);
    assert.ok(
      res.body.data.every((row) => row.project === projectA.name),
      'store should only see project A inventory'
    );
    assert.strictEqual(res.body.meta.inventoryScope, 'single');
    assert.strictEqual(res.body.meta.assignedProjectName, projectA.name);
    assert.ok(!res.body.meta.projects.includes(projectB.name));
  });

  it('Store Manager gets 403 when requesting another project', async () => {
    const res = await request(app)
      .get('/api/stock/inventory')
      .set('Authorization', `Bearer ${storeToken}`)
      .query({ project: projectB.name });

    assert.strictEqual(res.status, 403);
  });

  it('Project Manager sees only assigned project inventories', async () => {
    const res = await request(app)
      .get('/api/stock/inventory')
      .set('Authorization', `Bearer ${pmToken}`);

    assert.strictEqual(res.status, 200);
    const projects = [...new Set(res.body.data.map((row) => row.project))];
    assert.ok(projects.includes(projectA.name));
    assert.ok(projects.includes(projectB.name));
    assert.strictEqual(res.body.meta.inventoryScope, 'assigned');
    assert.strictEqual(res.body.meta.projects.length, 2);
  });

  it('Coordinator sees all project inventories', async () => {
    const res = await request(app)
      .get('/api/stock/inventory')
      .set('Authorization', `Bearer ${coordinatorToken}`);

    assert.strictEqual(res.status, 200);
    const projects = [...new Set(res.body.data.map((row) => row.project))];
    assert.ok(projects.includes(projectA.name));
    assert.ok(projects.includes(projectB.name));
    assert.strictEqual(res.body.meta.inventoryScope, 'all');
  });

  it('Store Manager cannot patch inventory from another project', async () => {
    const foreign = await StockInventoryRecord.findOne({ project: projectB.name });
    const res = await request(app)
      .patch(`/api/stock/inventory/${foreign._id}`)
      .set('Authorization', `Bearer ${storeToken}`)
      .send({ delayReason: 'Should be forbidden' });

    assert.strictEqual(res.status, 403);
  });
});
