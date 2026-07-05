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
const { MaterialRequest, PurchaseRequest } = require('./models');

async function createForwardedIndent(app, siteToken, storeToken, materialId) {
  const createRes = await request(app)
    .post('/api/material-requests')
    .set('Authorization', `Bearer ${siteToken}`)
    .send({ purpose: 'UAT test reason', items: [{ materialId: materialId.toString(), quantityRequested: 50 }] });
  assert.strictEqual(createRes.status, 201);
  const mrId = createRes.body.data.id;

  const forwardRes = await request(app)
    .post(`/api/material-requests/${mrId}/allocate`)
    .set('Authorization', `Bearer ${storeToken}`)
    .send({ decision: 'forward', remark: 'Stock short — forwarded entire indent to PM' });
  assert.strictEqual(forwardRes.status, 200);
  assert.strictEqual(forwardRes.body.data.status, 'FORWARDED_TO_PM');

  return mrId;
}

describe('Executive procurement decision workflow', () => {
  let app;
  let siteToken;
  let storeToken;
  let pmToken;
  let executiveToken;
  let coordinatorToken;
  let material;

  before(async () => {
    await setupTestDb();
    app = getApp();
    siteToken = await loginAs('request@bekem.com');
    storeToken = await loginAs('storeincharge@bekem.com');
    pmToken = await loginAs('pm@bekem.com');
    executiveToken = await loginAs('executive@bekem.com');
    coordinatorToken = await loginAs('coordinator@bekem.com');
    const ctx = await getSeedContext();
    material = ctx.material;
  });

  after(async () => {
    await teardownTestDb();
  });

  it('PM forward-to-ho queues executive decision without creating PR', async () => {
    const mrId = await createForwardedIndent(app, siteToken, storeToken, material._id);

    const forwardHo = await request(app)
      .post(`/api/material-requests/${mrId}/forward-to-ho`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ remark: 'Insufficient stock at site — need Head Office procurement decision' });
    assert.strictEqual(forwardHo.status, 200);
    assert.strictEqual(forwardHo.body.data.status, 'PENDING_EXECUTIVE_DECISION');

    const pr = await PurchaseRequest.findOne({ materialRequestId: mrId });
    assert.strictEqual(pr, null);

    const listRes = await request(app)
      .get('/api/procurement-decisions')
      .set('Authorization', `Bearer ${executiveToken}`);
    assert.strictEqual(listRes.status, 200);
    assert.ok(listRes.body.data.some((row) => row.id === mrId));
  });

  it('executive PO decision → coordinator approve creates purchase request', async () => {
    const mrId = await createForwardedIndent(app, siteToken, storeToken, material._id);

    await request(app)
      .post(`/api/material-requests/${mrId}/forward-to-ho`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ remark: 'No surplus anywhere — recommend PO' });

    const execDecide = await request(app)
      .post(`/api/procurement-decisions/${mrId}/executive-decide`)
      .set('Authorization', `Bearer ${executiveToken}`)
      .send({ method: 'PURCHASE_ORDER', remark: 'No surplus stock in other projects' });
    assert.strictEqual(execDecide.status, 200);
    assert.strictEqual(execDecide.body.data.status, 'EXECUTIVE_DECISION_PO');

    const coordList = await request(app)
      .get('/api/procurement-decisions')
      .set('Authorization', `Bearer ${coordinatorToken}`);
    assert.ok(coordList.body.data.some((row) => row.id === mrId));

    const coordApprove = await request(app)
      .post(`/api/procurement-decisions/${mrId}/coordinator-review`)
      .set('Authorization', `Bearer ${coordinatorToken}`)
      .send({
        action: 'approve',
        method: 'PURCHASE_ORDER',
        remark: 'Approved — proceed with purchase order',
      });
    assert.strictEqual(coordApprove.status, 200);

    const mr = await MaterialRequest.findById(mrId);
    assert.strictEqual(mr.status, 'PURCHASE_REQUESTED');

    const pr = await PurchaseRequest.findOne({ materialRequestId: mrId });
    assert.ok(pr);
  });

  it('executive cannot approve via legacy material-request approve endpoint', async () => {
    const mrId = await createForwardedIndent(app, siteToken, storeToken, material._id);
    await request(app)
      .post(`/api/material-requests/${mrId}/forward-to-ho`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ remark: 'Forwarded for executive decision' });

    const approveRes = await request(app)
      .post(`/api/material-requests/${mrId}/approve`)
      .set('Authorization', `Bearer ${executiveToken}`);
    assert.strictEqual(approveRes.status, 400);
    assert.match(approveRes.body.message, /Procurement Decisions/i);
  });
});
