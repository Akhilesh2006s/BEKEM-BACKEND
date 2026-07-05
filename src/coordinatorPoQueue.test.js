const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const {
  setupTestDb,
  teardownTestDb,
  loginAs,
  getApp,
} = require('./test/helpers');
const { PurchaseOrder } = require('./models');
const {
  countCoordinatorVerifyPos,
  COORDINATOR_VERIFY_PO_STATUSES,
} = require('./services/coordinatorPoQueueService');

describe('Coordinator PO verification queue', () => {
  let app;
  let coordinatorToken;

  before(async () => {
    await setupTestDb();
    app = getApp();
    coordinatorToken = await loginAs('coordinator@bekem.com');
  });

  after(async () => {
    await teardownTestDb();
  });

  it('lists the same POs as the shared verification count', async () => {
    const expected = await countCoordinatorVerifyPos();
    const res = await request(app)
      .get('/api/purchase-orders')
      .set('Authorization', `Bearer ${coordinatorToken}`)
      .query({ queue: 'coordinator' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.meta.count, expected);
    assert.strictEqual(res.body.data.length, expected);
  });

  it('includes COORDINATOR_PENDING seed POs in the queue', async () => {
    const pending = await PurchaseOrder.countDocuments({
      status: { $in: COORDINATOR_VERIFY_PO_STATUSES },
    });
    assert.ok(pending > 0, 'seed should include coordinator-pending POs');
  });
});
