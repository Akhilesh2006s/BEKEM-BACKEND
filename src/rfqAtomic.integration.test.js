const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');
const { setupTestDb, teardownTestDb, loginAs, getApp } = require('./test/helpers');
const { RFQ, Quotation, Vendor, PurchaseRequest } = require('./models');

describe('Atomic multi-vendor quotation updates', () => {
  let app, executiveToken, rfqId, materialId, vendorIds;
  before(async () => {
    await setupTestDb(); app = getApp(); executiveToken = await loginAs('executive@bekem.com');
    const pr = await PurchaseRequest.findOne({ status: 'OPEN' });
    const preview = await request(app).post('/api/rfqs/wizard/preview')
      .set('Authorization', `Bearer ${executiveToken}`).send({ purchaseRequestId: pr._id.toString() });
    assert.equal(preview.status, 200);
    const rfq = await RFQ.findOne({ purchaseRequestId: pr._id }); rfqId = rfq._id.toString();
    const view = await request(app).get(`/api/rfqs/${rfqId}/comparison`).set('Authorization', `Bearer ${executiveToken}`);
    materialId = view.body.data.items[0].materialId;
    const vendors = await Vendor.find({ isActive: { $ne: false } }).limit(3); vendorIds = vendors.map((v) => v._id.toString());
    assert.equal(vendorIds.length, 3);
    const init = await request(app).put(`/api/rfqs/${rfqId}/quotations`).set('Authorization', `Bearer ${executiveToken}`).send({
      quotations: vendorIds.map((vendorId) => ({ vendorId, rate: 0, gstPercent: 18,
        selectedMaterialIds: [materialId], itemRates: [{ materialId, rate: 0, gstPercent: 18 }] })) });
    assert.equal(init.status, 200, JSON.stringify(init.body));
  });
  after(async () => { await teardownTestDb(); });
  const rates = (values) => values.map((rate, i) => ({ vendorId: vendorIds[i], materialId, rate, gstPercent: 18 }));
  const savedRates = async () => {
    const rows = await Quotation.find({ rfqId }).lean();
    return vendorIds.map((id) => rows.find((q) => String(q.vendorId) === id)?.itemQuotes[0]?.rate);
  };
  it('persists the rates used for comparing all three vendors', async () => {
    const res = await request(app).patch(`/api/rfqs/${rfqId}/quotation-rates`)
      .set('Authorization', `Bearer ${executiveToken}`).send({ rates: rates([100, 200, 300]) });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(await savedRates(), [100, 200, 300]);
  });
  it('does not save any rate when an unassigned vendor is included', async () => {
    const invalid = [...rates([110, 210]), { vendorId: new mongoose.Types.ObjectId().toString(), materialId, rate: 310, gstPercent: 18 }];
    const res = await request(app).patch(`/api/rfqs/${rfqId}/quotation-rates`)
      .set('Authorization', `Bearer ${executiveToken}`).send({ rates: invalid });
    assert.equal(res.status, 400);
    assert.deepEqual(await savedRates(), [100, 200, 300]);
  });
  it('rolls back all rates if a later quotation write fails', async () => {
    const original = Quotation.prototype.save; let calls = 0;
    Quotation.prototype.save = async function (...args) { if (++calls === 2) throw new Error('Injected quotation write failure'); return original.apply(this, args); };
    let res;
    try { res = await request(app).patch(`/api/rfqs/${rfqId}/quotation-rates`)
      .set('Authorization', `Bearer ${executiveToken}`).send({ rates: rates([120, 220, 320]) }); }
    finally { Quotation.prototype.save = original; }
    assert.equal(res.status, 500);
    assert.deepEqual(await savedRates(), [100, 200, 300]);
  });
});
