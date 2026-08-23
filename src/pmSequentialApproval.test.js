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
const { MaterialRequest, StockLedger, StatusHistory, User } = require('./models');

describe('PM sequential stock + daily cap approval', () => {
  let app;
  let siteToken;
  let storeToken;
  let pmToken;
  let material;
  let site;
  let indentCategoryId;

  before(async () => {
    await setupTestDb();
    app = getApp();
    siteToken = await loginAs('request@bekem.com');
    storeToken = await loginAs('storeincharge@bekem.com');
    pmToken = await loginAs('pm@bekem.com');
    const ctx = await getSeedContext();
    material = ctx.material;
    site = ctx.site;
    indentCategoryId = ctx.indentCategory._id.toString();
  });

  after(async () => teardownTestDb());

  async function resetPmDayAndStock() {
    const pmUser = await User.findOne({ email: 'pm@bekem.com' });
    const { getDayBounds } = require('./services/pmApprovalCapService');
    const { start, endExclusive } = getDayBounds();
    await StatusHistory.deleteMany({
      entityType: 'MaterialRequest',
      actorUserId: pmUser._id,
      timestamp: { $gte: start, $lt: endExclusive },
      $or: [
        { toStatus: 'PM_APPROVED' },
        { toStatus: 'ALLOCATED', fromStatus: 'FORWARDED_TO_PM' },
      ],
    });
    await StockLedger.findOneAndUpdate(
      { siteId: site._id, materialId: material._id },
      { $set: { quantityOnHand: 50, quantityReserved: 0 } },
      { upsert: true }
    );
  }

  async function createAndStoreForward(qty, purpose) {
    const createRes = await request(app)
      .post('/api/material-requests')
      .set('Authorization', `Bearer ${siteToken}`)
      .send({
        indentRequestType: 'ABOVE_5000',
        requestedByName: 'Test Requester',
        indentCategoryId,
        purpose,
        items: [{ materialId: material._id.toString(), quantityRequested: qty }],
      });
    assert.strictEqual(createRes.status, 201, JSON.stringify(createRes.body));
    const mrId = createRes.body.data.id;
    const fwd = await request(app)
      .post(`/api/material-requests/${mrId}/allocate`)
      .set('Authorization', `Bearer ${storeToken}`)
      .send({ decision: 'issue', remark: 'Stock verified independently at store' });
    assert.strictEqual(fwd.status, 200, JSON.stringify(fwd.body));
    return mrId;
  }

  it('Store compares each indent to total stock independently (no deduction)', async () => {
    await resetPmDayAndStock();
    const a = await createAndStoreForward(23, 'Store static A');
    const b = await createAndStoreForward(17, 'Store static B');

    const detailA = await request(app)
      .get(`/api/material-requests/${a}`)
      .set('Authorization', `Bearer ${storeToken}`);
    const detailB = await request(app)
      .get(`/api/material-requests/${b}`)
      .set('Authorization', `Bearer ${storeToken}`);
    assert.strictEqual(detailA.body.data.items[0].availableQty, 50);
    assert.strictEqual(detailB.body.data.items[0].availableQty, 50);
  });

  it('worked example: 50 units, ₹100 — sequential PM deduction then HO on shortfall', async () => {
    await resetPmDayAndStock();

    const id1 = await createAndStoreForward(23, 'Indent 1 ₹2300');
    const id2 = await createAndStoreForward(17, 'Indent 2 ₹1700');
    const id3 = await createAndStoreForward(15, 'Indent 3 ₹1500');

    await MaterialRequest.findByIdAndUpdate(id1, { estimatedValue: 2300 });
    await MaterialRequest.findByIdAndUpdate(id2, { estimatedValue: 1700 });
    await MaterialRequest.findByIdAndUpdate(id3, { estimatedValue: 1500 });

    const close1 = await request(app)
      .post(`/api/material-requests/${id1}/pm-local-close`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ remark: 'Approve indent 1 from remaining stock' });
    assert.strictEqual(close1.status, 200, JSON.stringify(close1.body));
    assert.strictEqual(close1.body.data.status, 'ALLOCATED');
    assert.strictEqual(close1.body.pmApprovalState.decision, 'CLOSED_LOCAL');
    assert.strictEqual(close1.body.pmApprovalState.stockByLine[0].availableQty, 27);
    assert.strictEqual(close1.body.pmApprovalState.dailyApprovedTotal, 2300);
    assert.strictEqual(close1.body.pmApprovalState.remaining, 2700);

    const detail2 = await request(app)
      .get(`/api/material-requests/${id2}`)
      .set('Authorization', `Bearer ${pmToken}`);
    assert.strictEqual(detail2.body.data.items[0].availableQty, 27);

    const close2 = await request(app)
      .post(`/api/material-requests/${id2}/pm-local-close`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ remark: 'Approve indent 2 from remaining stock' });
    assert.strictEqual(close2.status, 200, JSON.stringify(close2.body));
    assert.strictEqual(close2.body.data.status, 'ALLOCATED');
    assert.strictEqual(close2.body.pmApprovalState.stockByLine[0].availableQty, 10);
    assert.strictEqual(close2.body.pmApprovalState.dailyApprovedTotal, 4000);
    assert.strictEqual(close2.body.pmApprovalState.remaining, 1000);

    const detail3 = await request(app)
      .get(`/api/material-requests/${id3}`)
      .set('Authorization', `Bearer ${pmToken}`);
    assert.strictEqual(
      detail3.body.data.items[0].availableQty,
      10,
      'PM must see remaining 10, not original 50'
    );
    assert.strictEqual(detail3.body.data.canFullyIssue, false);

    const close3 = await request(app)
      .post(`/api/material-requests/${id3}/pm-local-close`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ remark: 'Try to approve indent 3' });
    assert.strictEqual(close3.status, 200, JSON.stringify(close3.body));
    assert.strictEqual(close3.body.data.status, 'PENDING_EXECUTIVE_DECISION');
    assert.ok(
      ['FORWARDED_STOCK', 'FORWARDED_DAILY_CAP'].includes(close3.body.pmApprovalState.decision)
    );
    assert.strictEqual(close3.body.pmApprovalState.stockByLine[0].availableQty, 10);

    const ledger = await StockLedger.findOne({ siteId: site._id, materialId: material._id });
    assert.strictEqual(ledger.quantityOnHand, 10);
  });
});
