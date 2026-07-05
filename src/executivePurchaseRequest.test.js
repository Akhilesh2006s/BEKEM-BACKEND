const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const { setupTestDb, teardownTestDb, loginAs, getApp } = require('./test/helpers');
const { Material, PurchaseOrder, PurchaseRequest } = require('./models');

describe('Executive purchase request queue', () => {
  let app;
  let executiveToken;

  before(async () => {
    await setupTestDb();
    app = getApp();
    executiveToken = await loginAs('executive@bekem.com');
  });

  after(async () => {
    await teardownTestDb();
  });

  it('getLatestApprovedRates returns rate from approved PO line items', async () => {
    const material = await Material.findOne({ code: { $exists: true } });
    assert.ok(material, 'seed material required');

    await PurchaseOrder.create({
      purchaseRequestId: new mongoose.Types.ObjectId(),
      vendorId: new mongoose.Types.ObjectId(),
      quotationId: new mongoose.Types.ObjectId(),
      amount: 25000,
      paymentTerms: 'Net 30',
      lineItems: [
        {
          description: material.name,
          materialId: material._id,
          quantity: 10,
          rate: 250,
          amount: 2500,
        },
      ],
      status: 'APPROVED',
      finalApprovedAt: new Date(),
    });

    const { getLatestApprovedRate } = require('./services/materialPricingService');
    const rate = await getLatestApprovedRate(material._id);
    assert.equal(rate, 250);
  });

  it('executive queue API returns meta count aligned with list', async () => {
    const { countExecutivePendingPurchaseRequests } = require('./services/executivePurchaseRequestQueueService');
    const expected = await countExecutivePendingPurchaseRequests();
    const res = await request(app)
      .get('/api/purchase-requests')
      .set('Authorization', `Bearer ${executiveToken}`)
      .query({ queue: 'pending-po', readyForPo: 'true' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.meta.count, expected);
    assert.strictEqual(res.body.data.length, expected);
  });

  it('executive can record purchase order recommendation on open PR', async () => {
    const pr = await PurchaseRequest.findOne({ status: 'OPEN' });
    if (!pr) return;

    const existingPo = await PurchaseOrder.findOne({
      purchaseRequestId: pr._id,
      status: { $ne: 'REJECTED' },
    });
    if (existingPo) return;

    const res = await request(app)
      .post(`/api/purchase-requests/${pr._id}/executive-decide`)
      .set('Authorization', `Bearer ${executiveToken}`)
      .send({ method: 'PURCHASE_ORDER', remark: 'UAT test recommendation' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.executiveRecommendation, 'PURCHASE_ORDER');
    assert.strictEqual(res.body.data.executiveRecommendationRemark, 'UAT test recommendation');
  });
});
