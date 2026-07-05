/**
 * Seed UAT transactional demo data WITHOUT wiping master catalog.
 * Safe to run after PO INDEX import (which clears procurement via clearProcurement).
 *
 * Usage: npm run seed:transactions
 */
require('dotenv').config();
const { connectMongo } = require('../db/connectMongo');
const { BEKEM_BUYER_ADDRESS } = require('../constants/bekemAddresses');
const {
  User,
  Project,
  Site,
  Material,
  Vendor,
  MaterialRequest,
  PurchaseRequest,
  PurchaseOrder,
  StatusHistory,
  Notification,
  WorkOrder,
  BranchTransfer,
  DeliveryVerification,
  GoodsReceiptNote,
  Incident,
} = require('../models');
const { USERS } = require('./seed');

const UAT_MR_PREFIX = 'IND/UAT-DEMO/';
const UAT_PO_PREFIX = 'PO-UAT-DEMO-';
const UAT_WO_PREFIX = 'WO-UAT-DEMO-';
const UAT_BT_PREFIX = 'BT/UAT-DEMO/';

async function resolveContext() {
  const userMap = {};
  for (const u of USERS) {
    const row = await User.findOne({ email: u.email });
    if (!row) throw new Error(`Demo user missing: ${u.email} — run npm run seed first`);
    userMap[u.role] = row;
  }

  const projects = await Project.find().sort({ createdAt: 1 }).limit(2);
  if (!projects.length) throw new Error('No projects in DB — run npm run seed or import:po-index');

  const project = projects[0];
  const project2 = projects[1] || projects[0];

  const site = await Site.findOne({ projectId: project._id }).sort({ createdAt: 1 });
  const site2 =
    (await Site.findOne({ projectId: project._id, _id: { $ne: site?._id } }).sort({ createdAt: 1 })) ||
    site;
  const siteMetro = await Site.findOne({ projectId: project2._id }).sort({ createdAt: 1 });

  if (!site || !siteMetro) {
    throw new Error('No sites found for demo projects');
  }

  const materials = await Material.find({ isActive: { $ne: false } }).sort({ createdAt: 1 }).limit(6);
  if (materials.length < 2) throw new Error('Need at least 2 materials in DB');

  const vendors = await Vendor.find({ isActive: { $ne: false } }).sort({ createdAt: 1 }).limit(3);
  if (!vendors.length) throw new Error('Need at least 1 vendor in DB');

  const cement = materials[0];
  const steel = materials[1];
  const bitumen = materials[2] || materials[0];
  const diesel = materials[3] || materials[1];

  return {
    userMap,
    project,
    project2,
    site,
    site2,
    siteMetro,
    vendors,
    cement,
    steel,
    bitumen,
    diesel,
  };
}

async function clearUatDemoRecords() {
  const mrIds = (
    await MaterialRequest.find({ indentNumber: { $regex: '^IND/UAT-DEMO/' } }).select('_id')
  ).map((r) => r._id);

  const poIds = (
    await PurchaseOrder.find({ poNumber: { $regex: '^PO-UAT-DEMO-' } }).select('_id')
  ).map((r) => r._id);

  const woIds = (
    await WorkOrder.find({ woNumber: { $regex: '^WO-UAT-DEMO-' } }).select('_id')
  ).map((r) => r._id);

  const btIds = (
    await BranchTransfer.find({ transferNumber: { $regex: '^BT/UAT-DEMO/' } }).select('_id')
  ).map((r) => r._id);

  await Promise.all([
    GoodsReceiptNote.deleteMany({ purchaseOrderId: { $in: poIds } }),
    DeliveryVerification.deleteMany({ purchaseOrderId: { $in: poIds } }),
    WorkOrder.deleteMany({ _id: { $in: woIds } }),
    WorkOrder.deleteMany({ purchaseOrderId: { $in: poIds } }),
    BranchTransfer.deleteMany({ _id: { $in: btIds } }),
    PurchaseOrder.deleteMany({ _id: { $in: poIds } }),
    PurchaseRequest.deleteMany({ materialRequestId: { $in: mrIds } }),
    PurchaseRequest.deleteMany({ prNumber: { $regex: '^PR/UAT-DEMO/' } }),
    MaterialRequest.deleteMany({ _id: { $in: mrIds } }),
    StatusHistory.deleteMany({
      $or: [
        { entityId: { $in: [...mrIds, ...poIds, ...woIds, ...btIds] } },
        { note: { $regex: 'UAT demo' } },
      ],
    }),
    Notification.deleteMany({ body: { $regex: 'UAT demo' } }),
    Incident.deleteMany({ incidentNumber: { $regex: '^INC/UAT-DEMO/' } }),
  ]);
}

