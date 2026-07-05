/**
 * Spec 30–35: continuous GRN numbering, e-way threshold, material categories.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  setupTestDb,
  teardownTestDb,
  loginAs,
  getApp,
} = require('./test/helpers');
const {
  Project,
  PurchaseOrder,
  PurchaseRequest,
  Vendor,
  Material,
  Site,
  User,
  GoodsReceiptNote,
  ProjectGrnCounter,
} = require('./models');
const {
  allocateProjectGrnNumber,
  peekNextProjectGrnNumber,
  formatGrnNumber,
} = require('./services/grnCounterService');
const {
  validateGrnTransportFields,
  EWAY_INVOICE_THRESHOLD_INR,
} = require('./services/poEditService');
const { listMaterialCategories, ensureMaterialCategories } = require('./services/materialCategoryService');

describe('GRN numbering & compliance (spec 30–35)', () => {
  let app;
  let project;
  let storeToken;

  before(async () => {
    await setupTestDb();
    app = getApp();
    storeToken = await loginAs('storeincharge@bekem.com');
    project = await Project.findOne();
    await ProjectGrnCounter.deleteMany({ projectId: project._id });
  });

  after(async () => {
    await ProjectGrnCounter.deleteMany({ projectId: project?._id });
    await teardownTestDb();
  });

  it('allocates continuous GRN numbers across multiple POs in one project', async () => {
    const vendor = await Vendor.findOne();
    const material = await Material.findOne();
    const site = await Site.findOne();
    const storeUser = await User.findOne({ role: 'STORE_INCHARGE' });
    const pr = await PurchaseRequest.findOne({ projectId: project._id });

    const numbers = [];
    for (let i = 0; i < 3; i++) {
      const po = await PurchaseOrder.create({
        draftRef: `TEST-GRNSEQ-${i}`,
        purchaseRequestId: pr._id,
        vendorId: vendor._id,
        amount: 10000,
        paymentTerms: 'Net 30',
        lineItems: [
          {
            materialId: material._id,
            description: 'Seq test',
            quantity: 10,
            rate: 100,
            gstPercent: 18,
            amount: 1000,
          },
        ],
        status: 'APPROVED',
        fulfillmentStatus: 'open_partial',
      });

      const grnNumber = await allocateProjectGrnNumber(project._id);
      numbers.push(grnNumber);
      await GoodsReceiptNote.create({
        grnNumber,
        purchaseOrderId: po._id,
        siteId: site._id,
        items: [
          {
            materialId: material._id,
            quantityOrdered: 10,
            quantityReceived: 5,
            orderedUnitPrice: 100,
            invoiceUnitPrice: 100,
          },
        ],
        receivedQuantity: 5,
        status: 'PARTIALLY_RECEIVED',
        invoiceValue: 500,
        receivedByUserId: storeUser._id,
      });
      await PurchaseOrder.deleteOne({ _id: po._id });
    }

    assert.deepEqual(numbers, ['GRN-001', 'GRN-002', 'GRN-003']);
    const peek = await peekNextProjectGrnNumber(project._id);
    assert.equal(peek.grnNumber, 'GRN-004');
  });

  it('never produces duplicate GRN numbers under concurrent allocation', async () => {
    await ProjectGrnCounter.deleteMany({ projectId: project._id });
    const results = await Promise.all(
      Array.from({ length: 8 }, () => allocateProjectGrnNumber(project._id))
    );
    const unique = new Set(results);
    assert.equal(unique.size, results.length);
    assert.equal(results.length, 8);
  });

  it('requires vehicle and e-way bill above ₹50,000 only', () => {
    assert.equal(EWAY_INVOICE_THRESHOLD_INR, 50000);

    const below = validateGrnTransportFields(49999, { vehicleNo: '', ewayBillNumber: '' });
    assert.equal(below, null);

    const atThreshold = validateGrnTransportFields(50000, { vehicleNo: '', ewayBillNumber: '' });
    assert.equal(atThreshold, null);

    const above = validateGrnTransportFields(50001, { vehicleNo: '', ewayBillNumber: '' });
    assert.ok(above);
    assert.equal(above.statusCode, 400);

    const aboveOk = validateGrnTransportFields(50001, {
      vehicleNo: 'TN01AB1234',
      ewayBillNumber: 'EWB123',
    });
    assert.equal(aboveOk, null);
  });

  it('seeds exactly two material categories from database', async () => {
    await ensureMaterialCategories();
    const rows = await listMaterialCategories();
    assert.equal(rows.length, 2);
    const names = rows.map((r) => r.name).sort();
    assert.deepEqual(names, ['Consumables', 'Raw Material']);
  });

  it('formats GRN numbers with zero padding', () => {
    assert.equal(formatGrnNumber(47), 'GRN-047');
    assert.equal(formatGrnNumber(1), 'GRN-001');
  });
});
