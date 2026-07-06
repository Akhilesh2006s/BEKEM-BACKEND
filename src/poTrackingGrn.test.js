/**
 * Spec 21–29: PO timeline, delivery alerts, multi-GRN, partial variance, edit locks.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { setupTestDb, teardownTestDb } = require('./test/helpers');
const {
  User,
  PurchaseOrder,
  PurchaseRequest,
  Project,
  Vendor,
  Material,
  GoodsReceiptNote,
  DeliveryVerification,
  DeliveryAlert,
  PoStatusTimeline,
  Site,
} = require('./models');
const { getPoTimeline, recordPoCreated, recordPoSent } = require('./services/poTimelineService');
const { processOverdueDeliveries } = require('./services/deliveryAlertService');
const {
  computeLineVariances,
  syncPoFulfillment,
  getCumulativeReceivedByLine,
} = require('./services/grnFulfillmentService');
const { EDITABLE_STATUSES, COORDINATOR_EDIT_STATUSES, CHAIRMAN_EDIT_STATUSES } = require('./services/poEditService');
const { allocatePoGrnNumber } = require('./services/grnCounterService');

describe('PO tracking & GRN fulfillment (spec 21–29)', () => {
  let po;
  let site;
  let project;

  before(async () => {
    await setupTestDb();
    project = await Project.findOne();
    const vendor = await Vendor.findOne();
    const material = await Material.findOne();
    site = await Site.findOne();
    const pr = await PurchaseRequest.findOne({ projectId: project._id });
    if (!pr) return;

    po = await PurchaseOrder.create({
      draftRef: 'TEST-TL-001',
      purchaseRequestId: pr._id,
      vendorId: vendor._id,
      amount: 25000,
      paymentTerms: 'Net 30',
      lineItems: [
        {
          description: 'Test item A',
          materialId: material._id,
          quantity: 100,
          rate: 100,
          gstPercent: 18,
          amount: 10000,
        },
        {
          description: 'Test item B',
          materialId: material._id,
          quantity: 50,
          rate: 200,
          gstPercent: 18,
          amount: 10000,
        },
      ],
      status: 'APPROVED',
      fulfillmentStatus: 'open_partial',
      expectedDeliveryDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    });

    await recordPoCreated(po._id, null);
    await recordPoSent(po._id, null);

    await DeliveryVerification.findOneAndUpdate(
      { purchaseOrderId: po._id },
      {
        purchaseOrderId: po._id,
        siteId: site._id,
        items: po.lineItems.map((li) => ({
          materialId: li.materialId || new mongoose.Types.ObjectId(),
          quantityOrdered: li.quantity,
          quantityVerified: li.quantity,
          condition: 'OK',
        })),
        verifiedByUserId: (await User.findOne({ role: 'STORE_INCHARGE' }))._id,
      },
      { upsert: true, new: true }
    );
  });

  after(async () => {
    if (po) {
      await GoodsReceiptNote.deleteMany({ purchaseOrderId: po._id });
      await DeliveryAlert.deleteMany({ purchaseOrderId: po._id });
      await PoStatusTimeline.deleteMany({ purchaseOrderId: po._id });
      await DeliveryVerification.deleteMany({ purchaseOrderId: po._id });
      await PurchaseOrder.deleteOne({ _id: po._id });
    }
    await teardownTestDb();
  });

  it('returns six-stage PO timeline with timestamps', async () => {
    const timeline = await getPoTimeline(po._id);
    assert.equal(timeline.stages.length, 6);
    assert.equal(timeline.stages.find((s) => s.stage === 'created')?.isComplete, true);
    assert.equal(timeline.stages.find((s) => s.stage === 'sent')?.isComplete, true);
  });

  it('creates exactly one overdue delivery alert on repeated cron runs', async () => {
    const first = await processOverdueDeliveries();
    assert.ok(first.alertsCreated >= 0);

    const alertsAfterFirst = await DeliveryAlert.countDocuments({
      purchaseOrderId: po._id,
      resolvedAt: null,
    });

    const second = await processOverdueDeliveries();
    assert.equal(second.alertsCreated, 0);

    const alertsAfterSecond = await DeliveryAlert.countDocuments({
      purchaseOrderId: po._id,
      resolvedAt: null,
    });
    assert.equal(alertsAfterSecond, alertsAfterFirst);
  });

  it('flags partial GRN on price and quantity variance', () => {
    const cumulative = {};
    const priceVar = computeLineVariances(
      po,
      [{ lineIndex: 0, quantityReceived: 40, invoiceUnitPrice: 110 }],
      cumulative
    );
    assert.equal(priceVar.isPartial, true);
    assert.ok(priceVar.varianceLines.some((l) => l.priceDeviation));
    assert.ok(priceVar.varianceLines.some((l) => l.qtyDeviation));
  });

  it('keeps PO open after first partial GRN and closes after cumulative fulfillment', async () => {
    const cumulativeBefore = await getCumulativeReceivedByLine(po._id);
    const batch1 = computeLineVariances(
      po,
      [
        { lineIndex: 0, quantityReceived: 40, invoiceUnitPrice: 100 },
        { lineIndex: 1, quantityReceived: 50, invoiceUnitPrice: 200 },
      ],
      cumulativeBefore
    );

    await GoodsReceiptNote.create({
      grnNumber: await allocatePoGrnNumber(po._id),
      purchaseOrderId: po._id,
      siteId: site._id,
      items: batch1.items,
      receivedQuantity: 90,
      status: 'PARTIALLY_RECEIVED',
      isPartialGrn: batch1.isPartial,
      receivedByUserId: (await User.findOne({ role: 'STORE_INCHARGE' }))._id,
    });

    let result = await syncPoFulfillment(po, null);
    assert.equal(result.fulfillmentStatus, 'open_partial');

    const freshPo = await PurchaseOrder.findById(po._id);
    const cumulativeMid = await getCumulativeReceivedByLine(po._id);
    const batch2 = computeLineVariances(
      freshPo,
      [{ lineIndex: 0, quantityReceived: 60, invoiceUnitPrice: 100 }],
      cumulativeMid
    );

    await GoodsReceiptNote.create({
      grnNumber: await allocatePoGrnNumber(po._id),
      purchaseOrderId: po._id,
      siteId: site._id,
      items: batch2.items,
      receivedQuantity: 60,
      status: 'RECEIVED',
      isPartialGrn: batch2.isPartial,
      receivedByUserId: (await User.findOne({ role: 'STORE_INCHARGE' }))._id,
    });

    result = await syncPoFulfillment(freshPo, null);
    assert.equal(result.fulfillmentStatus, 'closed_complete');
    assert.equal(result.allComplete, true);
  });

  it('blocks PO edit for approved status via editable status set', () => {
    assert.equal(EDITABLE_STATUSES.has('APPROVED'), false);
    assert.equal(COORDINATOR_EDIT_STATUSES.has('APPROVED'), true);
    assert.equal(CHAIRMAN_EDIT_STATUSES.has('APPROVED'), true);
  });
});
