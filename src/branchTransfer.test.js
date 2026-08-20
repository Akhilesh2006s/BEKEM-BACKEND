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
const { BranchTransfer, StockLedger, Site, Project, MaterialRequest, User, Material } = require('./models');

let indentCategoryId;

async function createForwardedIndent(app, siteToken, storeToken, materialId, quantityRequested = 99999) {
  const createRes = await request(app)
    .post('/api/material-requests')
    .set('Authorization', `Bearer ${siteToken}`)
    .send({ indentRequestType: 'ABOVE_5000',
        requestedByName: 'Test Requester',
        indentCategoryId: indentCategoryId,
        purpose: 'UAT test reason', items: [{ materialId: materialId.toString(), quantityRequested }] });
  assert.strictEqual(createRes.status, 201);
  const mrId = createRes.body.data.id;

  const forwardRes = await request(app)
    .post(`/api/material-requests/${mrId}/allocate`)
    .set('Authorization', `Bearer ${storeToken}`)
    .send({ decision: 'forward', remark: 'Stock short — forwarded entire indent to PM' });
  assert.strictEqual(forwardRes.status, 200);
  assert.strictEqual(forwardRes.body.data.status, 'FORWARDED_TO_PM');

  return MaterialRequest.findById(mrId);
}

describe('Branch transfer workflow', () => {
  let app;
  let siteToken;
  let storeToken;
  let pmToken;
  let execToken;
  let coordinatorToken;
  let material;
  let sourceProject;
  let destProject;
  let sourceSite;

  before(async () => {
    await setupTestDb();
    app = getApp();
    siteToken = await loginAs('request@bekem.com');
    storeToken = await loginAs('storeincharge@bekem.com');
    pmToken = await loginAs('pm@bekem.com');
    execToken = await loginAs('executive@bekem.com');
    coordinatorToken = await loginAs('coordinator@bekem.com');
    const ctx = await getSeedContext();
    material = ctx.material;
    indentCategoryId = ctx.indentCategory._id.toString();
    destProject = ctx.project;
    sourceProject = await Project.findOne({ _id: { $ne: destProject._id } });
    sourceSite = await Site.findOne({ projectId: sourceProject._id });
  });

  after(async () => {
    await teardownTestDb();
  });

  it('runs PM request → Head Office → Transfer without PO side effects', async () => {
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
    const mr = await createForwardedIndent(app, siteToken, storeToken, material._id);
    const createRes = await request(app)
      .post('/api/branch-transfers')
      .set('Authorization', `Bearer ${pmToken}`)
      .send({
        fromProjectId: sourceProject._id.toString(),
        materialRequestId: mr._id.toString(),
        items: [{ materialId: material._id.toString(), quantity: qty }],
        note: 'Need stock from other supervised project',
      });
    assert.strictEqual(createRes.status, 201);
    assert.strictEqual(createRes.body.data.status, 'REQUESTED');
    const transferId = createRes.body.data.id;

    const decideRes = await request(app)
      .post(`/api/branch-transfers/${transferId}/executive-approve`)
      .set('Authorization', `Bearer ${execToken}`)
      .send({ note: 'Approve branch transfer' });
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

  it('store cannot initiate branch transfers', async () => {
    const res = await request(app)
      .post('/api/branch-transfers')
      .set('Authorization', `Bearer ${storeToken}`)
      .send({
        fromProjectId: sourceProject._id.toString(),
        items: [{ materialId: material._id.toString(), quantity: 1 }],
      });
    assert.strictEqual(res.status, 403);
  });

  it('project manager cannot approve branch transfers', async () => {
    const mr = await createForwardedIndent(app, siteToken, storeToken, material._id);
    const createRes = await request(app)
      .post('/api/branch-transfers')
      .set('Authorization', `Bearer ${pmToken}`)
      .send({
        fromProjectId: sourceProject._id.toString(),
        materialRequestId: mr._id.toString(),
        items: [{ materialId: material._id.toString(), quantity: 1 }],
      });
    const transferId = createRes.body.data.id;

    const pmRes = await request(app)
      .post(`/api/branch-transfers/${transferId}/pm-approve`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ note: 'Should fail' });
    assert.strictEqual(pmRes.status, 403);
  });

  it('executive can reject branch transfer with mandatory note', async () => {
    const mr = await createForwardedIndent(app, siteToken, storeToken, material._id);
    const createRes = await request(app)
      .post('/api/branch-transfers')
      .set('Authorization', `Bearer ${pmToken}`)
      .send({
        fromProjectId: sourceProject._id.toString(),
        materialRequestId: mr._id.toString(),
        items: [{ materialId: material._id.toString(), quantity: 1 }],
      });
    const transferId = createRes.body.data.id;

    const rejectRes = await request(app)
      .post(`/api/branch-transfers/${transferId}/executive-reject`)
      .set('Authorization', `Bearer ${execToken}`)
      .send({ note: 'Procure fresh stock instead' });

    assert.strictEqual(rejectRes.status, 200);
    assert.strictEqual(rejectRes.body.data.status, 'REJECTED');
  });

  it('PM branch-transfer target search lists only supervised projects', async () => {
    const extra = await Project.create({
      code: 'PRJ-099',
      name: 'UNSUPPORTED DEMO PROJECT',
      location: 'Nowhere',
      status: 'ACTIVE',
      startDate: new Date(),
      targetEndDate: new Date(Date.now() + 86400000 * 365),
    });

    const [pmRes, execRes] = await Promise.all([
      request(app)
        .get('/api/branch-transfers/targets/search')
        .set('Authorization', `Bearer ${pmToken}`)
        .query({ q: 'PRJ' }),
      request(app)
        .get('/api/branch-transfers/targets/search')
        .set('Authorization', `Bearer ${execToken}`)
        .query({ q: 'PRJ' }),
    ]);

    assert.strictEqual(pmRes.status, 200);
    assert.strictEqual(execRes.status, 200);
    assert.ok(!pmRes.body.data.some((p) => p.id === extra._id.toString()));
    assert.ok(execRes.body.data.some((p) => p.id === extra._id.toString()));
    for (const row of pmRes.body.data) {
      assert.ok(['PRJ-001', 'PRJ-002', 'PRJ-003'].includes(row.code));
    }
  });

  it('PM can take from multiple sites and forward remaining to HO', async () => {
    const panelBoard = await Material.findOne({ code: 'PANEL-BOARD' });
    const metro = await Site.findOne({ name: 'Chitravathi Main Store' });
    const kaiga = await Site.findOne({ name: 'Kaiga Main Store' });
    assert.ok(panelBoard && metro && kaiga);

    const pm = await User.findOne({ email: 'pm@bekem.com' });
    pm.assignedProjectIds = (await Project.find()).map((p) => p._id);
    await pm.save();
    pmToken = await loginAs('pm@bekem.com');

    const mr = await createForwardedIndent(app, siteToken, storeToken, panelBoard._id, 500);
    const batchRes = await request(app)
      .post('/api/branch-transfers/batch')
      .set('Authorization', `Bearer ${pmToken}`)
      .send({
        materialRequestId: mr._id.toString(),
        note: 'Take available stock from other sites; remaining to HO',
        sources: [
          {
            fromProjectId: metro.projectId.toString(),
            fromSiteId: metro._id.toString(),
            items: [{ materialId: panelBoard._id.toString(), quantity: 50 }],
          },
          {
            fromProjectId: kaiga.projectId.toString(),
            fromSiteId: kaiga._id.toString(),
            items: [{ materialId: panelBoard._id.toString(), quantity: 120 }],
          },
        ],
      });
    assert.strictEqual(batchRes.status, 201, batchRes.body.message);
    assert.strictEqual(batchRes.body.data.transfers.length, 2);

    const afterBt = await MaterialRequest.findById(mr._id);
    assert.strictEqual(afterBt.status, 'BRANCH_TRANSFER_REQUESTED');

    const detailRes = await request(app)
      .get(`/api/material-requests/${mr._id}`)
      .set('Authorization', `Bearer ${pmToken}`);
    assert.strictEqual(detailRes.status, 200);
    assert.strictEqual(detailRes.body.data.linkedBranchTransfers.length, 2);

    const hoRes = await request(app)
      .post(`/api/material-requests/${mr._id}/forward-to-ho`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ remark: 'Remaining 330 still needed at site' });
    assert.strictEqual(hoRes.status, 200, hoRes.body.message);
    assert.strictEqual(hoRes.body.data.status, 'PENDING_EXECUTIVE_DECISION');
  });
});
