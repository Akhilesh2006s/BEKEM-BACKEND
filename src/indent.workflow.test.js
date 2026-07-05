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
const { MaterialRequest } = require('./models');

describe('Indent workflow v2', () => {
  let app;
  let siteToken;
  let storeToken;
  let pmToken;
  let material;

  before(async () => {
    await setupTestDb();
    app = getApp();
    siteToken = await loginAs('request@bekem.com');
    storeToken = await loginAs('storeincharge@bekem.com');
    pmToken = await loginAs('pm@bekem.com');
    const ctx = await getSeedContext();
    material = ctx.material;
  });

  after(async () => {
    await teardownTestDb();
  });

  it('rejects allocate without remark', async () => {
    const createRes = await request(app)
      .post('/api/material-requests')
      .set('Authorization', `Bearer ${siteToken}`)
      .send({
        items: [{ materialId: material._id.toString(), quantityRequested: 1 }],
      });
    assert.strictEqual(createRes.status, 201);
    const mrId = createRes.body.data.id;

    const res = await request(app)
      .post(`/api/material-requests/${mrId}/allocate`)
      .set('Authorization', `Bearer ${storeToken}`)
      .send({ decision: 'forward', remark: '   ' });

    assert.strictEqual(res.status, 400);
  });

  it('returns stock comparison fields on detail', async () => {
    const createRes = await request(app)
      .post('/api/material-requests')
      .set('Authorization', `Bearer ${siteToken}`)
      .send({
        items: [{ materialId: material._id.toString(), quantityRequested: 5 }],
      });
    const mrId = createRes.body.data.id;

    const detail = await request(app)
      .get(`/api/material-requests/${mrId}`)
      .set('Authorization', `Bearer ${storeToken}`);

    assert.strictEqual(detail.status, 200);
    const item = detail.body.data.items[0];
    assert.ok('requestedQty' in item);
    assert.ok('availableQty' in item);
    assert.ok('existingStock' in item);
    assert.ok('requiredQty' in item);
    assert.strictEqual(item.requestedQty, 5);
  });

  it('forwards entire indent when any line is short (no partial issue)', async () => {
    const createRes = await request(app)
      .post('/api/material-requests')
      .set('Authorization', `Bearer ${siteToken}`)
      .send({
        items: [
          { materialId: material._id.toString(), quantityRequested: 1 },
          { customName: 'Nonexistent-Product-XYZ-999', unit: 'Nos', quantityRequested: 99999 },
        ],
      });
    const mrId = createRes.body.data.id;

    const issueAttempt = await request(app)
      .post(`/api/material-requests/${mrId}/allocate`)
      .set('Authorization', `Bearer ${storeToken}`)
      .send({ decision: 'issue', remark: 'Trying full issue' });

    assert.strictEqual(issueAttempt.status, 400);
    assert.match(issueAttempt.body.message, /forward|short|stock/i);

    const forwardRes = await request(app)
      .post(`/api/material-requests/${mrId}/allocate`)
      .set('Authorization', `Bearer ${storeToken}`)
      .send({ decision: 'forward', remark: 'Entire indent forwarded — stock short on one line' });

    assert.strictEqual(forwardRes.status, 200);
    assert.strictEqual(forwardRes.body.data.status, 'FORWARDED_TO_PM');
  });

  it('PM daily cap escalates second approval to Head Office', async () => {
    const { User } = require('./models');
    const { getDayBounds } = require('./services/pmApprovalCapService');
    const pmUser = await User.findOne({ email: 'pm@bekem.com' });
    const { start, end } = getDayBounds();
    const { StatusHistory } = require('./models');
    await StatusHistory.deleteMany({
      entityType: 'MaterialRequest',
      actorUserId: pmUser._id,
      toStatus: 'PM_APPROVED',
      timestamp: { $gte: start, $lte: end },
    });

    const createAndForward = async (estimatedValue) => {
      const createRes = await request(app)
        .post('/api/material-requests')
        .set('Authorization', `Bearer ${siteToken}`)
        .send({
          items: [{ materialId: material._id.toString(), quantityRequested: 1 }],
        });
      const mrId = createRes.body.data.id;
      await MaterialRequest.findByIdAndUpdate(mrId, { estimatedValue });
      const fwd = await request(app)
        .post(`/api/material-requests/${mrId}/allocate`)
        .set('Authorization', `Bearer ${storeToken}`)
        .send({ decision: 'forward', remark: 'Forward for PM cap test' });
      assert.strictEqual(fwd.status, 200);
      return mrId;
    };

    const mr1 = await createAndForward(4800);
    const approve1 = await request(app)
      .post(`/api/material-requests/${mr1}/approve`)
      .set('Authorization', `Bearer ${pmToken}`);
    assert.strictEqual(approve1.status, 200, JSON.stringify(approve1.body));
    assert.strictEqual(approve1.body.escalated, false);

    const mr2 = await createAndForward(800);
    const approve2 = await request(app)
      .post(`/api/material-requests/${mr2}/approve`)
      .set('Authorization', `Bearer ${pmToken}`);

    assert.strictEqual(approve2.status, 409);
    assert.strictEqual(approve2.body.escalated, true);
    assert.strictEqual(approve2.body.data.status, 'PENDING_HO');
  });
});
