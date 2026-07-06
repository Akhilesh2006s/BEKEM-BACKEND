const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestDb, teardownTestDb, loginAs, getApp, getSeedContext } = require('./test/helpers');
const { MaterialRequest } = require('./models');

describe('HO indent workflow', () => {
  let pmToken;
  let executiveToken;
  let coordinatorToken;
  let projectId;
  let materialId;
  let indentId;

  before(async () => {
    await setupTestDb();
    pmToken = await loginAs('pm@bekem.com');
    executiveToken = await loginAs('executive@bekem.com');
    coordinatorToken = await loginAs('coordinator@bekem.com');
    const ctx = await getSeedContext();
    projectId = ctx.project._id.toString();
    materialId = ctx.material._id.toString();
  });

  after(async () => {
    await MaterialRequest.deleteMany({ purpose: /HO workflow test/ });
    await teardownTestDb();
  });

  it('executive creates HO indent hidden from PM', async () => {
    const createRes = await request(getApp())
      .post('/api/material-requests/ho-indents')
      .set('Authorization', `Bearer ${executiveToken}`)
      .send({
        projectId,
        items: [{ materialId, quantityRequested: 5 }],
        purpose: 'HO workflow test indent',
      });
    assert.equal(createRes.status, 201);
    indentId = createRes.body.data.id;
    assert.equal(createRes.body.data.origin, 'EXECUTIVE');

    const pmList = await request(getApp())
      .get('/api/material-requests')
      .set('Authorization', `Bearer ${pmToken}`);
    assert.equal(pmList.status, 200);
    assert.ok(!pmList.body.data.some((r) => r.id === indentId));
  });

  it('coordinator approves HO indent and generates RFQ', async () => {
    const approveRes = await request(getApp())
      .post(`/api/material-requests/ho-indents/${indentId}/coordinator-approve`)
      .set('Authorization', `Bearer ${coordinatorToken}`);
    assert.equal(approveRes.status, 200);
    assert.ok(approveRes.body.data.rfqNumber);
    assert.ok(approveRes.body.data.rfqId);

    const rfqRes = await request(getApp())
      .get(`/api/rfqs/${approveRes.body.data.rfqId}`)
      .set('Authorization', `Bearer ${executiveToken}`);
    assert.equal(rfqRes.status, 200);
    assert.equal(rfqRes.body.data.rfqNumber, approveRes.body.data.rfqNumber);
    assert.ok(rfqRes.body.data.items.length > 0);
    assert.ok(rfqRes.body.data.termsAndConditions.length > 0);
  });
});
