const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const {
  setupTestDb,
  teardownTestDb,
  loginAs,
  getApp,
} = require('./test/helpers');
const {
  PurchaseOrder,
  User,
  Vendor,
  PurchaseRequest,
  MaterialRequest,
  Project,
  Site,
  Material,
} = require('./models');
const { createPurchaseOrderFromWizard } = require('./services/procurementService');
const { serializePurchaseOrder } = require('./utils/serializeProcurement');
const { ensureFinalizedRfqForPo } = require('./test/ensureFinalizedRfqForPo');

describe('POST /purchase-orders/:id/verify', () => {
  before(async () => {
    await setupTestDb();
  });

  after(async () => {
    await teardownTestDb();
  });

  it('returns 200 on APPROVE and sets APPROVED', async () => {
    const app = getApp();
    const exec = await User.findOne({ email: 'executive@bekem.com' });
    const site = await Site.findOne();
    const project = await Project.findOne();
    const material = await Material.findOne();
    const siteUser = await User.findOne({ email: 'request@bekem.com' });

    const mr = await MaterialRequest.create({
      indentNumber: 'IND/VERIFY/0001',
      projectId: project._id,
      siteId: site._id,
      materialId: material._id,
      quantityRequested: 5,
      purpose: 'Verify regression test',
      requiredByDate: new Date(),
      requestedByUserId: siteUser._id,
      status: 'PM_APPROVED',
    });

    const pr = await PurchaseRequest.create({
      prNumber: 'PR/VERIFY/0001',
      materialRequestId: mr._id,
      projectId: project._id,
      status: 'OPEN',
      createdByUserId: exec._id,
      amountEstimate: 8000,
    });

    const vendor = await Vendor.findOne();
    const execToken = await loginAs('executive@bekem.com');
    const setup = await ensureFinalizedRfqForPo(app, execToken, pr._id.toString(), {
      rates: [800, 900, 1000],
      whyWeChoseThisVendor: 'L1 for verify test',
    });

    const { po } = await createPurchaseOrderFromWizard({
      purchaseRequestId: pr._id,
      vendorId: setup.selectedVendorId || vendor._id,
      paymentTerms: 'Net 30',
      actorUserId: exec._id,
    });

    assert.strictEqual(po.status, 'COORDINATOR_PENDING');

    const coordToken = await loginAs('coordinator@bekem.com');
    const res = await request(app)
      .post(`/api/purchase-orders/${po._id}/verify`)
      .set('Authorization', `Bearer ${coordToken}`)
      .send({ action: 'APPROVE', note: 'Verified' });

    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.status, 'APPROVED');

    const updated = await PurchaseOrder.findById(po._id);
    assert.strictEqual(updated.status, 'APPROVED');
    assert.ok(updated.poNumber, 'official PO number should be assigned on approval');
  });

  it('serializePurchaseOrder does not throw when quotation rfqId is missing', () => {
    const payload = serializePurchaseOrder({
      _id: '507f1f77bcf86cd799439011',
      poNumber: 'PO/TEST/0001',
      purchaseRequestId: '507f1f77bcf86cd799439012',
      vendorId: { _id: '507f1f77bcf86cd799439013', name: 'Vendor', contactInfo: '', category: '', rating: 0 },
      quotationId: { _id: '507f1f77bcf86cd799439014', amount: 1000, terms: 'Net 30', vendorId: { _id: '507f1f77bcf86cd799439013', name: 'Vendor', contactInfo: '', category: '', rating: 0 } },
      amount: 1000,
      paymentTerms: 'Net 30',
      status: 'CHAIRMAN_PENDING',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    assert.strictEqual(payload.quotation?.amount, 1000);
    assert.strictEqual(payload.quotation?.rfqId, '');
  });
});
