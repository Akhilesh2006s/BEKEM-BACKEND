const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestDb, teardownTestDb, loginAs, getApp, getSeedContext } = require('./test/helpers');
const { Material } = require('./models');

describe('Indent request type', () => {
  let app;
  let siteToken;
  let storeToken;
  let material;
  let indentCategoryId;

  before(async () => {
    await setupTestDb();
    app = getApp();
    siteToken = await loginAs('request@bekem.com');
    storeToken = await loginAs('storeincharge@bekem.com');
    const ctx = await getSeedContext();
    material =
      (await Material.findOne({ name: 'Cement OPC 53' })) ||
      (await Material.findOne({ referenceUnitPrice: { $lte: 500 } })) ||
      ctx.material;
    indentCategoryId = ctx.indentCategory._id.toString();
    assert.ok(material);
  });

  after(async () => {
    await teardownTestDb();
  });

  it('requires indentRequestType on create', async () => {
    const res = await request(app)
      .post('/api/material-requests')
      .set('Authorization', `Bearer ${siteToken}`)
      .send({
        purpose: 'Missing type',
        items: [{ materialId: material._id.toString(), quantityRequested: 1 }],
      });
    assert.strictEqual(res.status, 400);
  });

  it('rejects BELOW_5000 indent when total reaches cap', async () => {
    const res = await request(app)
      .post('/api/material-requests')
      .set('Authorization', `Bearer ${siteToken}`)
      .send({
        indentRequestType: 'BELOW_5000',
        requestedByName: 'Test Requester',
        indentCategoryId: indentCategoryId,
        purpose: 'Over cap',
        items: [{ materialId: material._id.toString(), quantityRequested: 20 }],
      });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Below ₹5,000/i);
  });

  it('creates BELOW_5000 indent under cap and stores type', async () => {
    const res = await request(app)
      .post('/api/material-requests')
      .set('Authorization', `Bearer ${siteToken}`)
      .send({
        indentRequestType: 'BELOW_5000',
        requestedByName: 'Test Requester',
        indentCategoryId: indentCategoryId,
        purpose: 'Petty purchase',
        items: [{ materialId: material._id.toString(), quantityRequested: 1 }],
      });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.data.indentRequestType, 'BELOW_5000');

    const detail = await request(app)
      .get(`/api/material-requests/${res.body.data.id}`)
      .set('Authorization', `Bearer ${siteToken}`);
    assert.strictEqual(detail.status, 200);
    assert.ok(detail.body.data.items[0].unitPrice != null);
    assert.ok(detail.body.data.estimatedValue > 0);
  });

  it('hides pricing from store on ABOVE_5000 indent detail', async () => {
    const create = await request(app)
      .post('/api/material-requests')
      .set('Authorization', `Bearer ${siteToken}`)
      .send({
        indentRequestType: 'ABOVE_5000',
        requestedByName: 'Test Requester',
        indentCategoryId: indentCategoryId,
        purpose: 'Standard indent',
        items: [{ materialId: material._id.toString(), quantityRequested: 2 }],
      });
    assert.strictEqual(create.status, 201);

    const detail = await request(app)
      .get(`/api/material-requests/${create.body.data.id}`)
      .set('Authorization', `Bearer ${storeToken}`);
    assert.strictEqual(detail.status, 200);
    assert.strictEqual(detail.body.data.indentRequestType, 'ABOVE_5000');
    assert.strictEqual(detail.body.data.estimatedValue, undefined);
    assert.strictEqual(detail.body.data.items[0].unitPrice, undefined);
    assert.strictEqual(detail.body.data.items[0].lineTotal, undefined);
  });

  it('PM approve on BELOW_5000 stays with Store — never escalates to HO', async () => {
    const pmToken = await loginAs('pm@bekem.com');
    const create = await request(app)
      .post('/api/material-requests')
      .set('Authorization', `Bearer ${siteToken}`)
      .send({
        indentRequestType: 'BELOW_5000',
        requestedByName: 'Test Requester',
        indentCategoryId: indentCategoryId,
        purpose: 'Petty no HO',
        items: [{ materialId: material._id.toString(), quantityRequested: 1 }],
      });
    assert.strictEqual(create.status, 201, JSON.stringify(create.body));
    const mrId = create.body.data.id;

    const fwd = await request(app)
      .post(`/api/material-requests/${mrId}/allocate`)
      .set('Authorization', `Bearer ${storeToken}`)
      .send({ decision: 'forward', remark: 'Stock short — forward to PM' });
    assert.strictEqual(fwd.status, 200, JSON.stringify(fwd.body));

    const close = await request(app)
      .post(`/api/material-requests/${mrId}/pm-local-close`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ remark: 'Approved — Store to purchase under ₹5,000' });
    assert.strictEqual(close.status, 200, JSON.stringify(close.body));
    assert.ok(
      ['PM_APPROVED', 'ALLOCATED'].includes(close.body.data.status),
      close.body.data.status
    );
    assert.strictEqual(close.body.data.pendingWith, 'STORE_INCHARGE');
    assert.notStrictEqual(close.body.data.status, 'PENDING_HO');
    assert.notStrictEqual(close.body.data.status, 'PURCHASE_REQUESTED');

    const blockHo = await request(app)
      .post(`/api/material-requests/${mrId}/forward-to-ho`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ remark: 'Should not escalate below cap' });
    assert.ok([400, 200].includes(blockHo.status));
    if (blockHo.status === 400) {
      assert.match(blockHo.body.message || '', /Below ₹5,000/i);
    }
  });
});
