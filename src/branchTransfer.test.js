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
const { BranchTransfer, StockLedger, Site, Project } = require('./models');

describe('Branch transfer workflow', () => {
  let app;
  let storeToken;
  let pmToken;
  let coordinatorToken;
  let material;
  let sourceProject;
  let destProject;
  let sourceSite;

  before(async () => {
    await setupTestDb();
    app = getApp();
    storeToken = await loginAs('storeincharge@bekem.com');
    pmToken = await loginAs('pm@bekem.com');
    coordinatorToken = await loginAs('coordinator@bekem.com');
    const ctx = await getSeedContext();
    material = ctx.material;
    destProject = ctx.project;
    sourceProject = await Project.findOne({ _id: { $ne: destProject._id } });
    sourceSite = await Site.findOne({ projectId: sourceProject._id });
  });

  after(async () => {
    await teardownTestDb();
  });

  it('runs Store → PM → Coordinator → Transfer without PO side effects', async () => {
    const sourceBefore = await StockLedger.findOne({
      siteId: sourceSite._id,
      materialId: material._id,
    });
    const destSite = await Site.findOne({ projectId: destProject._id }).sort({ createdAt: 1 });
    const destBefore = await StockLedger.findOne({
      siteId: destSite._id,
      materialId: material._id,
    });

    const qty = 2;
    const createRes = await request(app)
      .post('/api/branch-transfers')
      .set('Authorization', `Bearer ${storeToken}`)
      .send({
        fromProjectId: sourceProject._id.toString(),
        items: [{ materialId: material._id.toString(), quantity: qty }],
        note: 'Need stock from other project',
      });
    assert.strictEqual(createRes.status, 201);
    assert.strictEqual(createRes.body.data.status, 'REQUESTED');
    const transferId = createRes.body.data.id;

    const pmRes = await request(app)
      .post(`/api/branch-transfers/${transferId}/pm-approve`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ note: 'Approved' });
    assert.strictEqual(pmRes.status, 200);
    assert.strictEqual(pmRes.body.data.status, 'PM_APPROVED');

    const decideRes = await request(app)
      .post(`/api/branch-transfers/${transferId}/coordinator-decide`)
      .set('Authorization', `Bearer ${coordinatorToken}`)
      .send({ decision: 'transfer', note: 'Confirm transfer' });
    assert.strictEqual(decideRes.status, 200);
    assert.strictEqual(decideRes.body.data.status, 'COORDINATOR_DECIDED');

    const executeRes = await request(app)
      .post(`/api/branch-transfers/${transferId}/execute`)
      .set('Authorization', `Bearer ${coordinatorToken}`)
      .send({});
    assert.strictEqual(executeRes.status, 200);
    assert.strictEqual(executeRes.body.data.status, 'TRANSFERRED');

    const transfer = await BranchTransfer.findById(transferId);
    assert.strictEqual(transfer.status, 'TRANSFERRED');
    assert.ok(transfer.transferredAt);

    const sourceAfter = await StockLedger.findOne({
      siteId: sourceSite._id,
      materialId: material._id,
    });
    const destAfter = await StockLedger.findOne({
      siteId: destSite._id,
      materialId: material._id,
    });
    assert.strictEqual(sourceAfter.quantityOnHand, sourceBefore.quantityOnHand - qty);
    assert.strictEqual(destAfter.quantityOnHand, destBefore.quantityOnHand + qty);
  });

  it('coordinator can choose raise_po_instead', async () => {
    const createRes = await request(app)
      .post('/api/branch-transfers')
      .set('Authorization', `Bearer ${storeToken}`)
      .send({
        fromProjectId: sourceProject._id.toString(),
        items: [{ materialId: material._id.toString(), quantity: 1 }],
      });
    const transferId = createRes.body.data.id;

    await request(app)
      .post(`/api/branch-transfers/${transferId}/pm-approve`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({});

    const decideRes = await request(app)
      .post(`/api/branch-transfers/${transferId}/coordinator-decide`)
      .set('Authorization', `Bearer ${coordinatorToken}`)
      .send({ decision: 'raise_po_instead' });

    assert.strictEqual(decideRes.status, 200);
    assert.strictEqual(decideRes.body.data.status, 'RAISE_PO_INSTEAD');
    assert.ok(decideRes.body.data.redirect);
  });
});
