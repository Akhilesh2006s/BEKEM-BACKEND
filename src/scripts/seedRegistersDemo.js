/**
 * Seed realistic demo data for Registers + Stock aging:
 * Inward (GRNs) · Outward (Issues) · Stock balance · Stock aging batches
 *
 * Idempotent — clears previous REG-DEMO-* documents first.
 *
 * Usage: npm run seed:registers -w @afios/api
 *    or: node src/scripts/seedRegistersDemo.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { connectMongo } = require('../db/connectMongo');
const {
  Site,
  Project,
  User,
  Material,
  Vendor,
  PurchaseRequest,
  PurchaseOrder,
  GoodsReceiptNote,
  MaterialIssue,
  MaterialRequest,
  StockBatch,
  StockLedger,
  StockMovement,
} = require('../models');

const TAG = 'REG-DEMO';

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(10, 30, 0, 0);
  return d;
}

function pick(list, idx) {
  return list[idx % list.length];
}

async function clearPrevious(siteId) {
  const demoMrs = await MaterialRequest.find({ indentNumber: new RegExp(`^${TAG}`) }).select('_id');
  const mrIds = demoMrs.map((m) => m._id);

  const demoGrns = await GoodsReceiptNote.find({ note: new RegExp(TAG) }).select('_id items');
  const grnIds = demoGrns.map((g) => g._id);

  // Reverse ledger impact from prior demo GRNs / issues before delete
  for (const grn of demoGrns) {
    for (const item of grn.items || []) {
      await StockLedger.updateOne(
        { siteId, materialId: item.materialId },
        { $inc: { quantityOnHand: -(item.quantityReceived || 0) } }
      );
    }
  }
  const demoIssues = await MaterialIssue.find({
    $or: [{ issueNumber: new RegExp(`^${TAG}`) }, { note: new RegExp(TAG) }],
  }).select('items');
  for (const issue of demoIssues) {
    for (const item of issue.items || []) {
      await StockLedger.updateOne(
        { siteId, materialId: item.materialId },
        { $inc: { quantityOnHand: item.quantity || 0 } }
      );
    }
  }

  await StockMovement.deleteMany({
    siteId,
    materialRequestId: { $in: mrIds },
  });
  // Also remove orphan INCOMING demo movements tied to demo GRN materials via note tag on issues only —
  // INCOMING movements used demo MR ids above when re-seeded.

  await StockBatch.deleteMany({ grnId: { $in: grnIds } });
  await GoodsReceiptNote.deleteMany({ note: new RegExp(TAG) });
  await MaterialIssue.deleteMany({ note: new RegExp(TAG) });
  await PurchaseOrder.deleteMany({
    $or: [
      { draftRef: new RegExp(`^${TAG}`) },
      { poNumber: { $in: [
        'BEKEM-AMR/SRE/9105/26-27',
        'BEKEM-AMR/ELE/9106/26-27',
        'BEKEM-AMR/MEC/9107/26-27',
        'BEKEM-AMR/CIV/9108/26-27',
      ] } },
    ],
  });
  await PurchaseRequest.deleteMany({ prNumber: new RegExp(`^${TAG}`) });
  await MaterialRequest.deleteMany({ _id: { $in: mrIds } });

  // Floor any drifted negative ledgers
  await StockLedger.updateMany(
    { siteId, quantityOnHand: { $lt: 0 } },
    { $set: { quantityOnHand: 0 } }
  );

  console.log(`Cleared previous ${TAG} demo docs`);
}

async function upsertLedger(siteId, projectId, materialId, delta, at) {
  let ledger = await StockLedger.findOne({ siteId, materialId });
  if (!ledger) {
    ledger = await StockLedger.create({
      siteId,
      projectId,
      materialId,
      quantityOnHand: 0,
      lowStockThreshold: 10,
    });
  }
  ledger.quantityOnHand = Math.max(0, (ledger.quantityOnHand || 0) + delta);
  ledger.lastMovementAt = at;
  await ledger.save();
}

async function main() {
  console.log('Connecting…');
  await connectMongo();

  const storeUser =
    (await User.findOne({ email: 'storeincharge@bekem.com' })) ||
    (await User.findOne({ role: 'STORE_INCHARGE' }));
  if (!storeUser) throw new Error('No STORE_INCHARGE user found. Run seed first.');

  let site = storeUser.assignedSiteId ? await Site.findById(storeUser.assignedSiteId) : null;
  if (!site) {
    site =
      (await Site.findOne({ name: /Main Store|AMR/i })) ||
      (await Site.findOne({}).sort({ createdAt: 1 }));
  }
  if (!site) throw new Error('No Site found.');

  const project =
    (await Project.findById(site.projectId)) ||
    (await Project.findOne({ name: /AMR/i })) ||
    (await Project.findOne({}));
  if (!project) throw new Error('No Project found.');

  console.log(`Using site="${site.name}" project="${project.name}"`);

  await clearPrevious(site._id);

  const vendors = await Vendor.find({ isActive: { $ne: false } }).limit(5);
  if (!vendors.length) throw new Error('No vendors found.');

  let materials = await Material.find({ isActive: { $ne: false } }).sort({ code: 1 }).limit(12).lean();
  if (materials.length < 6) {
    materials = await Material.find().sort({ code: 1 }).limit(12).lean();
  }
  if (materials.length < 4) throw new Error('Need at least 4 materials in catalog.');

  const siteUser =
    (await User.findOne({ email: 'request@bekem.com' })) ||
    (await User.findOne({ role: 'SITE_INCHARGE' }));
  const actorId = storeUser._id;
  const requesterId = siteUser?._id || actorId;

  // ---- Completed indents (for outward indent numbers) ----
  const mrSpecs = [
    { suffix: '0141', purpose: 'Tower foundation work — Package A', items: [0, 1] },
    { suffix: '0142', purpose: 'Panel room fit-out', items: [2, 3] },
    { suffix: '0143', purpose: 'Contractor erection — Span 12', items: [4] },
    { suffix: '0144', purpose: 'Emergency replacement — Control cables', items: [1, 5] },
  ];

  const demoMrs = [];
  for (const spec of mrSpecs) {
    const items = spec.items.map((idx) => ({
      materialId: pick(materials, idx)._id,
      quantityRequested: [20, 50, 15, 40, 10, 25][idx % 6],
      unit: pick(materials, idx).unit || 'Nos',
      quantityAllocated: 0,
      quantityIssued: 0,
    }));
    const mr = await MaterialRequest.create({
      indentNumber: `${TAG}/IND/AMR/26-27/${spec.suffix}`,
      projectId: project._id,
      siteId: site._id,
      requestedByUserId: requesterId,
      requestedByName: siteUser?.name || 'Site Indenter',
      purpose: `${spec.purpose} [${TAG}]`,
      status: 'COMPLETED',
      indentRequestType: 'ABOVE_5000',
      items,
      pendingWithRole: null,
    });
    demoMrs.push(mr);
  }

  // ---- Approved POs ----
  const poSpecs = [
    {
      suffix: '01',
      vendor: vendors[0],
      mats: [0, 1, 2],
      qtys: [80, 120, 60],
      rates: [420, 185, 95],
      daysAgo: 95,
      poNo: `BEKEM-AMR/SRE/9105/26-27`,
    },
    {
      suffix: '02',
      vendor: vendors[1] || vendors[0],
      mats: [3, 4],
      qtys: [200, 40],
      rates: [8.5, 1250],
      daysAgo: 55,
      poNo: `BEKEM-AMR/ELE/9106/26-27`,
    },
    {
      suffix: '03',
      vendor: vendors[2] || vendors[0],
      mats: [5, 0, 1],
      qtys: [30, 50, 75],
      rates: [2400, 410, 190],
      daysAgo: 28,
      poNo: `BEKEM-AMR/MEC/9107/26-27`,
    },
    {
      suffix: '04',
      vendor: vendors[3] || vendors[0],
      mats: [2, 3],
      qtys: [90, 150],
      rates: [110, 9.2],
      daysAgo: 12,
      poNo: `BEKEM-AMR/CIV/9108/26-27`,
    },
  ];

  const demoPos = [];
  for (const spec of poSpecs) {
    const lineItems = spec.mats.map((mi, i) => {
      const mat = pick(materials, mi);
      const qty = spec.qtys[i];
      const rate = spec.rates[i];
      return {
        description: mat.name,
        materialId: mat._id,
        itemCode: mat.code,
        hsnCode: mat.hsnCode || '85444999',
        quantity: qty,
        rate,
        gstPercent: mat.gstRate ?? 18,
        amount: Math.round(qty * rate * 100) / 100,
      };
    });
    const amount = lineItems.reduce((s, l) => s + l.amount, 0);

    const pr = await PurchaseRequest.create({
      prNumber: `${TAG}-PR-${spec.suffix}`,
      materialRequestId: demoMrs[0]._id,
      projectId: project._id,
      status: 'OPEN',
      createdByUserId: actorId,
      amountEstimate: amount,
    });

    const po = await PurchaseOrder.create({
      poNumber: spec.poNo,
      draftRef: `${TAG}-DRAFT-${spec.suffix}`,
      purchaseRequestId: pr._id,
      vendorId: spec.vendor._id,
      amount,
      paymentTerms: 'Net 30 days',
      billingAddress: 'BEKEM INFRA PROJECTS PVT. LTD.',
      deliveryAddress: `${site.name}\n${site.chainageLabel || ''}`,
      lineItems,
      status: 'APPROVED',
      finalApprovedAt: daysAgo(spec.daysAgo),
      fulfillmentStatus: 'open_partial',
      financialYear: '26-27',
    });
    demoPos.push({ po, spec, lineItems });
  }

  // ---- Inward GRNs + FIFO batches + INCOMING movements ----
  const grnSpecs = [
    {
      suffix: '9103',
      poIdx: 0,
      status: 'RECEIVED',
      daysAgo: 92,
      receiveRatio: 1,
      invoiceNo: 'INV-ELE-7841',
      challanNo: 'CH-4412',
    },
    {
      suffix: '9104',
      poIdx: 1,
      status: 'RECEIVED',
      daysAgo: 52,
      receiveRatio: 1,
      invoiceNo: 'INV-MEC-2290',
      challanNo: 'CH-5521',
    },
    {
      suffix: '9105',
      poIdx: 2,
      status: 'PARTIALLY_RECEIVED',
      daysAgo: 26,
      receiveRatio: 0.65,
      invoiceNo: 'INV-CIV-1188',
      challanNo: 'CH-6610',
    },
    {
      suffix: '9106',
      poIdx: 3,
      status: 'RECEIVED',
      daysAgo: 11,
      receiveRatio: 1,
      invoiceNo: 'INV-GEN-3344',
      challanNo: 'CH-7701',
    },
    {
      suffix: '9107',
      poIdx: 1,
      status: 'PARTIALLY_RECEIVED',
      daysAgo: 4,
      receiveRatio: 0.4,
      invoiceNo: 'INV-MEC-2291',
      challanNo: 'CH-7788',
    },
    {
      suffix: '9108',
      poIdx: 0,
      status: 'RECEIVED',
      daysAgo: 68,
      receiveRatio: 0.5,
      invoiceNo: 'INV-ELE-7842',
      challanNo: 'CH-4490',
    },
  ];

  const DEMO_GRN_NUMBERS = grnSpecs.map((g) => `GRN-${g.suffix}`);

  let grnCreated = 0;
  for (const g of grnSpecs) {
    const { po, lineItems, spec } = demoPos[g.poIdx];
    const indent = demoMrs[g.poIdx % demoMrs.length];
    const items = lineItems.map((li) => {
      const qtyOrdered = li.quantity;
      const qtyRecv = Math.max(1, Math.round(qtyOrdered * g.receiveRatio));
      return {
        materialId: li.materialId,
        quantityOrdered: qtyOrdered,
        quantityReceived: qtyRecv,
        orderedUnitPrice: li.rate,
        invoiceUnitPrice: li.rate,
        qtyVariance: qtyRecv - qtyOrdered,
        priceVariance: 0,
        lineStatus: qtyRecv >= qtyOrdered ? 'RECEIVED' : 'PARTIAL',
      };
    });
    const receivedQuantity = items.reduce((s, i) => s + i.quantityReceived, 0);
    const receivedAt = daysAgo(g.daysAgo);

    const grn = await GoodsReceiptNote.create({
      grnNumber: `GRN-${g.suffix}`,
      purchaseOrderId: po._id,
      poNumber: po.poNumber || '',
      indentNumber: indent.indentNumber.replace(`${TAG}/`, ''),
      vendorId: spec.vendor._id,
      vendorName: spec.vendor.name,
      siteId: site._id,
      items,
      receivedQuantity,
      status: g.status,
      approvalStage: 'APPROVED',
      receiveType: g.receiveRatio >= 1 ? 'FULL' : 'PARTIAL',
      isPartialGrn: g.receiveRatio < 1,
      invoiceNo: g.invoiceNo,
      invoiceDate: receivedAt,
      invoiceValue: items.reduce((s, i) => s + i.quantityReceived * i.invoiceUnitPrice, 0),
      challanNo: g.challanNo,
      vehicleNo: `KA-${10 + Number(g.suffix)}-${1000 + Number(g.suffix) * 11}`,
      deliveryDate: receivedAt,
      note: `${TAG} demo inward receipt`,
      receivedAt,
      receivedByUserId: actorId,
      approvedAt: receivedAt,
      approvedByUserId: actorId,
    });

    for (const item of items) {
      await StockBatch.create({
        siteId: site._id,
        materialId: item.materialId,
        grnId: grn._id,
        grnNumber: grn.grnNumber,
        receivedAt,
        qtyReceived: item.quantityReceived,
        qtyRemaining: item.quantityReceived,
      });
      await StockMovement.create({
        siteId: site._id,
        materialId: item.materialId,
        materialRequestId: indent._id,
        quantityDelta: item.quantityReceived,
        type: 'INCOMING',
        actorUserId: actorId,
        timestamp: receivedAt,
      });
      await upsertLedger(site._id, project._id, item.materialId, item.quantityReceived, receivedAt);
    }
    grnCreated += 1;
  }
  console.log(`Created ${grnCreated} GRNs + batches + inward movements`);

  // ---- Outward issues + FIFO consume + ALLOCATION movements ----
  const issueSpecs = [
    {
      suffix: '9112',
      mrIdx: 0,
      type: 'WORK_ISSUE',
      toType: 'EMPLOYEE',
      toName: 'Ramesh — Tower Gang A',
      daysAgo: 40,
      mats: [
        { mi: 0, qty: 25 },
        { mi: 1, qty: 40 },
      ],
      reason: 'already_approved',
    },
    {
      suffix: '9113',
      mrIdx: 1,
      type: 'WORK_ISSUE',
      toType: 'EMPLOYEE',
      toName: 'Srinivas — Electrical Team',
      daysAgo: 22,
      mats: [
        { mi: 2, qty: 18 },
        { mi: 3, qty: 35 },
      ],
      reason: 'urgent_work',
    },
    {
      suffix: '9114',
      mrIdx: 2,
      type: 'CONTRACT_ISSUE',
      toType: 'CONTRACTOR',
      toName: 'Sri Venkateswara Erection Works',
      daysAgo: 14,
      mats: [{ mi: 4, qty: 12 }],
      reason: 'already_approved',
    },
    {
      suffix: '9115',
      mrIdx: 3,
      type: 'WORK_ISSUE',
      toType: 'EMPLOYEE',
      toName: 'Naresh — Emergency Crew',
      daysAgo: 6,
      mats: [
        { mi: 1, qty: 10 },
        { mi: 5, qty: 8 },
      ],
      reason: 'emergency',
    },
    {
      suffix: '9116',
      mrIdx: 0,
      type: 'CONTRACT_ISSUE',
      toType: 'CONTRACTOR',
      toName: 'Lakshmi Infra Spans',
      daysAgo: 2,
      mats: [
        { mi: 0, qty: 15 },
        { mi: 2, qty: 20 },
      ],
      reason: 'urgent_work',
    },
  ];

  let issueCreated = 0;
  for (const spec of issueSpecs) {
    const mr = demoMrs[spec.mrIdx];
    const issuedAt = daysAgo(spec.daysAgo);
    const items = [];

    for (const line of spec.mats) {
      const mat = pick(materials, line.mi);
      items.push({ materialId: mat._id, quantity: line.qty });

      let remaining = line.qty;
      const batches = await StockBatch.find({
        siteId: site._id,
        materialId: mat._id,
        qtyRemaining: { $gt: 0 },
        grnNumber: { $in: DEMO_GRN_NUMBERS },
      }).sort({ receivedAt: 1 });
      for (const batch of batches) {
        if (remaining <= 0) break;
        const take = Math.min(batch.qtyRemaining, remaining);
        batch.qtyRemaining -= take;
        remaining -= take;
        await batch.save();
      }

      await StockMovement.create({
        siteId: site._id,
        materialId: mat._id,
        materialRequestId: mr._id,
        quantityDelta: -line.qty,
        type: 'ALLOCATION',
        actorUserId: actorId,
        timestamp: issuedAt,
      });
      await upsertLedger(site._id, project._id, mat._id, -line.qty, issuedAt);
    }

    await MaterialIssue.create({
      issueNumber: `ISS-AMR-${spec.suffix}`,
      materialRequestId: mr._id,
      siteId: site._id,
      items,
      issuedByUserId: actorId,
      status: 'ISSUED',
      issueReason: spec.reason,
      issueType: spec.type,
      issuedToType: spec.toType,
      issuedToName: spec.toName,
      issuedAt,
      note: `${TAG} demo outward issue`,
      attachments:
        spec.type === 'CONTRACT_ISSUE'
          ? [{ name: 'contractor-ack.pdf', fileType: 'application/pdf', category: 'CONTRACTOR_ACK' }]
          : [{ name: 'issue-slip.pdf', fileType: 'application/pdf', category: 'ISSUE_SLIP' }],
    });
    issueCreated += 1;
  }
  console.log(`Created ${issueCreated} material issues + outward movements`);

  // Also backfill empty vendor/indent on existing (non-demo) GRNs so Inward looks complete
  const emptyGrns = await GoodsReceiptNote.find({
    siteId: site._id,
    grnNumber: { $not: new RegExp(`^${TAG}`) },
    $or: [{ vendorName: { $in: [null, ''] } }, { indentNumber: { $in: [null, ''] } }],
  })
    .populate('vendorId')
    .limit(20);

  let patched = 0;
  for (const grn of emptyGrns) {
    const updates = {};
    if (!grn.vendorName) {
      updates.vendorName = grn.vendorId?.name || vendors[0].name;
    }
    if (!grn.indentNumber) {
      updates.indentNumber = `IND/AMR/26-27/${9000 + patched}`;
    }
    if (Object.keys(updates).length) {
      await GoodsReceiptNote.updateOne({ _id: grn._id }, { $set: updates });
      patched += 1;
    }
  }
  if (patched) console.log(`Patched ${patched} existing GRN vendor/indent blanks`);

  const grnCount = await GoodsReceiptNote.countDocuments({ note: new RegExp(TAG) });
  const issueCount = await MaterialIssue.countDocuments({ note: new RegExp(TAG) });
  const aged = await StockBatch.countDocuments({
    siteId: site._id,
    grnNumber: { $in: DEMO_GRN_NUMBERS },
    qtyRemaining: { $gt: 0 },
  });

  console.log('\nRegisters demo ready');
  console.log(`  Inward GRNs:    ${grnCount}`);
  console.log(`  Outward issues: ${issueCount}`);
  console.log(`  Aging batches:  ${aged} with remaining qty`);
  console.log(`  Site:           ${site.name}`);
  console.log('  Check: Registers (Inward / Outward / Stock) + Stock aging\n');

  await require('mongoose').disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
