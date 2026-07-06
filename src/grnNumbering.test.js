/**
 * Spec 30–35: per-PO GRN numbering, e-way threshold, material categories.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  setupTestDb,
  teardownTestDb,
} = require('./test/helpers');
const {
  PurchaseOrder,
  PurchaseRequest,
  Vendor,
  Material,
  Site,
  User,
  GoodsReceiptNote,
  PurchaseOrderGrnCounter,
} = require('./models');
const {
  allocatePoGrnNumber,
  peekNextPoGrnNumber,
  formatGrnNumber,
} = require('./services/grnCounterService');
const {
  validateGrnTransportFields,
  EWAY_INVOICE_THRESHOLD_INR,
} = require('./services/poEditService');
const { assessGrnHold } = require('./services/grnHoldService');
const { listMaterialCategories, ensureMaterialCategories, PHASE_CATEGORIES } = require('./services/materialCategoryService');

describe('GRN numbering & compliance (spec 30–35)', () => {
  before(async () => {
    await setupTestDb();
  });

  after(async () => {
    await teardownTestDb();
  });

  it('resets GRN sequence per purchase order', async () => {
    const vendor = await Vendor.findOne();
    const material = await Material.findOne();
    const site = await Site.findOne();
    const storeUser = await User.findOne({ role: 'STORE_INCHARGE' });
    const pr = await PurchaseRequest.findOne();

    const po1 = await PurchaseOrder.create({
      draftRef: 'TEST-GRNSEQ-A',
      purchaseRequestId: pr._id,
      vendorId: vendor._id,
      amount: 10000,
      paymentTerms: 'Net 30',
      lineItems: [
        {
          materialId: material._id,
          description: 'Seq test A',
          quantity: 10,
          rate: 100,
          gstPercent: 18,
          amount: 1000,
        },
      ],
      status: 'APPROVED',
      fulfillmentStatus: 'open_partial',
    });

    const po2 = await PurchaseOrder.create({
      draftRef: 'TEST-GRNSEQ-B',
      purchaseRequestId: pr._id,
      vendorId: vendor._id,
      amount: 10000,
      paymentTerms: 'Net 30',
      lineItems: [
        {
          materialId: material._id,
          description: 'Seq test B',
          quantity: 10,
          rate: 100,
          gstPercent: 18,
          amount: 1000,
        },
      ],
      status: 'APPROVED',
      fulfillmentStatus: 'open_partial',
    });

    await PurchaseOrderGrnCounter.deleteMany({
      purchaseOrderId: { $in: [po1._id, po2._id] },
    });

    const po1Numbers = [];
    for (let i = 0; i < 2; i++) {
      const grnNumber = await allocatePoGrnNumber(po1._id);
      po1Numbers.push(grnNumber);
      await GoodsReceiptNote.create({
        grnNumber,
        purchaseOrderId: po1._id,
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
    }

    const po2First = await allocatePoGrnNumber(po2._id);
    assert.deepEqual(po1Numbers, ['GRN-001', 'GRN-002']);
    assert.equal(po2First, 'GRN-001');

    const peekPo1 = await peekNextPoGrnNumber(po1._id);
    assert.equal(peekPo1.grnNumber, 'GRN-003');

    await PurchaseOrder.deleteMany({ _id: { $in: [po1._id, po2._id] } });
    await GoodsReceiptNote.deleteMany({ purchaseOrderId: { $in: [po1._id, po2._id] } });
    await PurchaseOrderGrnCounter.deleteMany({
      purchaseOrderId: { $in: [po1._id, po2._id] },
    });
  });

  it('never produces duplicate GRN numbers under concurrent allocation on one PO', async () => {
    const pr = await PurchaseRequest.findOne();
    const vendor = await Vendor.findOne();
    const po = await PurchaseOrder.create({
      draftRef: 'TEST-GRN-CONCURRENT',
      purchaseRequestId: pr._id,
      vendorId: vendor._id,
      amount: 5000,
      paymentTerms: 'Net 30',
      lineItems: [],
      status: 'APPROVED',
    });
    await PurchaseOrderGrnCounter.deleteMany({ purchaseOrderId: po._id });

    const results = await Promise.all(
      Array.from({ length: 8 }, () => allocatePoGrnNumber(po._id))
    );
    const unique = new Set(results);
    assert.equal(unique.size, results.length);

    await PurchaseOrder.deleteOne({ _id: po._id });
    await PurchaseOrderGrnCounter.deleteMany({ purchaseOrderId: po._id });
  });

  it('places GRN on hold when e-way bill missing above ₹50,000', () => {
    assert.equal(EWAY_INVOICE_THRESHOLD_INR, 50000);
    assert.equal(validateGrnTransportFields(), null);
    const below = assessGrnHold([], { invoiceValue: 50000, ewayBillNumber: '', saveDraft: false });
    assert.equal(below.requiresHold, false);
    const above = assessGrnHold([], { invoiceValue: 50001, ewayBillNumber: '', saveDraft: false });
    assert.equal(above.requiresHold, true);
    assert.ok(above.holdReasons.includes('EWAY'));
    const withEway = assessGrnHold([], { invoiceValue: 50001, ewayBillNumber: 'EWB123', saveDraft: false });
    assert.equal(withEway.requiresHold, false);
  });

  it('seeds five material categories from database', async () => {
    await ensureMaterialCategories();
    const rows = await listMaterialCategories();
    assert.equal(rows.length, PHASE_CATEGORIES.length);
    const names = rows.map((r) => r.name);
    for (const name of PHASE_CATEGORIES) {
      assert.ok(names.includes(name), `missing category ${name}`);
    }
  });

  it('formats GRN numbers with zero padding', () => {
    assert.equal(formatGrnNumber(47), 'GRN-047');
    assert.equal(formatGrnNumber(1), 'GRN-001');
  });
});
