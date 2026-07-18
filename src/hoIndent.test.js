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

  it('executive cannot generate HO indents', async () => {
    const createRes = await request(getApp())
      .post('/api/material-requests/ho-indents')
      .set('Authorization', `Bearer ${executiveToken}`)
      .send({
        projectId,
        items: [{ materialId, quantityRequested: 5 }],
        purpose: 'HO workflow test blocked',
      });
    assert.equal(createRes.status, 403);
  });

  it('coordinator creates HO indent hidden from PM and generates RFQ', async () => {
    const createRes = await request(getApp())
      .post('/api/material-requests/ho-indents')
      .set('Authorization', `Bearer ${coordinatorToken}`)
      .send({
        projectId,
        items: [{ materialId, quantityRequested: 5 }],
        purpose: 'HO workflow test indent',
      });
    assert.equal(createRes.status, 201);
    const indentId = createRes.body.data.indent.id;
    assert.equal(createRes.body.data.indent.origin, 'EXECUTIVE');
    assert.ok(createRes.body.data.rfqId);
    assert.ok(createRes.body.data.rfqNumber);

    const pmList = await request(getApp())
      .get('/api/material-requests')
      .set('Authorization', `Bearer ${pmToken}`);
    assert.equal(pmList.status, 200);
    assert.ok(!pmList.body.data.some((r) => r.id === indentId));

    const rfqRes = await request(getApp())
      .get(`/api/rfqs/${createRes.body.data.rfqId}`)
      .set('Authorization', `Bearer ${executiveToken}`);
    assert.equal(rfqRes.status, 200);
    assert.equal(rfqRes.body.data.rfqNumber, createRes.body.data.rfqNumber);
    assert.ok(rfqRes.body.data.items.length > 0);
    assert.ok(rfqRes.body.data.termsAndConditions.length > 0);
  });
});
