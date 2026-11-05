const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestDb, teardownTestDb, loginAs, getApp, getSeedContext, createTestIndentBody } = require('./test/helpers');
const { User, Material, MaterialRequest, StockLedger, PurchaseRequest } = require('./models');
const { ensureFinalizedRfqForPo } = require('./test/ensureFinalizedRfqForPo');

test('foreign PM cannot perform store actions or allocation review', async () => {
  await setupTestDb();
  try {
    const app = getApp(), ctx = await getSeedContext();
    const tokens = {};
    for (const [role, email] of Object.entries({ site:'request@bekem.com', store:'storeincharge@bekem.com', pm:'pm@bekem.com', foreign:'pm2@bekem.com', exec:'executive@bekem.com', coord:'coordinator@bekem.com', chair:'chairman@bekem.com' })) tokens[role] = await loginAs(email);
    const post = (url, role, body = {}) => request(app).post(url).set('Authorization', `Bearer ${tokens[role]}`).send(body);
    const material = await Material.findOne({ code:'MAT-CEMENT-OPC53' });
    const body = await createTestIndentBody(material._id, { purpose: 'Synthetic project scope regression', indentRequestType: 'ABOVE_5000' });
    const made = await post('/api/material-requests', 'site', body);
    assert.equal(made.status, 201);
    const id = made.body.data.id;
    let mr = await MaterialRequest.findById(id).lean();
    const foreign = await User.findOne({ email: 'pm2@bekem.com' }).lean();
    assert.equal(foreign.assignedProjectIds.some(x => String(x) === String(mr.projectId)), false);
    for (const [path, payload] of [['allocate',{decision:'forward',remark:'Synthetic'}], ['allocate',{decision:'issue',remark:'Synthetic'}], ['forward',{remark:'Synthetic'}], ['store-reject',{remark:'Synthetic'}]]) {
      assert.equal((await post(`/api/material-requests/${id}/${path}`, 'foreign', payload)).status, 403, path);
      assert.equal((await MaterialRequest.findById(id)).status, 'PENDING_STORE');
    }
    assert.equal((await post(`/api/material-requests/${id}/allocate`, 'store', {decision:'forward',remark:'Synthetic'})).status, 200);
    assert.equal((await post(`/api/material-requests/${id}/approve`, 'pm')).status, 200);
    const pr = await PurchaseRequest.findOne({ materialRequestId:id });
    const rfq = await ensureFinalizedRfqForPo(app, tokens.exec, String(pr._id), { rates:[1000,1100,1200] });
    const po = await post('/api/purchase-orders/wizard', 'exec', { purchaseRequestId:String(pr._id), vendorId:rfq.l1VendorId, paymentTerms:'Net 30' });
    assert.equal(po.status, 201);
    assert.equal((await post(`/api/purchase-orders/${po.body.data.id}/verify`, 'coord', {action:'APPROVE'})).status, 200);
    assert.equal((await post(`/api/purchase-orders/${po.body.data.id}/approve`, 'chair')).status, 200);
    assert.equal((await post(`/api/material-requests/${id}/proceed-allocation`, 'exec', {remark:'Synthetic'})).status, 200);
    mr = await MaterialRequest.findById(id).lean();
    assert.equal(mr.allocationReviewStage, 'PROJECT_MANAGER');
    const before = await StockLedger.findOne({siteId:mr.siteId,materialId:material._id}).lean();
    assert.equal((await post(`/api/material-requests/${id}/proceed-allocation`, 'foreign', {remark:'Synthetic'})).status, 403);
    const unchanged = await MaterialRequest.findById(id).lean();
    const after = await StockLedger.findOne({siteId:mr.siteId,materialId:material._id}).lean();
    assert.equal(unchanged.allocationReviewStage, 'PROJECT_MANAGER');
    assert.equal(after.quantityOnHand, before.quantityOnHand);
    assert.equal((await post(`/api/material-requests/${id}/proceed-allocation`, 'pm', {remark:'Synthetic'})).status, 200);
  } finally { await teardownTestDb(); }
});
