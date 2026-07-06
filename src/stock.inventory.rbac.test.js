const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const {
  setupTestDb,
  teardownTestDb,
  loginAs,
  getApp,
} = require('./test/helpers');
const { Project, StockInventoryRecord, User } = require('./models');

async function seedInventoryRows(projectA, projectB, projectC) {
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
    {
      poSlNo: 3,
      project: projectC.name,
      supplier: 'Vendor C',
      poNo: 'PO-C-001',
      itemDescription: 'Item for project C',
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
  let projectC;

  before(async () => {
    await setupTestDb();
    app = getApp();
    storeToken = await loginAs('storeincharge@bekem.com');
    pmToken = await loginAs('pm@bekem.com');
    coordinatorToken = await loginAs('coordinator@bekem.com');

    const projects = await Project.find().sort({ code: 1 });
    projectA = projects[0];
    projectB = projects[1];
    projectC = projects[2];
    assert.ok(projectA && projectB && projectC, 'seed should include three projects');
    await seedInventoryRows(projectA, projectB, projectC);
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
    const pm = await User.findOne({ email: 'pm@bekem.com' }).populate('assignedProjectIds');
    const assignedNames = pm.assignedProjectIds.map((p) => p.name);

    const res = await request(app)
      .get('/api/stock/inventory')
      .set('Authorization', `Bearer ${pmToken}`);

    assert.strictEqual(res.status, 200);
    const projects = [...new Set(res.body.data.map((row) => row.project))];
    for (const name of assignedNames) {
      assert.ok(projects.includes(name), `PM should see inventory for ${name}`);
    }
    const allProjects = [projectA, projectB, projectC];
    for (const p of allProjects) {
      if (!assignedNames.includes(p.name)) {
        assert.ok(!projects.includes(p.name), `PM should not see inventory for ${p.name}`);
      }
    }
    assert.strictEqual(res.body.meta.inventoryScope, 'assigned');
    assert.ok(pm.assignedProjectIds.length >= 2 && pm.assignedProjectIds.length <= 4);
    assert.strictEqual(res.body.meta.assignedProjects.length, pm.assignedProjectIds.length);
  });

  it('PM cross-project stock returns assigned project availability', async () => {
    const pm = await User.findOne({ email: 'pm@bekem.com' }).populate('assignedProjectIds');
    const assignedNames = new Set(pm.assignedProjectIds.map((p) => p.name));

    const res = await request(app)
      .get('/api/stock/cross-project')
      .set('Authorization', `Bearer ${pmToken}`)
      .query({ search: 'Panel Board' });

    assert.strictEqual(res.status, 200);
    assert.ok(res.body.data.length >= 1);
    const row = res.body.data[0];
    assert.strictEqual(row.projects.length, pm.assignedProjectIds.length);
    for (const p of row.projects) {
      assert.ok(assignedNames.has(p.projectName));
    }
    const byName = Object.fromEntries(row.projects.map((p) => [p.projectName, p.availableQty]));
    if (assignedNames.has('AMR POWER')) assert.strictEqual(byName['AMR POWER'], 0);
    if (assignedNames.has('CHITRAVATHI')) assert.strictEqual(byName.CHITRAVATHI, 50);
    if (assignedNames.has('KAIGA PROJECT')) assert.strictEqual(byName['KAIGA PROJECT'], 120);
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
