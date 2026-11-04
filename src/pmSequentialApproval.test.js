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
const { MaterialRequest, StockLedger, StatusHistory, User, Material, PurchaseRequest } = require('./models');

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
    await StockLedger.updateMany(
      { materialId: material._id, siteId: { $ne: site._id } },
      { $set: { quantityOnHand: 0, quantityReserved: 0 } }
    );
    await StockLedger.updateMany(
      { materialId: material._id, siteId: { $ne: site._id } },
      { $set: { quantityOnHand: 0, quantityReserved: 0 } }
    );
  }

  async function createAndStoreForward(qty, purpose, indentRequestType = 'ABOVE_5000') {
    const createRes = await request(app)
      .post('/api/material-requests')
      .set('Authorization', `Bearer ${siteToken}`)
      .send({
        indentRequestType,
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

  it('counts below-₹5,000 indents toward the PM daily limit, allowing the exact limit', async () => {
    const originalMaterial = material;
    material = await Material.create({ code: 'TEST-CAP-MATERIAL', name: 'Cap test material', unit: 'pcs', referenceUnitPrice: 100 });
    await resetPmDayAndStock();
    const ids = [];
    for (const [qty, amount] of [[2, 3000], [2, 2000], [1, 1]]) {
      const id = await createAndStoreForward(qty, `Daily cap ${amount}`, 'BELOW_5000');
      await MaterialRequest.findByIdAndUpdate(id, { estimatedValue: amount });
      ids.push(id);
    }
    for (const id of ids.slice(0, 2)) {
      const result = await request(app).post(`/api/material-requests/${id}/pm-local-close`)
        .set('Authorization', `Bearer ${pmToken}`).send({ remark: 'Approve within daily limit' });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.data.status, 'ALLOCATED');
    }
    const overflow = await request(app).post(`/api/material-requests/${ids[2]}/pm-local-close`)
      .set('Authorization', `Bearer ${pmToken}`).send({ remark: 'Check daily limit' });
    assert.equal(overflow.status, 200, JSON.stringify(overflow.body));
    assert.equal(overflow.body.data.status, 'PENDING_EXECUTIVE_DECISION');
    assert.equal(overflow.body.pmApprovalState.decision, 'FORWARDED_DAILY_CAP');
    const ledger = await StockLedger.findOne({ siteId: site._id, materialId: material._id });
    assert.equal(ledger.quantityOnHand, 46);
    material = originalMaterial;
  });

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

  it('does not exceed the PM daily cap when approvals arrive simultaneously', async () => {
    await resetPmDayAndStock();
    const first = await createAndStoreForward(1, 'Concurrent cap first');
    const second = await createAndStoreForward(1, 'Concurrent cap second');
    await MaterialRequest.updateMany({ _id: { $in: [first, second] } }, { $set: { estimatedValue: 3000 } });
    await Promise.all([first, second].map((id) => request(app)
      .post(`/api/material-requests/${id}/pm-local-close`)
      .set('Authorization', `Bearer ${pmToken}`).send({ remark: 'Concurrent approval' })));
    const pm = await User.findOne({ email: 'pm@bekem.com' });
    const total = await require('./services/pmApprovalCapService').getPmDailyApprovedTotal(pm._id);
    assert.ok(total <= 5000, `daily total ${total} exceeded the limit`);
  });

  it('does not exceed the PM daily cap through the legacy approval endpoint', async () => {
    await resetPmDayAndStock();
    const first = await createAndStoreForward(1, 'Legacy concurrent first');
    const second = await createAndStoreForward(1, 'Legacy concurrent second');
    await MaterialRequest.updateMany({ _id: { $in: [first, second] } }, { $set: { estimatedValue: 3000 } });
    await Promise.all([first, second].map((id) => request(app)
      .post(`/api/material-requests/${id}/approve`)
      .set('Authorization', `Bearer ${pmToken}`).send({})));
    const pm = await User.findOne({ email: 'pm@bekem.com' });
    const total = await require('./services/pmApprovalCapService').getPmDailyApprovedTotal(pm._id);
    assert.ok(total <= 5000, `daily total ${total} exceeded the limit`);
  });

  it('sends simultaneous Coordinator approvals above ₹10,000 to Chairman', async () => {
    await resetPmDayAndStock();
    const token = await loginAs('coordinator@bekem.com');
    const coordinator = await User.findOne({ role: 'COORDINATOR' });
    const first = await createAndStoreForward(1, 'Coordinator concurrent first');
    const second = await createAndStoreForward(1, 'Coordinator concurrent second');
    await MaterialRequest.updateMany({ _id: { $in: [first, second] } },
      { $set: { estimatedValue: 6000, status: 'PENDING_HO' } });
    const responses = await Promise.all([first, second].map((id) => request(app)
      .post(`/api/material-requests/${id}/coordinator-local-close`)
      .set('Authorization', `Bearer ${token}`).send({ remark: 'Concurrent coordinator approval' })));
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    const records = await MaterialRequest.find({ _id: { $in: [first, second] } });
    assert.equal(records.filter((r) => r.status === 'ALLOCATED').length, 1);
    assert.equal(records.filter((r) => r.escalatedToChairman && r.pendingWithRole === 'CHAIRMAN').length, 1);
    const total = await require('./services/coordinatorApprovalCapService').getCoordinatorDailyApprovedTotal(coordinator._id);
    assert.equal(total, 6000);
    const escalated = records.find((r) => r.escalatedToChairman);
    const denied = await request(app).post(`/api/material-requests/${escalated._id}/chairman-approve-indent`)
      .set('Authorization', `Bearer ${token}`).send({ remark: 'Not Chairman' });
    assert.equal(denied.status, 403);
    const chairToken = await loginAs('chairman@bekem.com');
    const approved = await request(app).post(`/api/material-requests/${escalated._id}/chairman-approve-indent`)
      .set('Authorization', `Bearer ${chairToken}`).send({ remark: 'Approved for Coordinator execution' });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.data.pendingWith, 'COORDINATOR');
    const completed = await request(app).post(`/api/material-requests/${escalated._id}/coordinator-local-close`)
      .set('Authorization', `Bearer ${token}`).send({ remark: 'Execute Chairman approval' });
    assert.equal(completed.status, 200, JSON.stringify(completed.body));
    assert.equal(completed.body.data.status, 'ALLOCATED');
    assert.equal(await require('./services/coordinatorApprovalCapService').getCoordinatorDailyApprovedTotal(coordinator._id), 6000);

    const shortId = await createAndStoreForward(1, 'Chairman-approved procurement');
    await MaterialRequest.findByIdAndUpdate(shortId, { estimatedValue: 11000, status: 'PENDING_HO' });
    await StockLedger.updateMany({ siteId: site._id, materialId: material._id }, { $set: { quantityOnHand: 0 } });
    const escalation = await request(app).post(`/api/material-requests/${shortId}/coordinator-local-close`)
      .set('Authorization', `Bearer ${token}`).send({ remark: 'Chairman review needed' });
    assert.equal(escalation.status, 409, JSON.stringify(escalation.body));
    const chairApproval = await request(app).post(`/api/material-requests/${shortId}/chairman-approve-indent`)
      .set('Authorization', `Bearer ${chairToken}`).send({ remark: 'Approved for procurement' });
    assert.equal(chairApproval.status, 200, JSON.stringify(chairApproval.body));
    const procurement = await request(app).post(`/api/material-requests/${shortId}/coordinator-local-close`)
      .set('Authorization', `Bearer ${token}`).send({ remark: 'Proceed to procurement' });
    assert.equal(procurement.status, 200, JSON.stringify(procurement.body));
    assert.equal(procurement.body.data.status, 'PURCHASE_REQUESTED');
    assert.ok(await PurchaseRequest.findOne({ materialRequestId: shortId }));
    assert.equal(await require('./services/coordinatorApprovalCapService').getCoordinatorDailyApprovedTotal(coordinator._id), 6000);
  });

  it('enforces one Coordinator limit across concurrent procurement review and local close', async () => {
    await resetPmDayAndStock();
    const token = await loginAs('coordinator@bekem.com');
    const coordinator = await User.findOne({ role: 'COORDINATOR' });
    await StatusHistory.deleteMany({ actorUserId: coordinator._id, entityType: 'MaterialRequest' });
    const reviewId = await createAndStoreForward(1, 'Concurrent coordinator review');
    const localId = await createAndStoreForward(1, 'Concurrent coordinator local close');
    await MaterialRequest.findByIdAndUpdate(reviewId, { estimatedValue: 6000, status: 'EXECUTIVE_DECISION_PO', executiveProcurementMethod: 'PURCHASE_ORDER' });
    await MaterialRequest.findByIdAndUpdate(localId, { estimatedValue: 6000, status: 'PENDING_HO' });
    const responses = await Promise.all([
      request(app).post(`/api/procurement-decisions/${reviewId}/coordinator-review`)
        .set('Authorization', `Bearer ${token}`).send({ action: 'approve', method: 'PURCHASE_ORDER', remark: 'Concurrent review' }),
      request(app).post(`/api/material-requests/${localId}/coordinator-local-close`)
        .set('Authorization', `Bearer ${token}`).send({ remark: 'Concurrent local close' }),
    ]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409], JSON.stringify(responses.map((r) => r.body)));
    const total = await require('./services/coordinatorApprovalCapService').getCoordinatorDailyApprovedTotal(coordinator._id);
    assert.equal(total, 6000);
    const records = await MaterialRequest.find({ _id: { $in: [reviewId, localId] } });
    assert.equal(records.filter((r) => r.escalatedToChairman && r.pendingWithRole === 'CHAIRMAN').length, 1);
  });

  it('rolls back a Coordinator review when purchase-request creation fails', async () => {
    await resetPmDayAndStock();
    const token = await loginAs('coordinator@bekem.com');
    const coordinator = await User.findOne({ role: 'COORDINATOR' });
    await StatusHistory.deleteMany({ actorUserId: coordinator._id, entityType: 'MaterialRequest' });
    const id = await createAndStoreForward(1, 'Synthetic review rollback');
    await MaterialRequest.findByIdAndUpdate(id, { estimatedValue: 1000, status: 'EXECUTIVE_DECISION_PO', executiveProcurementMethod: 'PURCHASE_ORDER' });
    const originalCreate = PurchaseRequest.create;
    PurchaseRequest.create = async () => { throw new Error('Synthetic purchase request failure'); };
    try {
      const response = await request(app).post(`/api/procurement-decisions/${id}/coordinator-review`)
        .set('Authorization', `Bearer ${token}`).send({ action: 'approve', method: 'PURCHASE_ORDER', remark: 'Test rollback' });
      assert.equal(response.status, 500);
    } finally {
      PurchaseRequest.create = originalCreate;
    }
    const indent = await MaterialRequest.findById(id);
    assert.equal(indent.status, 'EXECUTIVE_DECISION_PO');
    assert.equal(await PurchaseRequest.countDocuments({ materialRequestId: id }), 0);
    assert.equal(await require('./services/coordinatorApprovalCapService').getCoordinatorDailyApprovedTotal(coordinator._id), 0);
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
