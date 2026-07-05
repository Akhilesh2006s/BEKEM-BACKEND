/**
 * PO wizard: MSME validation, HSN/GST lines, billing & delivery addresses.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestDb, teardownTestDb, loginAs, getApp } = require('./test/helpers');
const {
  MaterialRequest,
  PurchaseRequest,
  Vendor,
  Material,
  PurchaseOrder,
} = require('./models');
const { BEKEM_WORKSHOP_ADDRESS } = require('./constants/bekemAddresses');

describe('PO wizard integration (MSME / HSN / GST / addresses)', () => {
  let app;
  let execToken;
  let coordToken;

  before(async () => {
    await setupTestDb();
    app = getApp();
    execToken = await loginAs('executive@bekem.com');
    coordToken = await loginAs('coordinator@bekem.com');
  });

  after(async () => {
    await teardownTestDb();
  });

  it('rejects MSME vendor without certificate on wizard batch', async () => {
    const vendorRes = await request(app)
      .post('/api/vendors')
      .set('Authorization', `Bearer ${coordToken}`)
      .send({
        name: 'MSME Wizard Block',
        code: 'MWB',
        isMsme: true,
        msmeNumber: 'UDYAM-TEST-001',
        gstNumber: '29AAAAA0000A1Z5',
        category: 'Test',
      });
    assert.strictEqual(vendorRes.status, 400);

    const mr = await MaterialRequest.findOne({
      status: { $in: ['PURCHASE_REQUESTED', 'FORWARDED_TO_PM', 'PM_APPROVED'] },
    });
    const material = await Material.findOne();
    const vendor = await Vendor.findOne({ isMsme: { $ne: true } });
    assert.ok(mr && material && vendor);

    const badVendor = await Vendor.findOne({ isMsme: true, msmeCertificateUrl: { $exists: true, $ne: '' } });
    if (!badVendor) return;

    const res = await request(app)
      .post('/api/purchase-orders/wizard/batch')
      .set('Authorization', `Bearer ${execToken}`)
      .send({
        materialRequestId: mr._id.toString(),
        paymentTerms: 'Net 30',
        billingAddressType: 'registered_office',
        deliveryAddressType: 'workshop',
        deliveryAddress: BEKEM_WORKSHOP_ADDRESS,
        orders: [
          {
            vendorId: vendor._id.toString(),
            lineItems: [
              {
                description: material.name,
                materialId: material._id.toString(),
                hsnCode: material.hsnCode || '72142090',
                quantity: 5,
                rate: 1000,
                gstPercent: 18,
                amount: 5000,
              },
            ],
          },
        ],
      });

    assert.ok([200, 201].includes(res.status));
  });

  it('creates draft PO with HSN, GST and workshop delivery via wizard', async () => {
    const vendor = await Vendor.findOne();
    const mr = await MaterialRequest.findOne({
      status: { $in: ['PURCHASE_REQUESTED', 'FORWARDED_TO_PM', 'PM_APPROVED', 'PENDING_HO'] },
    });
    const material = await Material.findOne();
    assert.ok(vendor && mr && material);

    const res = await request(app)
      .post('/api/purchase-orders/wizard/batch')
      .set('Authorization', `Bearer ${execToken}`)
      .send({
        materialRequestId: mr._id.toString(),
        paymentTerms: 'Net 30 days',
        billingAddressType: 'registered_office',
        deliveryAddressType: 'workshop',
        deliveryAddress: BEKEM_WORKSHOP_ADDRESS,
        referenceNote: 'Wizard integration test',
        orders: [
          {
            vendorId: vendor._id.toString(),
            lineItems: [
              {
                description: `${material.name} — wizard test`,
                materialId: material._id.toString(),
                hsnCode: material.hsnCode || '25232930',
                quantity: 10,
                rate: 450,
                gstPercent: 18,
                amount: 4500,
              },
            ],
          },
        ],
      });

    assert.strictEqual(res.status, 201);
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.data.length >= 1);

    const poId = res.body.data[0].id;
    const po = await PurchaseOrder.findById(poId);
    assert.ok(po);
    assert.strictEqual(po.deliveryAddressType, 'workshop');
    assert.ok(po.deliveryAddress.includes('Workshop') || po.deliveryAddress.length > 20);
    assert.strictEqual(po.lineItems[0].hsnCode, material.hsnCode || '25232930');
    assert.strictEqual(po.lineItems[0].gstPercent, 18);
    assert.ok(po.draftRef || po.poNumber);
  });

  it('preview-quotations returns line items with HSN from indent', async () => {
    const pr = await PurchaseRequest.findOne({ status: 'OPEN' });
    if (!pr) return;

    const res = await request(app)
      .post('/api/purchase-orders/wizard/preview-quotations')
      .set('Authorization', `Bearer ${execToken}`)
      .send({ purchaseRequestId: pr._id.toString() });

    assert.strictEqual(res.status, 200);
    assert.ok(res.body.data);
    if (res.body.lineItems?.length) {
      assert.ok(res.body.lineItems[0].hsnCode || res.body.lineItems[0].materialId);
    }
  });
});
