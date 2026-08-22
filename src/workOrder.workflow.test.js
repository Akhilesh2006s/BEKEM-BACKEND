const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestDb, teardownTestDb, loginAs, getSeedContext, getApp } = require('./test/helpers');
const { PurchaseOrder, PurchaseRequest, Vendor, User } = require('./models');

async function postJson(app, token, path, body) {
  return request(app).post(path).set('Authorization', `Bearer ${token}`).send(body);
}

describe('Work order approval workflow', () => {
  let app;
  let execToken;
  let pmToken;
  let coordToken;
  let chairmanToken;
  let po;

  before(async () => {
    await setupTestDb();
    app = getApp();
    execToken = await loginAs('executive@bekem.com');
    pmToken = await loginAs('pm@bekem.com');
    coordToken = await loginAs('coordinator@bekem.com');
    chairmanToken = await loginAs('chairman@bekem.com');

    const { project } = await getSeedContext();
    await User.updateOne(
      { email: 'pm@bekem.com' },
      { $addToSet: { assignedProjectIds: project._id } }
    );

    const pr = await PurchaseRequest.findOne({ projectId: project._id });
    const vendor = await Vendor.findOne();
    assert.ok(pr);
    assert.ok(vendor);

    po = await PurchaseOrder.create({
      draftRef: 'TEST-WO-FLOW',
      purchaseRequestId: pr._id,
      vendorId: vendor._id,
      amount: 50000,
      paymentTerms: 'Net 30',
      lineItems: [{ description: 'WO flow item', quantity: 10, rate: 5000, gstPercent: 18, amount: 50000 }],
      status: 'APPROVED',
    });
  });

  after(async () => {
    if (po) await PurchaseOrder.deleteOne({ _id: po._id });
    await teardownTestDb();
  });

  it('walks create → PM → Executive return → PM → Coordinator → Chairman → accept → progress → close', async () => {
    const createRes = await postJson(app, execToken, '/api/work-orders', {
      purchaseOrderId: po._id.toString(),
      scope: 'Install solar rooftop package',
      totalQuantity: 10,
      quantityUnit: 'Units',
    });
    assert.strictEqual(createRes.status, 201, JSON.stringify(createRes.body));
    assert.strictEqual(createRes.body.data.status, 'PM_PENDING');
    const woId = createRes.body.data.id;

    const pmQueue = await request(app)
      .get('/api/work-orders')
      .query({ queue: 'pm' })
      .set('Authorization', `Bearer ${pmToken}`);
    assert.strictEqual(pmQueue.status, 200);
    assert.ok((pmQueue.body.data || []).some((row) => row.id === woId));

    const pmApprove = await postJson(app, pmToken, `/api/work-orders/${woId}/pm-approve`, {
      note: 'PM approved',
    });
    assert.strictEqual(pmApprove.status, 200, JSON.stringify(pmApprove.body));
    assert.strictEqual(pmApprove.body.data.status, 'EXECUTIVE_PENDING');

    const execQueue = await request(app)
      .get('/api/work-orders')
      .query({ queue: 'executive' })
      .set('Authorization', `Bearer ${execToken}`);
    assert.ok((execQueue.body.data || []).some((row) => row.id === woId));

    const returned = await postJson(app, execToken, `/api/work-orders/${woId}/executive-review`, {
      action: 'RETURN',
      note: 'Need PM to recheck quantity',
    });
    assert.strictEqual(returned.status, 200, JSON.stringify(returned.body));
    assert.strictEqual(returned.body.data.status, 'PM_PENDING');

    const pmAgain = await postJson(app, pmToken, `/api/work-orders/${woId}/pm-approve`, {
      note: 'Quantity confirmed',
    });
    assert.strictEqual(pmAgain.status, 200, JSON.stringify(pmAgain.body));
    assert.strictEqual(pmAgain.body.data.status, 'EXECUTIVE_PENDING');

    const execApprove = await postJson(app, execToken, `/api/work-orders/${woId}/executive-review`, {
      action: 'APPROVE',
    });
    assert.strictEqual(execApprove.status, 200, JSON.stringify(execApprove.body));
    assert.strictEqual(execApprove.body.data.status, 'COORDINATOR_PENDING');

    const coordQueue = await request(app)
      .get('/api/work-orders')
      .query({ queue: 'coordinator' })
      .set('Authorization', `Bearer ${coordToken}`);
    assert.ok((coordQueue.body.data || []).some((row) => row.id === woId));

    const coordVerify = await postJson(app, coordToken, `/api/work-orders/${woId}/verify`, {
      action: 'APPROVE',
    });
    assert.strictEqual(coordVerify.status, 200, JSON.stringify(coordVerify.body));
    assert.strictEqual(coordVerify.body.data.status, 'CHAIRMAN_PENDING');

    const chairmanQueue = await request(app)
      .get('/api/work-orders')
      .query({ queue: 'chairman' })
      .set('Authorization', `Bearer ${chairmanToken}`);
    assert.ok((chairmanQueue.body.data || []).some((row) => row.id === woId));

    const chairmanApprove = await postJson(app, chairmanToken, `/api/work-orders/${woId}/approve`, {
      note: 'Final approval',
    });
    assert.strictEqual(chairmanApprove.status, 200, JSON.stringify(chairmanApprove.body));
    assert.strictEqual(chairmanApprove.body.data.status, 'PENDING_ACCEPTANCE');

    const accept = await postJson(app, execToken, `/api/work-orders/${woId}/accept`, {});
    assert.strictEqual(accept.status, 200, JSON.stringify(accept.body));
    assert.strictEqual(accept.body.data.status, 'ACCEPTED');

    const progress = await postJson(app, pmToken, `/api/work-orders/${woId}/progress`, {
      completedQuantity: 10,
    });
    assert.strictEqual(progress.status, 200, JSON.stringify(progress.body));
    assert.strictEqual(progress.body.data.status, 'IN_PROGRESS');
    assert.strictEqual(progress.body.data.progressPercent, 100);

    const close = await postJson(app, pmToken, `/api/work-orders/${woId}/close`, {
      note: 'Work complete',
    });
    assert.strictEqual(close.status, 200, JSON.stringify(close.body));
    assert.strictEqual(close.body.data.status, 'CLOSED');
  });
});