async function seedTransactionalDemo({ force = false } = {}) {
  const existing = await PurchaseOrder.countDocuments({ poNumber: { $regex: '^PO-UAT-DEMO-' } });
  if (existing > 0 && !force) {
    return {
      skipped: true,
      summary: `${existing} UAT demo POs already present (use force:true to replace)`,
    };
  }

  const ctx = await resolveContext();
  await clearUatDemoRecords();

  const {
    userMap,
    project,
    project2,
    site,
    site2,
    siteMetro,
    vendors,
    cement,
    steel,
    bitumen,
    diesel,
  } = ctx;

  const siteUser = userMap.SITE_INCHARGE;
  const storeUser = userMap.STORE_INCHARGE;
  const pmUser = userMap.PROJECT_MANAGER;
  const execUser = userMap.EXECUTIVE;
  const coordUser = userMap.COORDINATOR;
  const chairmanUser = userMap.CHAIRMAN;

  const consigneeSite1 = `BEKEM INFRA PROJECTS PVT. LTD.
${site.name}
${site.chainageLabel || site.name}
Store Manager: ${storeUser.name}`;

  const consigneeMetro = `BEKEM INFRA PROJECTS PVT. LTD.
${siteMetro.name}
${siteMetro.chainageLabel || siteMetro.name}
Store Manager: ${storeUser.name}`;

  const mrPending = await MaterialRequest.create({
    indentNumber: `${UAT_MR_PREFIX}${project.code}/000001`,
    projectId: project._id,
    siteId: site._id,
    items: [{ materialId: cement._id, quantityRequested: 80, quantityAllocated: 0 }],
    materialId: cement._id,
    quantityRequested: 80,
    purpose: 'UAT demo — RCC culvert pour (pending store)',
    requiredByDate: new Date(Date.now() + 5 * 86400000),
    requestedByUserId: siteUser._id,
    status: 'PENDING_STORE',
    pendingWithRole: 'STORE_INCHARGE',
  });

  const mrWithPm = await MaterialRequest.create({
    indentNumber: `${UAT_MR_PREFIX}${project.code}/000002`,
    projectId: project._id,
    siteId: site._id,
    items: [
      { materialId: steel._id, quantityRequested: 12, quantityAllocated: 12 },
      { materialId: bitumen._id, quantityRequested: 25, quantityAllocated: 25 },
    ],
    materialId: steel._id,
    quantityRequested: 12,
    quantityAllocated: 12,
    purpose: 'UAT demo — DBM layer (forwarded to PM)',
    requiredByDate: new Date(Date.now() + 10 * 86400000),
    requestedByUserId: siteUser._id,
    status: 'FORWARDED_TO_PM',
    pendingWithRole: 'PROJECT_MANAGER',
    estimatedValue: 1850000,
  });

  const mrApproved = await MaterialRequest.create({
    indentNumber: `${UAT_MR_PREFIX}${project.code}/000003`,
    projectId: project._id,
    siteId: site._id,
    items: [{ materialId: diesel._id, quantityRequested: 5, quantityAllocated: 5 }],
    materialId: diesel._id,
    quantityRequested: 5,
    quantityAllocated: 5,
    purpose: 'UAT demo — fuel replenishment (PM approved)',
    requiredByDate: new Date(Date.now() + 3 * 86400000),
    requestedByUserId: siteUser._id,
    status: 'PM_APPROVED',
    pendingWithRole: 'EXECUTIVE',
    estimatedValue: 425000,
  });

  const prApproved = await PurchaseRequest.create({
    prNumber: 'PR/UAT-DEMO/0001',
    materialRequestId: mrApproved._id,
    projectId: project._id,
    status: 'APPROVED',
    createdByUserId: pmUser._id,
    amountEstimate: 425000,
  });

  const poPendingCoord = await PurchaseOrder.create({
    poNumber: `${UAT_PO_PREFIX}COORD`,
    purchaseRequestId: prApproved._id,
    vendorId: vendors[Math.min(2, vendors.length - 1)]._id,
    amount: 425000,
    paymentTerms: 'Net 30 days',
    billingAddress: BEKEM_BUYER_ADDRESS,
    deliveryAddress: consigneeSite1,
    lineItems: [
      {
        description: 'UAT demo — Diesel HSD 5 KL',
        materialId: diesel._id,
        hsnCode: diesel.hsnCode || '27101920',
        quantity: 5,
        rate: 72000,
        gstPercent: 18,
        amount: 425000,
      },
    ],
    status: 'COORDINATOR_PENDING',
  });

  const prChairman = await PurchaseRequest.create({
    prNumber: 'PR/UAT-DEMO/0004',
    materialRequestId: mrWithPm._id,
    projectId: project._id,
    status: 'APPROVED',
    createdByUserId: pmUser._id,
    amountEstimate: 1850000,
  });

  const poChairmanPending = await PurchaseOrder.create({
    poNumber: `${UAT_PO_PREFIX}CHAIRMAN`,
    procurementRef: 'BEKEM-PRJ00/SIB/0001/25-26',
    poSeq: 1,
    vendorPoSeq: 1,
    financialYear: '25-26',
    purchaseRequestId: prChairman._id,
    vendorId: vendors[Math.min(1, vendors.length - 1)]._id,
    amount: 1850000,
    paymentTerms: 'Net 45 days',
    billingAddress: BEKEM_BUYER_ADDRESS,
    deliveryAddress: consigneeSite1,
    lineItems: [
      {
        description: 'UAT demo — Bitumen + steel bundle',
        materialId: bitumen._id,
        hsnCode: bitumen.hsnCode || '27132000',
        quantity: 37,
        rate: 50000,
        gstPercent: 18,
        amount: 1850000,
      },
    ],
    status: 'CHAIRMAN_PENDING',
    coordinatorVerifiedByUserId: coordUser._id,
    coordinatorVerifiedAt: new Date(),
  });

  const poApproved = await PurchaseOrder.create({
    poNumber: `${UAT_PO_PREFIX}APPROVED`,
    procurementRef: 'BEKEM-PRJ00/SIB/0002/25-26',
    poSeq: 2,
    vendorPoSeq: 1,
    financialYear: '25-26',
    purchaseRequestId: prApproved._id,
    vendorId: vendors[0]._id,
    amount: 2400000,
    paymentTerms: '30% advance, balance on delivery',
    billingAddress: BEKEM_BUYER_ADDRESS,
    deliveryAddress: consigneeMetro,
    lineItems: [
      {
        description: 'UAT demo — crash barrier package',
        materialId: steel._id,
        hsnCode: steel.hsnCode || '72142090',
        quantity: 1,
        rate: 2400000,
        gstPercent: 18,
        amount: 2400000,
      },
    ],
    status: 'APPROVED',
    emailStatus: 'queued',
    approvalDispatchedAt: new Date(),
    finalApprovedAt: new Date(Date.now() - 3 * 86400000),
    approvedByUserId: chairmanUser._id,
    fulfillmentStatus: 'open_partial',
  });

  const prGrnDemo = await PurchaseRequest.create({
    prNumber: 'PR/UAT-DEMO/0002',
    materialRequestId: mrApproved._id,
    projectId: project._id,
    status: 'APPROVED',
    createdByUserId: pmUser._id,
    amountEstimate: 85000,
  });

  const poGrnReady = await PurchaseOrder.create({
    poNumber: `${UAT_PO_PREFIX}GRN-READY`,
    procurementRef: 'BEKEM-PRJ00/SGH/0003/25-26',
    poSeq: 3,
    vendorPoSeq: 1,
    financialYear: '25-26',
    purchaseRequestId: prGrnDemo._id,
    vendorId: vendors[0]._id,
    amount: 85000,
    paymentTerms: 'Net 30 days',
    billingAddress: BEKEM_BUYER_ADDRESS,
    deliveryAddress: consigneeSite1,
    lineItems: [
      {
        description: 'UAT demo — TMT steel 10 MT',
        materialId: steel._id,
        hsnCode: steel.hsnCode || '72142090',
        quantity: 10,
        rate: 8500,
        gstPercent: 18,
        amount: 85000,
      },
    ],
    status: 'APPROVED',
    emailStatus: 'queued',
    approvalDispatchedAt: new Date(),
    finalApprovedAt: new Date(Date.now() - 1 * 86400000),
    approvedByUserId: chairmanUser._id,
    fulfillmentStatus: 'open_partial',
    expectedDeliveryDate: new Date(Date.now() - 2 * 86400000),
  });

  await DeliveryVerification.create({
    purchaseOrderId: poGrnReady._id,
    siteId: site._id,
    items: [{ materialId: steel._id, quantityOrdered: 10, quantityVerified: 10, condition: 'OK' }],
    remarks: 'UAT demo: delivery verified — ready for GRN',
    verifiedByUserId: storeUser._id,
  });

  const prWo = await PurchaseRequest.create({
    prNumber: 'PR/UAT-DEMO/0003',
    projectId: project2._id,
    status: 'APPROVED',
    createdByUserId: execUser._id,
    amountEstimate: 1200000,
  });

  const poWoBase = await PurchaseOrder.create({
    poNumber: `${UAT_PO_PREFIX}WO-BASE`,
    procurementRef: 'BEKEM-PRJ00/CST/0004/25-26',
    poSeq: 4,
    vendorPoSeq: 1,
    financialYear: '25-26',
    purchaseRequestId: prWo._id,
    vendorId: vendors[Math.min(1, vendors.length - 1)]._id,
    amount: 1200000,
    paymentTerms: 'Net 45 days',
    billingAddress: BEKEM_BUYER_ADDRESS,
    deliveryAddress: consigneeMetro,
    lineItems: [
      {
        description: 'UAT demo — waterproofing works',
        materialId: bitumen._id,
        hsnCode: bitumen.hsnCode || '27132000',
        quantity: 20,
        rate: 60000,
        gstPercent: 18,
        amount: 1200000,
      },
    ],
    status: 'APPROVED',
    emailStatus: 'queued',
    approvalDispatchedAt: new Date(),
    finalApprovedAt: new Date(),
    approvedByUserId: chairmanUser._id,
  });

  const woInProgress = await WorkOrder.create({
    woNumber: `${UAT_WO_PREFIX}IN-PROGRESS`,
    purchaseOrderId: poApproved._id,
    projectId: project2._id,
    siteId: siteMetro._id,
    vendorId: vendors[0]._id,
    scope: 'UAT demo — crash barrier installation (in progress)',
    totalQuantity: 1200,
    quantityUnit: 'Mtr',
    completedQuantity: 480,
    progressPercent: 40,
    contractValue: 2400000,
    status: 'IN_PROGRESS',
    createdByUserId: execUser._id,
    milestones: [
      { name: 'Survey', status: 'COMPLETED', order: 1 },
      { name: 'Installation', status: 'RUNNING', order: 2 },
      { name: 'Testing', status: 'PENDING', order: 3 },
    ],
  });

  const woCoordPending = await WorkOrder.create({
    woNumber: `${UAT_WO_PREFIX}COORD`,
    purchaseOrderId: poPendingCoord._id,
    projectId: project._id,
    siteId: site._id,
    vendorId: vendors[Math.min(2, vendors.length - 1)]._id,
    scope: 'UAT demo — diesel supply contract',
    totalQuantity: 5,
    quantityUnit: 'KL',
    contractValue: 425000,
    status: 'COORDINATOR_PENDING',
    createdByUserId: execUser._id,
  });

  const woChairmanPending = await WorkOrder.create({
    woNumber: `${UAT_WO_PREFIX}CHAIRMAN`,
    purchaseOrderId: poWoBase._id,
    projectId: project2._id,
    siteId: siteMetro._id,
    vendorId: vendors[Math.min(1, vendors.length - 1)]._id,
    scope: 'UAT demo — waterproofing (chairman pending)',
    totalQuantity: 2000,
    quantityUnit: 'Sqm',
    contractValue: 1200000,
    status: 'CHAIRMAN_PENDING',
    createdByUserId: execUser._id,
    coordinatorVerifiedByUserId: coordUser._id,
    coordinatorVerifiedAt: new Date(),
  });

  const btRequested = await BranchTransfer.create({
    transferNumber: `${UAT_BT_PREFIX}0001`,
    fromProjectId: project2._id,
    fromSiteId: siteMetro._id,
    toProjectId: project._id,
    toSiteId: site._id,
    items: [{ materialId: steel._id, quantity: 50 }],
    status: 'REQUESTED',
    note: 'UAT demo: steel transfer — awaiting destination PM',
    requestedByUserId: storeUser._id,
  });

  const btPmApproved = await BranchTransfer.create({
    transferNumber: `${UAT_BT_PREFIX}0002`,
    fromProjectId: project._id,
    fromSiteId: site2._id,
    toProjectId: project2._id,
    toSiteId: siteMetro._id,
    items: [{ materialId: cement._id, quantity: 120 }],
    status: 'PM_APPROVED',
    note: 'UAT demo: cement transfer — awaiting coordinator',
    requestedByUserId: storeUser._id,
    pmApprovedByUserId: pmUser._id,
    pmApprovedAt: new Date(Date.now() - 1 * 86400000),
  });

  await Incident.create({
    incidentNumber: 'INC/UAT-DEMO/0001',
    projectId: project._id,
    siteId: site._id,
    type: 'SAFETY',
    severity: 'HIGH',
    title: 'UAT demo — worker slip near batching plant',
    description: 'Demo incident for UAT walk.',
    status: 'OPEN',
    reportedByUserId: siteUser._id,
  });

  const notifications = [
    {
      userId: storeUser._id,
      title: 'New indent pending',
      body: `UAT demo: ${mrPending.indentNumber} awaits store allocation.`,
      relatedEntityType: 'MaterialRequest',
      relatedEntityId: mrPending._id,
      isRead: false,
    },
    {
      userId: pmUser._id,
      title: 'Indent forwarded',
      body: `UAT demo: ${mrWithPm.indentNumber} needs PM approval.`,
      relatedEntityType: 'MaterialRequest',
      relatedEntityId: mrWithPm._id,
      isRead: false,
    },
    {
      userId: coordUser._id,
      title: 'PO verification',
      body: `UAT demo: ${poPendingCoord.poNumber} requires coordinator review.`,
      relatedEntityType: 'PurchaseOrder',
      relatedEntityId: poPendingCoord._id,
      isRead: false,
    },
    {
      userId: chairmanUser._id,
      title: 'PO awaiting final approval',
      body: `UAT demo: ${poChairmanPending.poNumber} needs Chairman sign-off.`,
      relatedEntityType: 'PurchaseOrder',
      relatedEntityId: poChairmanPending._id,
      isRead: false,
    },
    {
      userId: chairmanUser._id,
      title: 'WO awaiting approval',
      body: `UAT demo: ${woChairmanPending.woNumber} needs Chairman sign-off.`,
      relatedEntityType: 'WorkOrder',
      relatedEntityId: woChairmanPending._id,
      isRead: false,
    },
    {
      userId: storeUser._id,
      title: 'GRN ready',
      body: `UAT demo: ${poGrnReady.poNumber} delivered and verified — record receipt.`,
      relatedEntityType: 'PurchaseOrder',
      relatedEntityId: poGrnReady._id,
      isRead: false,
    },
  ];

  for (const n of notifications) {
    await Notification.create(n);
  }

  await StatusHistory.create({
    entityType: 'MaterialRequest',
    entityId: mrPending._id,
    fromStatus: null,
    toStatus: 'PENDING_STORE',
    actorUserId: siteUser._id,
    note: 'UAT demo indent submitted',
  });

  const counts = {
    materialRequests: await MaterialRequest.countDocuments({ indentNumber: { $regex: '^IND/UAT-DEMO/' } }),
    purchaseOrders: await PurchaseOrder.countDocuments({ poNumber: { $regex: '^PO-UAT-DEMO-' } }),
    workOrders: await WorkOrder.countDocuments({ woNumber: { $regex: '^WO-UAT-DEMO-' } }),
    branchTransfers: await BranchTransfer.countDocuments({ transferNumber: { $regex: '^BT/UAT-DEMO/' } }),
    deliveryVerifications: await DeliveryVerification.countDocuments({ purchaseOrderId: poGrnReady._id }),
    notifications: notifications.length,
  };

  return {
    skipped: false,
    counts,
    summary: `${counts.materialRequests} indents, ${counts.purchaseOrders} POs (${poChairmanPending.poNumber} chairman-pending, ${poApproved.poNumber} approved w/ email queued), ${counts.workOrders} WOs, ${counts.branchTransfers} BTs, 1 GRN-ready PO`,
    ids: {
      poChairmanPending: poChairmanPending._id.toString(),
      poApproved: poApproved._id.toString(),
      poGrnReady: poGrnReady._id.toString(),
      woChairmanPending: woChairmanPending._id.toString(),
    },
  };
}

async function main() {
  await connectMongo();
  console.log('Connected — seeding UAT transactional demo…');
  const result = await seedTransactionalDemo({ force: true });
  console.log(`✅ ${result.summary}`);
  const mongoose = require('mongoose');
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('seedTransactionalDemo failed:', err.message);
    process.exit(1);
  });
}

module.exports = { seedTransactionalDemo, UAT_PO_PREFIX, UAT_MR_PREFIX };
