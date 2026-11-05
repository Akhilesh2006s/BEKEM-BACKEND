const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestDb, teardownTestDb, loginAs, getApp } = require('./test/helpers');
const { Project, Vendor, Material, PurchaseRequest, PurchaseOrder } = require('./models');

test('returned PO can be corrected and resubmitted without bypassing review', async () => {
  await setupTestDb();
  try {
    const app = getApp();
    const executive = await loginAs('executive@bekem.com');
    const coordinator = await loginAs('coordinator@bekem.com');
    const pm = await loginAs('pm@bekem.com');
    const project = await Project.findOne();
    const pr = await PurchaseRequest.findOne({ projectId: project._id });
    const vendor = await Vendor.findOne();
    const material = await Material.findOne();
    const po = await PurchaseOrder.create({ draftRef: 'TEST-RETURN-RESUBMIT', purchaseRequestId: pr._id, vendorId: vendor._id, amount: 100, paymentTerms: 'Net 30', status: 'COORDINATOR_PENDING', lineItems: [{ materialId: material._id, description: 'Synthetic', quantity: 1, rate: 100, amount: 100 }] });
    const endpoint = `/api/purchase-orders/${po._id}`;
    const send = (method, path, token, body) => request(app)[method](endpoint + path).set('Authorization', `Bearer ${token}`).send(body || {});
    assert.equal((await send('patch', '', executive, { paymentTerms: 'Net 45' })).status, 403);
    assert.equal((await send('post', '/return', coordinator, { reason: 'Correct terms' })).status, 200);
    assert.equal((await send('patch', '', executive, { paymentTerms: 'Net 45' })).status, 200);
    assert.equal((await send('post', '/resubmit', pm)).status, 403);
    assert.equal((await send('post', '/resubmit', executive)).status, 200);
    const saved = await PurchaseOrder.findById(po._id).lean();
    assert.equal(saved.paymentTerms, 'Net 45');
    assert.equal(saved.status, 'COORDINATOR_PENDING');
    assert.equal((await send('post', '/resubmit', executive)).status, 409);
    assert.equal((await send('post', '/verify', coordinator, { action: 'APPROVE' })).status, 200);
    assert.equal((await PurchaseOrder.findById(po._id)).status, 'CHAIRMAN_PENDING');
  } finally { await teardownTestDb(); }
});
