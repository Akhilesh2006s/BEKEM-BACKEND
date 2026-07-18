const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestDb, teardownTestDb, loginAs, getApp } = require('./test/helpers');
const { RFQ, Quotation, Vendor, PurchaseRequest } = require('./models');
const { ensureFinalizedRfqForPo } = require('./test/ensureFinalizedRfqForPo');

describe('RFQ quotation comparison & vendor selection', () => {
  let app;
  let execToken;
  let rfqId;
  let purchaseRequestId;
  let vendorIds;

  before(async () => {
    await setupTestDb();
    app = getApp();
    execToken = await loginAs('executive@bekem.com');

    const pr = await PurchaseRequest.findOne({ status: 'OPEN' });
    assert.ok(pr, 'seed should have open purchase request');
    purchaseRequestId = pr._id.toString();

    const previewRes = await request(app)
      .post('/api/rfqs/wizard/preview')
      .set('Authorization', `Bearer ${execToken}`)
      .send({ purchaseRequestId });
    assert.strictEqual(previewRes.status, 200);

    const rfq = await RFQ.findOne({ purchaseRequestId: pr._id });
    assert.ok(rfq, 'RFQ should be created via wizard preview');
    rfqId = rfq._id.toString();

    const vendors = await Vendor.find({ isActive: { $ne: false } }).limit(3);
    assert.ok(vendors.length >= 3, 'need at least 3 vendors');
    vendorIds = vendors.map((v) => v._id.toString());

    // Seed initial quotes so comparison has vendors (may be empty until PUT)
    await request(app)
      .put(`/api/rfqs/${rfqId}/quotations`)
      .set('Authorization', `Bearer ${execToken}`)
      .send({
        quotations: vendors.map((v, i) => ({
          vendorId: v._id.toString(),
          rate: 1000 + i * 100,
          gstPercent: 18,
          paymentTerms: 'Net 30',
          deliveryTerms: 'FOB site',
        })),
      });
  });

  after(async () => {
    await teardownTestDb();
  });

  it('returns comparison with at least 3 vendor quotations and L1 marker', async () => {
    const res = await request(app)
      .get(`/api/rfqs/${rfqId}/comparison`)
      .set('Authorization', `Bearer ${execToken}`);

    assert.strictEqual(res.status, 200);
    assert.ok(res.body.data.comparison.vendors.length >= 3);
    const l1Count = res.body.data.comparison.vendors.filter((v) => v.isL1).length;
    assert.strictEqual(l1Count, 1);
    assert.ok(res.body.data.comparison.l1VendorId);
    assert.ok(Array.isArray(res.body.data.purchaseHistory));
  });

  it('saves vendor quotations with rate, GST, and terms', async () => {
    const res = await request(app)
      .put(`/api/rfqs/${rfqId}/quotations`)
      .set('Authorization', `Bearer ${execToken}`)
      .send({
        quotations: [
          {
            vendorId: vendorIds[0],
            rate: 1000,
            gstPercent: 18,
            paymentTerms: 'Net 30',
            deliveryTerms: 'FOB site',
          },
          {
            vendorId: vendorIds[1],
            rate: 950,
            gstPercent: 18,
            paymentTerms: 'Net 45',
            deliveryTerms: 'Ex-works',
          },
          {
            vendorId: vendorIds[2],
            rate: 1100,
            gstPercent: 18,
            paymentTerms: 'Advance 30%',
            deliveryTerms: 'Within 7 days',
          },
        ],
      });

    assert.strictEqual(res.status, 200);
    const l1 = res.body.data.comparison.vendors.find((v) => v.isL1);
    assert.ok(l1);
    assert.strictEqual(l1.vendorId, vendorIds[1]);

    const saved = await Quotation.find({ rfqId }).populate('vendorId');
    assert.strictEqual(saved.length, 3);
    assert.ok(saved.every((q) => q.paymentTerms && q.deliveryTerms));
  });

  it('requires Why We Chose This Vendor on finalize', async () => {
    const res = await request(app)
      .post(`/api/rfqs/${rfqId}/finalize`)
      .set('Authorization', `Bearer ${execToken}`)
      .send({
        selectedVendorId: vendorIds[1],
        whyWeChoseThisVendor: '   ',
      });

    assert.strictEqual(res.status, 400);
  });

  it('requires Reason for Selection when non-L1 vendor is chosen', async () => {
    const comparisonRes = await request(app)
      .get(`/api/rfqs/${rfqId}/comparison`)
      .set('Authorization', `Bearer ${execToken}`);
    assert.strictEqual(comparisonRes.status, 200);
    const l1Id = String(comparisonRes.body.data.comparison.l1VendorId || '');
    assert.ok(l1Id, 'comparison should expose L1 vendor');
    assert.ok(vendorIds.includes(l1Id), `L1 ${l1Id} should be one of quoted vendors ${vendorIds.join(',')}`);

    const nonL1 = vendorIds.find((id) => id !== l1Id);
    assert.ok(nonL1, 'need a non-L1 vendor');

    const res = await request(app)
      .post(`/api/rfqs/${rfqId}/finalize`)
      .set('Authorization', `Bearer ${execToken}`)
      .send({
        selectedVendorId: nonL1,
        whyWeChoseThisVendor: 'Vendor offers better payment flexibility for this project',
      });

    assert.strictEqual(res.status, 400, JSON.stringify(res.body));
    assert.match(res.body.message, /Reason for Selection/i);
  });

  it('finalizes RFQ with L1 vendor', async () => {
    const comparisonRes = await request(app)
      .get(`/api/rfqs/${rfqId}/comparison`)
      .set('Authorization', `Bearer ${execToken}`);
    const l1Id = String(comparisonRes.body.data.comparison.l1VendorId);

    const res = await request(app)
      .post(`/api/rfqs/${rfqId}/finalize`)
      .set('Authorization', `Bearer ${execToken}`)
      .send({
        selectedVendorId: l1Id,
        whyWeChoseThisVendor: 'L1',
      });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.status, 'FINALIZED');

    const rfq = await RFQ.findById(rfqId);
    assert.strictEqual(rfq.status, 'FINALIZED');
    assert.strictEqual(rfq.whyWeChoseThisVendor, 'L1');
  });

  it('marks RFQs Obtained without vendor selection', async () => {
    const openPr = await PurchaseRequest.findOne({
      status: 'OPEN',
      _id: { $ne: purchaseRequestId },
    });
    if (!openPr) return;

    const preview = await request(app)
      .post('/api/rfqs/wizard/preview')
      .set('Authorization', `Bearer ${execToken}`)
      .send({ purchaseRequestId: openPr._id.toString() });
    assert.strictEqual(preview.status, 200);
    const openRfqId = preview.body.data.rfqId;

    const res = await request(app)
      .post(`/api/rfqs/${openRfqId}/quotes-obtained`)
      .set('Authorization', `Bearer ${execToken}`);

    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.status, 'FINALIZED');
    assert.ok(res.body.data.quotesObtainedAt);

    const rfq = await RFQ.findById(openRfqId);
    assert.strictEqual(rfq.status, 'FINALIZED');
    assert.ok(rfq.quotesObtainedAt);
    assert.ok(!rfq.selectedVendorId);
  });

  it('blocks PO when RFQ is not finalized', async () => {
    const openPr = await PurchaseRequest.findOne({
      status: 'OPEN',
      _id: { $ne: purchaseRequestId },
    });
    if (!openPr) return;

    const preview = await request(app)
      .post('/api/rfqs/wizard/preview')
      .set('Authorization', `Bearer ${execToken}`)
      .send({ purchaseRequestId: openPr._id.toString() });
    assert.strictEqual(preview.status, 200);

    const vendors = await Vendor.find({ isActive: { $ne: false } }).limit(3);
    const rfq = await RFQ.findOne({ purchaseRequestId: openPr._id });
    await request(app)
      .put(`/api/rfqs/${rfq._id}/quotations`)
      .set('Authorization', `Bearer ${execToken}`)
      .send({
        quotations: vendors.map((v, i) => ({
          vendorId: v._id.toString(),
          rate: 1000 + i * 100,
          gstPercent: 18,
          paymentTerms: 'Net 30',
          deliveryTerms: 'Site delivery',
        })),
      });

    const res = await request(app)
      .post('/api/purchase-orders/wizard')
      .set('Authorization', `Bearer ${execToken}`)
      .send({
        purchaseRequestId: openPr._id.toString(),
        vendorId: vendors[0]._id.toString(),
        paymentTerms: 'Net 30 days',
        whyWeChoseThisVendor: 'Selected for reliability despite slightly higher rate',
      });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Finalize|finaliz|quotations/i);
  });

  it('blocks PO when non-L1 vendor lacks selection reason', async () => {
    const openPr = await PurchaseRequest.findOne({
      status: 'OPEN',
      _id: { $ne: purchaseRequestId },
    });
    if (!openPr) return;

    // rates: v0=1000, v1=1100, v2=1200 → L1 is vendors[0]
    const setup = await ensureFinalizedRfqForPo(app, execToken, openPr._id.toString(), {
      rates: [1000, 1100, 1200],
      selectedVendorIndex: 0,
      whyWeChoseThisVendor: 'L1',
    });

    const nonL1 = setup.vendorIds[2];
    const res = await request(app)
      .post('/api/purchase-orders/wizard')
      .set('Authorization', `Bearer ${execToken}`)
      .send({
        purchaseRequestId: openPr._id.toString(),
        vendorId: nonL1,
        paymentTerms: 'Net 30 days',
        whyWeChoseThisVendor: 'Selected for reliability despite slightly higher rate',
      });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Reason for Selection/i);
  });

  it('allows PO for non-L1 vendor when reason is provided', async () => {
    const openPrs = await PurchaseRequest.find({
      status: 'OPEN',
      _id: { $ne: purchaseRequestId },
    }).limit(3);
    // Prefer a PR that does not already have a PO from prior tests
    let openPr = null;
    for (const pr of openPrs) {
      const existing = await RFQ.findOne({ purchaseRequestId: pr._id, status: 'FINALIZED' });
      if (!existing || existing._id.toString() === rfqId) continue;
      // skip PRs already used if PO exists — try last unused
      openPr = pr;
    }
    openPr = openPr || openPrs[openPrs.length - 1] || openPrs[0];
    if (!openPr) return;
    if (openPr._id.toString() === purchaseRequestId) return;

    const setup = await ensureFinalizedRfqForPo(app, execToken, openPr._id.toString(), {
      rates: [800, 900, 1000],
      selectedVendorIndex: 0,
      whyWeChoseThisVendor: 'L1',
    });

    const nonL1 = setup.vendorIds[2];
    const res = await request(app)
      .post('/api/purchase-orders/wizard')
      .set('Authorization', `Bearer ${execToken}`)
      .send({
        purchaseRequestId: openPr._id.toString(),
        vendorId: nonL1,
        paymentTerms: 'Net 30 days',
        whyWeChoseThisVendor: 'Selected for reliability despite slightly higher rate',
        vendorSelectionReason: 'Only vendor with stock available for immediate dispatch',
      });

    assert.strictEqual(res.status, 201);
  });

  it('PM cannot access RFQ comparison', async () => {
    const pmToken = await loginAs('pm@bekem.com');
    const res = await request(app)
      .get(`/api/rfqs/${rfqId}/comparison`)
      .set('Authorization', `Bearer ${pmToken}`);
    assert.strictEqual(res.status, 403);
  });
});
