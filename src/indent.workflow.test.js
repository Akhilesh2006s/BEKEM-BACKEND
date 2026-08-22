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
const { MaterialRequest, Material } = require('./models');

describe('Indent workflow v2', () => {
  let app;
  let siteToken;
  let storeToken;
  let pmToken;
  let material;
  let indentCategoryId;

  before(async () => {
    await setupTestDb();
    app = getApp();
    siteToken = await loginAs('request@bekem.com');
    storeToken = await loginAs('storeincharge@bekem.com');
    pmToken = await loginAs('pm@bekem.com');
    const ctx = await getSeedContext();
    material = ctx.material;
    indentCategoryId = ctx.indentCategory._id.toString();
  });

  after(async () => {
    await teardownTestDb();
  });

  it('rejects allocate without remark', async () => {
    const createRes = await request(app)
      .post('/api/material-requests')
      .set('Authorization', `Bearer ${siteToken}`)
      .send({
        indentRequestType: 'ABOVE_5000',
        requestedByName: 'Test Requester',
        indentCategoryId: indentCategoryId,
        purpose: 'UAT test reason',
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
        indentRequestType: 'ABOVE_5000',
        requestedByName: 'Test Requester',
        indentCategoryId: indentCategoryId,
        purpose: 'UAT test reason',
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
    assert.ok('requiredQty' in item);
    assert.ok(!('existingStock' in item));
    assert.strictEqual(item.requestedQty, 5);
    assert.strictEqual(item.requiredQty, Math.max(0, item.requestedQty - item.availableQty));
  });

  it('forwards entire indent when any line is short (no partial issue)', async () => {
    const createRes = await request(app)
      .post('/api/material-requests')
      .set('Authorization', `Bearer ${siteToken}`)
      .send({
        indentRequestType: 'ABOVE_5000',
        requestedByName: 'Test Requester',
        indentCategoryId: indentCategoryId,
        purpose: 'UAT test reason',
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
    const cement = await Material.findOne({ code: 'MAT-CEMENT-OPC53' });
    assert.ok(cement, 'seed cement required for cap test');
    const { start, endExclusive } = getDayBounds();
    const { StatusHistory } = require('./models');
    await StatusHistory.deleteMany({
      entityType: 'MaterialRequest',
      actorUserId: pmUser._id,
      timestamp: { $gte: start, $lt: endExclusive },
      $or: [
        { toStatus: 'PM_APPROVED' },
        { toStatus: 'ALLOCATED', fromStatus: 'FORWARDED_TO_PM' },
      ],
    });

    const createAndForward = async (quantityRequested) => {
      const createRes = await request(app)
        .post('/api/material-requests')
        .set('Authorization', `Bearer ${siteToken}`)
        .send({
          indentRequestType: 'ABOVE_5000',
        requestedByName: 'Test Requester',
        indentCategoryId: indentCategoryId,
        purpose: 'PM daily cap test',
          items: [{ materialId: cement._id.toString(), quantityRequested }],
        });
      const mrId = createRes.body.data.id;
      const fwd = await request(app)
        .post(`/api/material-requests/${mrId}/allocate`)
        .set('Authorization', `Bearer ${storeToken}`)
        .send({ decision: 'forward', remark: 'Forward for PM cap test' });
      assert.strictEqual(fwd.status, 200);
      return mrId;
    };

    const mr1 = await createAndForward(12);
    const approve1 = await request(app)
      .post(`/api/material-requests/${mr1}/approve`)
      .set('Authorization', `Bearer ${pmToken}`);
    assert.strictEqual(approve1.status, 200, JSON.stringify(approve1.body));
    assert.strictEqual(approve1.body.escalated, false);

    const mr2 = await createAndForward(2);
    const approve2 = await request(app)
      .post(`/api/material-requests/${mr2}/approve`)
      .set('Authorization', `Bearer ${pmToken}`);

    assert.strictEqual(approve2.status, 409);
    assert.strictEqual(approve2.body.escalated, true);
    assert.strictEqual(approve2.body.data.status, 'PENDING_HO');
  });

  it('forwards to PM when stock is available instead of direct issue', async () => {
    const createRes = await request(app)
      .post('/api/material-requests')
      .set('Authorization', `Bearer ${siteToken}`)
      .send({
        indentRequestType: 'ABOVE_5000',
        requestedByName: 'Test Requester',
        indentCategoryId: indentCategoryId,
        purpose: 'Stock available verify test',
        items: [{ materialId: material._id.toString(), quantityRequested: 1 }],
      });
    const mrId = createRes.body.data.id;

    const verifyRes = await request(app)
      .post(`/api/material-requests/${mrId}/allocate`)
      .set('Authorization', `Bearer ${storeToken}`)
      .send({ decision: 'issue', remark: 'Stock verified — forwarding to PM' });

    assert.strictEqual(verifyRes.status, 200);
    assert.strictEqual(verifyRes.body.data.status, 'FORWARDED_TO_PM');
    assert.strictEqual(verifyRes.body.data.storeStockVerified, true);

    const mr = await MaterialRequest.findById(mrId);
    assert.strictEqual(mr.status, 'FORWARDED_TO_PM');
  });

  it('PM cannot close locally when indent exceeds PM approval level — must forward to HO', async () => {
    const createRes = await request(app)
      .post('/api/material-requests')
      .set('Authorization', `Bearer ${siteToken}`)
      .send({
        indentRequestType: 'ABOVE_5000',
        requestedByName: 'Test Requester',
        indentCategoryId: indentCategoryId,
        purpose: 'Stock available, above PM approval level',
        items: [{ materialId: material._id.toString(), quantityRequested: 1 }],
      });
    const mrId = createRes.body.data.id;

    const verifyRes = await request(app)
      .post(`/api/material-requests/${mrId}/allocate`)
      .set('Authorization', `Bearer ${storeToken}`)
      .send({ decision: 'issue', remark: 'Stock verified — forwarding to PM' });

    assert.strictEqual(verifyRes.status, 200);

    await MaterialRequest.findByIdAndUpdate(mrId, { estimatedValue: 6800 });

    const closeRes = await request(app)
      .post(`/api/material-requests/${mrId}/pm-local-close`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ remark: 'Approved — stock on hand' });

    assert.strictEqual(closeRes.status, 400, JSON.stringify(closeRes.body));
    assert.match(closeRes.body.message || '', /PM approval level/i);

    const forwardRes = await request(app)
      .post(`/api/material-requests/${mrId}/forward-to-ho`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ remark: 'Indent exceeds PM approval level' });

    assert.strictEqual(forwardRes.status, 200, JSON.stringify(forwardRes.body));
    assert.strictEqual(forwardRes.body.data.status, 'PENDING_EXECUTIVE_DECISION');
    assert.match(forwardRes.body.message || '', /approved and forwarded to HO/i);

    const mr = await MaterialRequest.findById(mrId);
    assert.strictEqual(mr.status, 'PENDING_EXECUTIVE_DECISION');
    assert.notStrictEqual(mr.allocatedByRole, 'PROJECT_MANAGER');
  });

  it('PM can close locally when stock is available and within daily cap', async () => {
    const capRes = await request(app)
      .get('/api/material-requests/pm/daily-cap')
      .set('Authorization', `Bearer ${pmToken}`);
    assert.strictEqual(capRes.status, 200);
    const remaining = capRes.body.data.remaining;
    assert.ok(remaining > 0, 'expected PM to have remaining daily cap for this test');
    const withinCapValue = Math.max(1, Math.min(5000, Math.floor(remaining / 2)));

    const createRes = await request(app)
      .post('/api/material-requests')
      .set('Authorization', `Bearer ${siteToken}`)
      .send({
        indentRequestType: 'ABOVE_5000',
        requestedByName: 'Test Requester',
        indentCategoryId: indentCategoryId,
        purpose: 'Stock available, within PM daily cap',
        items: [{ materialId: material._id.toString(), quantityRequested: 1 }],
      });
    const mrId = createRes.body.data.id;

    const verifyRes = await request(app)
      .post(`/api/material-requests/${mrId}/allocate`)
      .set('Authorization', `Bearer ${storeToken}`)
      .send({ decision: 'issue', remark: 'Stock verified — forwarding to PM' });

    assert.strictEqual(verifyRes.status, 200);

    await MaterialRequest.findByIdAndUpdate(mrId, { estimatedValue: withinCapValue });

    const closeRes = await request(app)
      .post(`/api/material-requests/${mrId}/pm-local-close`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ remark: 'Approved — stock on hand' });

    assert.strictEqual(closeRes.status, 200, JSON.stringify(closeRes.body));
    assert.strictEqual(closeRes.body.data.status, 'ALLOCATED');

    const mr = await MaterialRequest.findById(mrId);
    assert.strictEqual(mr.allocatedByRole, 'PROJECT_MANAGER');
  });

  it('Coordinator daily cap endpoint and local close within limit', async () => {
    const coordToken = await loginAs('coordinator@bekem.com');
    const { updateOrgSettings, loadOrgSettings } = require('./services/orgSettingsService');
    await updateOrgSettings({ mrCoordinatorDailyMaxInr: 10000 });
    await loadOrgSettings();

    const capRes = await request(app)
      .get('/api/material-requests/coordinator/daily-cap')
      .set('Authorization', `Bearer ${coordToken}`);
    assert.strictEqual(capRes.status, 200);
    assert.strictEqual(capRes.body.data.dailyCap, 10000);
    assert.ok(capRes.body.data.remaining <= 10000);

    const createRes = await request(app)
      .post('/api/material-requests')
      .set('Authorization', `Bearer ${siteToken}`)
      .send({
        indentRequestType: 'ABOVE_5000',
        requestedByName: 'Test Requester',
        indentCategoryId: indentCategoryId,
        purpose: 'Coordinator daily cap local close',
        items: [{ materialId: material._id.toString(), quantityRequested: 1 }],
      });
    const mrId = createRes.body.data.id;

    const fwd = await request(app)
      .post(`/api/material-requests/${mrId}/allocate`)
      .set('Authorization', `Bearer ${storeToken}`)
      .send({ decision: 'forward', remark: 'Forward to PM' });
    assert.strictEqual(fwd.status, 200);

    const ho = await request(app)
      .post(`/api/material-requests/${mrId}/forward-to-ho`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ remark: 'Need Head Office' });
    assert.strictEqual(ho.status, 200, JSON.stringify(ho.body));

    await MaterialRequest.findByIdAndUpdate(mrId, { estimatedValue: 2500 });

    const closeRes = await request(app)
      .post(`/api/material-requests/${mrId}/coordinator-local-close`)
      .set('Authorization', `Bearer ${coordToken}`)
      .send({ remark: 'Within daily cap' });
    assert.strictEqual(closeRes.status, 200, JSON.stringify(closeRes.body));
    assert.ok(
      ['ALLOCATED', 'PURCHASE_REQUESTED'].includes(closeRes.body.data.status),
      closeRes.body.data.status
    );
  });

  it('allocation review is Executive → PM → Store → indent raiser', async () => {
    const execToken = await loginAs('executive@bekem.com');
    const createRes = await request(app)
      .post('/api/material-requests')
      .set('Authorization', `Bearer ${siteToken}`)
      .send({
        indentRequestType: 'ABOVE_5000',
        requestedByName: 'Test Requester',
        indentCategoryId: indentCategoryId,
        purpose: 'Allocation review chain after chairman',
        items: [{ materialId: material._id.toString(), quantityRequested: 1 }],
      });
    assert.strictEqual(createRes.status, 201);
    const mrId = createRes.body.data.id;

    await MaterialRequest.findByIdAndUpdate(mrId, {
      status: 'CHAIRMAN_APPROVED',
      pendingWithRole: 'EXECUTIVE',
      allocationReviewStage: 'EXECUTIVE',
      pmProceededAllocation: false,
    });

    const siteView = await request(app)
      .get(`/api/material-requests/${mrId}`)
      .set('Authorization', `Bearer ${siteToken}`);
    assert.strictEqual(siteView.status, 200);
    assert.strictEqual(siteView.body.data.status, 'CHAIRMAN_APPROVED');
    assert.strictEqual(siteView.body.data.pendingWith, 'EXECUTIVE');
    assert.strictEqual(siteView.body.data.allocationReviewStage, 'EXECUTIVE');

    const pmTooSoon = await request(app)
      .post(`/api/material-requests/${mrId}/proceed-allocation`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ remark: 'PM cannot skip Executive' });
    assert.strictEqual(pmTooSoon.status, 400);

    const execProceed = await request(app)
      .post(`/api/material-requests/${mrId}/proceed-allocation`)
      .set('Authorization', `Bearer ${execToken}`)
      .send({ remark: 'Executive proceed with allocation' });
    assert.strictEqual(execProceed.status, 200, JSON.stringify(execProceed.body));
    assert.strictEqual(execProceed.body.data.pendingWith, 'PROJECT_MANAGER');
    assert.strictEqual(execProceed.body.data.allocationReviewStage, 'PROJECT_MANAGER');

    const pmProceed = await request(app)
      .post(`/api/material-requests/${mrId}/proceed-allocation`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ remark: 'PM proceed with allocation' });
    assert.strictEqual(pmProceed.status, 200, JSON.stringify(pmProceed.body));
    assert.strictEqual(pmProceed.body.data.pmProceededAllocation, true);
    assert.strictEqual(pmProceed.body.data.pendingWith, 'STORE_INCHARGE');
    assert.strictEqual(pmProceed.body.data.allocationReviewStage, 'STORE_INCHARGE');

    if (pmProceed.body.data.status === 'CHAIRMAN_APPROVED') {
      const storeTooSoon = await request(app)
        .post(`/api/material-requests/${mrId}/proceed-allocation`)
        .set('Authorization', `Bearer ${storeToken}`)
        .send({ remark: 'Store cannot skip stock received' });
      assert.strictEqual(storeTooSoon.status, 400);

      const stockReceived = await request(app)
        .post(`/api/material-requests/${mrId}/stock-received`)
        .set('Authorization', `Bearer ${storeToken}`)
        .send({ remark: 'Material received at store' });
      assert.strictEqual(stockReceived.status, 200, JSON.stringify(stockReceived.body));
      assert.strictEqual(stockReceived.body.data.status, 'MATERIAL_RECEIVED');
    }

    const issueQueue = await request(app)
      .get('/api/material-requests')
      .query({ queue: 'store-issue-to-site' })
      .set('Authorization', `Bearer ${storeToken}`);
    assert.strictEqual(issueQueue.status, 200);
    assert.ok((issueQueue.body.data || []).some((row) => row.id === mrId));

    const storeProceed = await request(app)
      .post(`/api/material-requests/${mrId}/proceed-allocation`)
      .set('Authorization', `Bearer ${storeToken}`)
      .send({ remark: 'Store proceed with allocation' });
    assert.strictEqual(storeProceed.status, 200, JSON.stringify(storeProceed.body));
    assert.strictEqual(storeProceed.body.data.status, 'ISSUED');
    assert.strictEqual(storeProceed.body.data.pendingWith, 'SITE_INCHARGE');
    assert.strictEqual(storeProceed.body.data.allocationReviewStage, 'SITE_INCHARGE');
  });

  it('stock-received is store-only and requires an approved indent', async () => {
    const coordinatorToken = await loginAs('coordinator@bekem.com');
    const createRes = await request(app)
      .post('/api/material-requests')
      .set('Authorization', `Bearer ${siteToken}`)
      .send({
        indentRequestType: 'ABOVE_5000',
        requestedByName: 'Test Requester',
        indentCategoryId: indentCategoryId,
        purpose: 'Stock received guard',
        items: [{ materialId: material._id.toString(), quantityRequested: 1 }],
      });
    assert.strictEqual(createRes.status, 201);
    const mrId = createRes.body.data.id;

    const coordBlocked = await request(app)
      .post(`/api/material-requests/${mrId}/stock-received`)
      .set('Authorization', `Bearer ${coordinatorToken}`)
      .send({ remark: 'Coordinator cannot record store GRN' });
    assert.strictEqual(coordBlocked.status, 403);

    const tooEarly = await request(app)
      .post(`/api/material-requests/${mrId}/stock-received`)
      .set('Authorization', `Bearer ${storeToken}`)
      .send({ remark: 'Still pending at store' });
    assert.strictEqual(tooEarly.status, 400);
  });

  it('store can proceed-allocation on received/allocated indent without PO review chain', async () => {
    const createRes = await request(app)
      .post('/api/material-requests')
      .set('Authorization', `Bearer ${siteToken}`)
      .send({
        indentRequestType: 'ABOVE_5000',
        requestedByName: 'Test Requester',
        indentCategoryId: indentCategoryId,
        purpose: 'Local stock available — issue without procurement',
        items: [{ materialId: material._id.toString(), quantityRequested: 1 }],
      });
    assert.strictEqual(createRes.status, 201);
    const mrId = createRes.body.data.id;

    await MaterialRequest.findByIdAndUpdate(mrId, {
      status: 'MATERIAL_RECEIVED',
      pendingWithRole: 'STORE_INCHARGE',
      allocationReviewStage: null,
      pmProceededAllocation: false,
    });

    const storeProceed = await request(app)
      .post(`/api/material-requests/${mrId}/proceed-allocation`)
      .set('Authorization', `Bearer ${storeToken}`)
      .send({ remark: 'vv' });
    assert.strictEqual(storeProceed.status, 200, JSON.stringify(storeProceed.body));
    assert.strictEqual(storeProceed.body.data.status, 'ISSUED');
    assert.strictEqual(storeProceed.body.data.pendingWith, 'SITE_INCHARGE');
  });
});
