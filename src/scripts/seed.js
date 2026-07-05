require('dotenv').config();
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { connectMongo } = require('../db/connectMongo');
const { BEKEM_BUYER_ADDRESS, BEKEM_BUYER_GST, BEKEM_WORKSHOP_ADDRESS, BEKEM_GLOBAL_WAREHOUSE_ADDRESS } = require('../constants/bekemAddresses');
const { ensureDefaultAddresses } = require('../services/addressBootstrapService');
const {
  User,
  Project,
  Site,
  Material,
  StockLedger,
  Vendor,
  MaterialRequest,
  PurchaseRequest,
  PurchaseOrder,
  RFQ,
  Quotation,
  StatusHistory,
  Notification,
  AuditLog,
  StockMovement,
  WorkOrder,
  Incident,
  Address,
  BranchTransfer,
  DeliveryVerification,
  GoodsReceiptNote,
  IdempotencyRecord,
} = require('../models');

const DEMO_PASSWORD = 'Bekem@Demo2026!';
const BEKEM_BLUE = '#1A4FA0';

const USERS = [
  { name: 'Ravi Kumar', email: 'request@bekem.com', role: 'SITE_INCHARGE', avatarColor: '#1A4FA0' },
  { name: 'Suresh Patel', email: 'storeincharge@bekem.com', role: 'STORE_INCHARGE', avatarColor: '#2563EB' },
  { name: 'Priya Sharma', email: 'pm@bekem.com', role: 'PROJECT_MANAGER', avatarColor: '#1E5BB8' },
  { name: 'Anil Mehta', email: 'executive@bekem.com', role: 'EXECUTIVE', avatarColor: '#153E7A' },
  { name: 'Neha Gupta', email: 'coordinator@bekem.com', role: 'COORDINATOR', avatarColor: '#0D9488' },
  { name: 'Rajesh Bekem', email: 'chairman@bekem.com', role: 'CHAIRMAN', avatarColor: '#1E3A5F' },
];

const MATERIALS = [
  {
    code: 'MAT-BITUMEN-VG30',
    name: 'Bitumen VG-30',
    unit: 'MT',
    grade: 'VG-30',
    category: 'Paving',
    hsnCode: '27132000',
    description: 'Penetration grade bitumen for highway surfacing',
  },
  {
    code: 'MAT-CEMENT-OPC53',
    name: 'Cement OPC 53',
    unit: 'Bags',
    grade: 'OPC 53',
    category: 'Cement',
    hsnCode: '25232930',
    description: 'Ordinary Portland Cement 53 grade — IS 12269',
  },
  {
    code: 'MAT-STEEL-12MM',
    name: 'TMT Steel 12mm',
    unit: 'MT',
    grade: 'Fe 500D',
    category: 'Steel',
    hsnCode: '72142090',
    description: 'Thermo-mechanically treated bars for RCC',
  },
  {
    code: 'MAT-AGG-20MM',
    name: 'Coarse Aggregate 20mm',
    unit: 'MT',
    grade: '20mm',
    category: 'Aggregates',
    hsnCode: '25171010',
    description: 'Crushed stone aggregate for DBM and WMM',
  },
  {
    code: 'MAT-SAND-RIVER',
    name: 'River Sand',
    unit: 'MT',
    grade: 'Zone II',
    category: 'Aggregates',
    hsnCode: '25059000',
    description: 'Fine aggregate for concrete and plaster',
  },
  {
    code: 'MAT-DIESEL',
    name: 'Diesel',
    unit: 'KL',
    grade: 'HSD',
    category: 'Fuel',
    hsnCode: '27101920',
    description: 'High speed diesel for plant and equipment',
  },
  {
    code: 'MAT-GEOTEXTILE',
    name: 'Geotextile Fabric',
    unit: 'Rolls',
    grade: '200 GSM',
    category: 'Geosynthetics',
    hsnCode: '56031400',
    description: 'Non-woven geotextile for subgrade stabilization',
  },
  {
    code: 'MAT-PAINT-MARK',
    name: 'Road Marking Paint',
    unit: 'KL',
    grade: 'Thermoplastic',
    category: 'Paving',
    hsnCode: '32091000',
    description: 'Retro-reflective thermoplastic road marking',
  },
  {
    code: 'MAT-PIPE-HDPE',
    name: 'HDPE Pipe 200mm',
    unit: 'Mtr',
    grade: 'PN6',
    category: 'Drainage',
    hsnCode: '39172110',
    description: 'Corrugated HDPE drainage pipe',
  },
  {
    code: 'MAT-BOLT-ANCHOR',
    name: 'Anchor Bolts M20',
    unit: 'Nos',
    grade: '8.8',
    category: 'Fasteners',
    hsnCode: '73181500',
    description: 'High tensile anchor bolts for crash barriers',
  },
];

async function seedDatabase() {
  await Promise.all([
    User.deleteMany({}),
    Project.deleteMany({}),
    Site.deleteMany({}),
    Material.deleteMany({}),
    StockLedger.deleteMany({}),
    Vendor.deleteMany({}),
    MaterialRequest.deleteMany({}),
    PurchaseRequest.deleteMany({}),
    PurchaseOrder.deleteMany({}),
    RFQ.deleteMany({}),
    Quotation.deleteMany({}),
    StatusHistory.deleteMany({}),
    Notification.deleteMany({}),
    AuditLog.deleteMany({}),
    StockMovement.deleteMany({}),
    WorkOrder.deleteMany({}),
    Incident.deleteMany({}),
    Address.deleteMany({}),
    BranchTransfer.deleteMany({}),
    DeliveryVerification.deleteMany({}),
    GoodsReceiptNote.deleteMany({}),
    IdempotencyRecord.deleteMany({}),
  ]);

  await ensureDefaultAddresses();

  const projectBillingAddr = await Address.create({
    type: 'project_billing',
    label: 'Metro Line Extension — Billing',
    lines: `BEKEM INFRA PROJECTS PVT. LTD. — Metro Line Extension
Chennai Phase II Project Office, Anna Salai, Chennai — 600 002
GST No.: 29AADCB5671Q1ZY`,
    gstNumber: BEKEM_BUYER_GST,
  });

  const project = await Project.create({
    code: 'PRJ-001',
    name: 'Elevated Corridor - HMDA - SH01',
    location: 'Hyderabad — Bangalore Corridor',
    status: 'ACTIVE',
    startDate: new Date('2025-04-01'),
    targetEndDate: new Date('2027-03-31'),
    budgetTotal: 450000000,
    budgetSpent: 125000000,
    healthScore: 82,
  });

  const project2 = await Project.create({
    code: 'PRJ-002',
    name: 'Metro Line Extension',
    location: 'Chennai Phase II',
    status: 'ACTIVE',
    startDate: new Date('2025-01-15'),
    targetEndDate: new Date('2028-06-30'),
    budgetTotal: 890000000,
    budgetSpent: 210000000,
    healthScore: 76,
    billingAddressId: projectBillingAddr._id,
  });

  const site = await Site.create({
    projectId: project._id,
    name: 'Chainage 45-60',
    chainageLabel: 'KM 45+200 — KM 60+800',
  });

  const site2 = await Site.create({
    projectId: project._id,
    name: 'Chainage 60-75',
    chainageLabel: 'KM 60+800 — KM 75+400',
  });

  const siteMetro = await Site.create({
    projectId: project2._id,
    name: 'Station Block C',
    chainageLabel: 'Stn C — Elevated Section',
  });

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const userMap = {};

  for (const u of USERS) {
    const data = { ...u, passwordHash, assignedProjectIds: [], assignedSiteId: null };
    if (u.role === 'SITE_INCHARGE') {
      data.assignedSiteId = site._id;
      data.assignedProjectIds = [project._id];
    }
    if (u.role === 'STORE_INCHARGE') {
      data.assignedSiteId = site._id;
      data.assignedProjectIds = [project._id, project2._id];
    }
    if (u.role === 'PROJECT_MANAGER') data.assignedProjectIds = [project._id];
    if (u.role === 'EXECUTIVE') data.assignedProjectIds = [project._id, project2._id];
    if (u.role === 'COORDINATOR') data.assignedProjectIds = [project._id, project2._id];
    if (u.role === 'CHAIRMAN') data.assignedProjectIds = [project._id, project2._id];
    const created = await User.create(data);
    userMap[u.role] = created;
  }

  const materialDocs = [];
  for (const m of MATERIALS) {
    const mat = await Material.create(m);
    materialDocs.push(mat);
  }

  const stockConfig = [
    { siteId: site._id, qty: [120, 500, 85, 200, 150, 25, 40, 8, 600, 1200] },
    { siteId: site2._id, qty: [60, 200, 40, 100, 80, 12, 20, 4, 300, 600] },
    { siteId: siteMetro._id, qty: [30, 150, 55, 60, 40, 8, 15, 2, 200, 400] },
  ];

  for (const cfg of stockConfig) {
    for (let i = 0; i < materialDocs.length; i++) {
      const mat = materialDocs[i];
      const qty = cfg.qty[i] ?? 50;
      await StockLedger.create({
        siteId: cfg.siteId,
        materialId: mat._id,
        quantityOnHand: qty,
        lowStockThreshold: mat.code.includes('CEMENT') ? 100 : mat.code.includes('DIESEL') ? 10 : 20,
      });
    }
  }

  const vendors = [];
  const matByCode = Object.fromEntries(materialDocs.map((m) => [m.code, m._id]));

  const vendorSeed = [
    {
      name: 'M/s SRI GANESH HARDWARE',
      code: 'SGH',
      address: 'Opp. Jindal Old Gate Sandur Road, Toranagallu, Bellary Dist., Karnataka — 583 123',
      gstNumber: '29AIGPD1568E1ZE',
      email: 'smh.bharath@gmail.com',
      contactPerson: 'Mr. Ganesh',
      phone: '83101 84965',
      category: 'Hardware',
      suppliedCategories: ['Fasteners', 'General'],
      materialCodes: ['MAT-BOLT-ANCHOR'],
      rating: 4.5,
    },
    {
      name: 'South India Bitumen',
      code: 'SIB',
      address: 'Industrial Area, Hosur Road, Bangalore — 560 100',
      gstNumber: '29AABCS1234F1Z5',
      email: 'sales@southindiabitumen.com',
      contactPerson: 'Mr. Ramesh',
      phone: '+91 98765 43212',
      category: 'Bitumen',
      suppliedCategories: ['Paving'],
      materialCodes: ['MAT-BITUMEN-VG30', 'MAT-PAINT-MARK'],
      rating: 4.8,
    },
    {
      name: 'UltraBuild Supplies',
      code: 'UBS',
      address: 'Plot 42, IDA Uppal, Hyderabad — 500 039',
      gstNumber: '36AABCU1234G1Z2',
      email: 'orders@ultrabuild.com',
      contactPerson: 'Ms. Priya',
      phone: '+91 98765 43210',
      category: 'Cement',
      suppliedCategories: ['Cement', 'Aggregates'],
      materialCodes: ['MAT-CEMENT-OPC53', 'MAT-AGG-20MM', 'MAT-SAND-RIVER'],
      rating: 4.5,
    },
    {
      name: 'Chennai Steel Traders',
      code: 'CST',
      address: 'Ambattur Industrial Estate, Chennai — 600 058',
      gstNumber: '33AAFCST1234H1Z8',
      email: 'steel@chennaitraders.com',
      contactPerson: 'Mr. Karthik',
      phone: '+91 98765 43213',
      category: 'Steel',
      suppliedCategories: ['Steel'],
      materialCodes: ['MAT-STEEL-12MM'],
      rating: 4.6,
    },
  ];

  for (const v of vendorSeed) {
    const { materialCodes, ...data } = v;
    vendors.push(
      await Vendor.create({
        ...data,
        contactInfo: data.phone,
        materialIds: materialCodes.map((c) => matByCode[c]).filter(Boolean),
      })
    );
  }

  const siteUser = userMap.SITE_INCHARGE;
  const storeUser = userMap.STORE_INCHARGE;

  const consigneeSite1 = `BEKEM INFRA PROJECTS PVT. LTD.
${site.name}
${site.chainageLabel}
Store Manager: ${storeUser.name}`;

  const consigneeMetro = `BEKEM INFRA PROJECTS PVT. LTD.
${siteMetro.name}
${siteMetro.chainageLabel}
Store Manager: ${storeUser.name}`;
  const pmUser = userMap.PROJECT_MANAGER;
  const execUser = userMap.EXECUTIVE;
  const coordUser = userMap.COORDINATOR;
  const chairmanUser = userMap.CHAIRMAN;

  const cement = materialDocs.find((m) => m.code === 'MAT-CEMENT-OPC53');
  const steel = materialDocs.find((m) => m.code === 'MAT-STEEL-12MM');
  const bitumen = materialDocs.find((m) => m.code === 'MAT-BITUMEN-VG30');
  const diesel = materialDocs.find((m) => m.code === 'MAT-DIESEL');

  const mrPending = await MaterialRequest.create({
    indentNumber: 'IND/FY25-26/PRJ-001/000001',
    projectId: project._id,
    siteId: site._id,
    items: [{ materialId: cement._id, quantityRequested: 80, quantityAllocated: 0 }],
    materialId: cement._id,
    quantityRequested: 80,
    purpose: 'RCC culvert at KM 52 — urgent pour scheduled',
    requiredByDate: new Date(Date.now() + 5 * 86400000),
    requestedByUserId: siteUser._id,
    status: 'PENDING_STORE',
    pendingWithRole: 'STORE_INCHARGE',
  });

  const mrWithPm = await MaterialRequest.create({
    indentNumber: 'IND/FY25-26/PRJ-001/000002',
    projectId: project._id,
    siteId: site._id,
    items: [
      { materialId: steel._id, quantityRequested: 12, quantityAllocated: 12 },
      { materialId: bitumen._id, quantityRequested: 25, quantityAllocated: 25 },
    ],
    materialId: steel._id,
    quantityRequested: 12,
    quantityAllocated: 12,
    purpose: 'DBM layer — Chainage 48-52',
    requiredByDate: new Date(Date.now() + 10 * 86400000),
    requestedByUserId: siteUser._id,
    status: 'FORWARDED_TO_PM',
    pendingWithRole: 'PROJECT_MANAGER',
  });

  const mrApproved = await MaterialRequest.create({
    indentNumber: 'IND/FY25-26/PRJ-001/000003',
    projectId: project._id,
    siteId: site._id,
    items: [{ materialId: diesel._id, quantityRequested: 5, quantityAllocated: 5 }],
    materialId: diesel._id,
    quantityRequested: 5,
    quantityAllocated: 5,
    purpose: 'Fuel for batching plant — weekly replenishment',
    requiredByDate: new Date(Date.now() + 3 * 86400000),
    requestedByUserId: siteUser._id,
    status: 'PM_APPROVED',
    pendingWithRole: 'EXECUTIVE',
  });

  const mrCompleted = await MaterialRequest.create({
    indentNumber: 'IND/FY25-26/PRJ-002/000001',
    projectId: project2._id,
    siteId: siteMetro._id,
    items: [{ materialId: cement._id, quantityRequested: 200, quantityAllocated: 200, quantityIssued: 200 }],
    materialId: cement._id,
    quantityRequested: 200,
    quantityAllocated: 200,
    purpose: 'Station C platform concreting',
    requiredByDate: new Date(Date.now() - 14 * 86400000),
    requestedByUserId: siteUser._id,
    status: 'ISSUED',
    pendingWithRole: null,
  });

  const prApproved = await PurchaseRequest.create({
    prNumber: 'PR/PRJ-001/FY25-26/0001',
    materialRequestId: mrApproved._id,
    projectId: project._id,
    status: 'APPROVED',
    createdByUserId: pmUser._id,
    amountEstimate: 425000,
  });

  const prDraft = await PurchaseRequest.create({
    prNumber: 'PR/PRJ-001/FY25-26/0002',
    materialRequestId: mrWithPm._id,
    projectId: project._id,
    status: 'DRAFT',
    createdByUserId: pmUser._id,
    amountEstimate: 1850000,
  });

  const poDraft = await PurchaseOrder.create({
    draftRef: 'DRAFT-PO-2025-014',
    purchaseRequestId: prDraft._id,
    vendorId: vendors[1]._id,
    amount: 1850000,
    paymentTerms: 'Net 45 days',
    billingAddress: BEKEM_BUYER_ADDRESS,
    deliveryAddress: consigneeSite1,
    lineItems: [
      {
        description: 'TMT Steel 12mm + Bitumen VG-30 bundle',
        materialId: steel._id,
        hsnCode: '72142090',
        quantity: 37,
        rate: 50000,
        gstPercent: 18,
        amount: 1850000,
      },
    ],
    status: 'DRAFT',
  });

  const poPendingCoord = await PurchaseOrder.create({
    poNumber: 'PO-PRJ-001-2025-008',
    purchaseRequestId: prApproved._id,
    vendorId: vendors[2]._id,
    amount: 425000,
    paymentTerms: 'Net 30 days',
    billingAddress: BEKEM_BUYER_ADDRESS,
    deliveryAddress: consigneeSite1,
    lineItems: [
      {
        description: 'Diesel HSD — 5 KL',
        materialId: diesel._id,
        hsnCode: '27101920',
        quantity: 5,
        rate: 72000,
        gstPercent: 18,
        amount: 425000,
      },
    ],
    status: 'COORDINATOR_PENDING',
  });

  const poApproved = await PurchaseOrder.create({
    poNumber: 'PO-PRJ-002-2025-003',
    procurementRef: 'BEKEM-PRJ00/SIB/0001/25-26',
    poSeq: 1,
    vendorPoSeq: 1,
    financialYear: '25-26',
    purchaseRequestId: prDraft._id,
    vendorId: vendors[0]._id,
    amount: 2400000,
    paymentTerms: '30% advance, balance on delivery',
    billingAddress: BEKEM_BUYER_ADDRESS,
    deliveryAddress: consigneeMetro,
    lineItems: [
      {
        description: 'Crash barrier installation — Package A',
        materialId: steel._id,
        hsnCode: '72142090',
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
    prNumber: 'PR/PRJ-001/FY25-26/0003',
    materialRequestId: mrApproved._id,
    projectId: project._id,
    status: 'APPROVED',
    createdByUserId: pmUser._id,
    amountEstimate: 85000,
  });

  const poGrnReady = await PurchaseOrder.create({
    poNumber: 'PO-PRJ-001-2025-009',
    procurementRef: 'BEKEM-PRJ00/SGH/0002/25-26',
    poSeq: 2,
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
        description: 'TMT Steel 12mm — 10 MT',
        materialId: steel._id,
        hsnCode: '72142090',
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
    remarks: 'Demo: delivery verified at site — ready for GRN receipt',
    verifiedByUserId: storeUser._id,
  });

  const prWoChairman = await PurchaseRequest.create({
    prNumber: 'PR/PRJ-002/FY25-26/0001',
    projectId: project2._id,
    status: 'APPROVED',
    createdByUserId: execUser._id,
    amountEstimate: 1200000,
  });

  const poWoChairman = await PurchaseOrder.create({
    poNumber: 'PO-PRJ-002-2025-004',
    procurementRef: 'BEKEM-PRJ00/CST/0003/25-26',
    poSeq: 3,
    vendorPoSeq: 1,
    financialYear: '25-26',
    purchaseRequestId: prWoChairman._id,
    vendorId: vendors[1]._id,
    amount: 1200000,
    paymentTerms: 'Net 45 days',
    billingAddress: BEKEM_BUYER_ADDRESS,
    deliveryAddress: consigneeMetro,
    lineItems: [
      {
        description: 'Elevated section waterproofing',
        materialId: bitumen._id,
        hsnCode: '27132000',
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

  await WorkOrder.create({
    woNumber: 'WO-PRJ-002-2025-001',
    purchaseOrderId: poApproved._id,
    projectId: project2._id,
    siteId: siteMetro._id,
    vendorId: vendors[0]._id,
    scope: 'Supply and install crash barriers along elevated section — 1.2 km',
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
      { name: 'Commissioning', status: 'PENDING', order: 4 },
    ],
  });

  await WorkOrder.create({
    woNumber: 'WO-PRJ-001-2025-002',
    purchaseOrderId: poPendingCoord._id,
    projectId: project._id,
    siteId: site._id,
    vendorId: vendors[2]._id,
    scope: 'Diesel supply contract — quarterly replenishment',
    totalQuantity: 5,
    quantityUnit: 'KL',
    completedQuantity: 0,
    progressPercent: 0,
    contractValue: 425000,
    status: 'COORDINATOR_PENDING',
    createdByUserId: execUser._id,
  });

  await WorkOrder.create({
    woNumber: 'WO-PRJ-002-2025-002',
    purchaseOrderId: poWoChairman._id,
    projectId: project2._id,
    siteId: siteMetro._id,
    vendorId: vendors[1]._id,
    scope: 'Waterproofing works — elevated section package',
    totalQuantity: 2000,
    quantityUnit: 'Sqm',
    completedQuantity: 0,
    progressPercent: 0,
    contractValue: 1200000,
    status: 'CHAIRMAN_PENDING',
    createdByUserId: execUser._id,
    coordinatorVerifiedByUserId: coordUser._id,
    coordinatorVerifiedAt: new Date(),
  });

  await BranchTransfer.create({
    transferNumber: 'BT/2026/0001',
    fromProjectId: project2._id,
    fromSiteId: siteMetro._id,
    toProjectId: project._id,
    toSiteId: site._id,
    items: [{ materialId: steel._id, quantity: 50 }],
    status: 'REQUESTED',
    note: 'Demo: transfer steel from Metro to Highway section — awaiting destination PM',
    requestedByUserId: storeUser._id,
  });

  await BranchTransfer.create({
    transferNumber: 'BT/2026/0002',
    fromProjectId: project._id,
    fromSiteId: site2._id,
    toProjectId: project2._id,
    toSiteId: siteMetro._id,
    items: [{ materialId: cement._id, quantity: 120 }],
    status: 'PM_APPROVED',
    note: 'Demo: cement transfer approved by PM — awaiting coordinator decision',
    requestedByUserId: storeUser._id,
    pmApprovedByUserId: pmUser._id,
    pmApprovedAt: new Date(Date.now() - 1 * 86400000),
  });

  await Incident.create({
    incidentNumber: 'INC/PRJ-001/0001',
    projectId: project._id,
    siteId: site._id,
    type: 'SAFETY',
    severity: 'HIGH',
    title: 'Worker slip near batching plant',
    description:
      'One labourer slipped on wet surface near the cement silo. First aid administered on site. Area cordoned off pending anti-slip mats.',
    status: 'OPEN',
    reportedByUserId: siteUser._id,
  });

  await Incident.create({
    incidentNumber: 'INC/PRJ-001/0002',
    projectId: project._id,
    siteId: site2._id,
    type: 'EQUIPMENT',
    severity: 'MEDIUM',
    title: 'Paver hydraulic leak — Chainage 68',
    description:
      'Sensor alert on paver P-04. Hydraulic fluid leak detected during evening shift. Machine parked; maintenance team notified.',
    status: 'IN_REVIEW',
    reportedByUserId: storeUser._id,
  });

  await Incident.create({
    incidentNumber: 'INC/PRJ-002/0001',
    projectId: project2._id,
    siteId: siteMetro._id,
    type: 'QUALITY',
    severity: 'LOW',
    title: 'Rebar spacing deviation — Platform slab',
    description:
      'QC inspection found 15mm spacing variance in secondary reinforcement. Rework completed and re-inspected.',
    status: 'RESOLVED',
    reportedByUserId: pmUser._id,
    resolvedByUserId: coordUser._id,
    resolutionNote: 'Rework verified by PM. Closed with corrective action log.',
    resolvedAt: new Date(Date.now() - 2 * 86400000),
  });

  const historyEntries = [
    { entityType: 'MaterialRequest', entityId: mrPending._id, fromStatus: null, toStatus: 'PENDING_STORE', actorUserId: siteUser._id, note: 'Indent submitted' },
    { entityType: 'MaterialRequest', entityId: mrWithPm._id, fromStatus: 'PENDING_STORE', toStatus: 'ALLOCATED', actorUserId: storeUser._id, note: 'Stock allocated' },
    { entityType: 'MaterialRequest', entityId: mrWithPm._id, fromStatus: 'ALLOCATED', toStatus: 'FORWARDED_TO_PM', actorUserId: storeUser._id, note: 'Forwarded for PM approval' },
    {
      entityType: 'MaterialRequest',
      entityId: mrApproved._id,
      fromStatus: 'FORWARDED_TO_PM',
      toStatus: 'PM_APPROVED',
      actorUserId: pmUser._id,
      note: 'Approved for procurement',
      timestamp: new Date(Date.now() - 2 * 86400000),
    },
    { entityType: 'PurchaseOrder', entityId: poPendingCoord._id, fromStatus: 'DRAFT', toStatus: 'COORDINATOR_PENDING', actorUserId: execUser._id, note: 'PO submitted for verification' },
  ];

  for (const h of historyEntries) {
    await StatusHistory.create(h);
  }

  const notifications = [
    { userId: storeUser._id, title: 'New indent pending', body: `${mrPending.indentNumber} awaits store allocation.`, relatedEntityType: 'MaterialRequest', relatedEntityId: mrPending._id, isRead: false },
    { userId: pmUser._id, title: 'Indent forwarded', body: `${mrWithPm.indentNumber} needs your approval.`, relatedEntityType: 'MaterialRequest', relatedEntityId: mrWithPm._id, isRead: false },
    { userId: execUser._id, title: 'Ready for PO', body: `${mrApproved.indentNumber} approved — create purchase order.`, relatedEntityType: 'MaterialRequest', relatedEntityId: mrApproved._id, isRead: false },
    { userId: coordUser._id, title: 'PO verification', body: `${poPendingCoord.poNumber} requires coordinator review.`, relatedEntityType: 'PurchaseOrder', relatedEntityId: poPendingCoord._id, isRead: false },
    { userId: chairmanUser._id, title: 'WO awaiting approval', body: `${'WO-PRJ-002-2025-002'} needs Chairman sign-off.`, relatedEntityType: 'WorkOrder', relatedEntityId: poWoChairman._id, isRead: false },
    { userId: storeUser._id, title: 'GRN ready', body: `${poGrnReady.poNumber} delivered and verified — record receipt.`, relatedEntityType: 'PurchaseOrder', relatedEntityId: poGrnReady._id, isRead: false },
    { userId: siteUser._id, title: 'Materials issued', body: `${mrCompleted.indentNumber} fully issued from store.`, relatedEntityType: 'MaterialRequest', relatedEntityId: mrCompleted._id, isRead: true },
  ];

  for (const n of notifications) {
    await Notification.create(n);
  }

  await AuditLog.create({
    action: 'SEED_DEMO_DATA',
    entityType: 'System',
    entityId: project._id,
    actorUserId: chairmanUser._id,
    afterState: { note: 'Rich demo dataset loaded for Bekem OS', brandColor: BEKEM_BLUE },
  });

  return { project, site, project2, siteMetro, userMap, materialDocs, vendors };
}

async function seed() {
  await connectMongo();
  console.log('Connected to MongoDB');
  await seedDatabase();

  console.log('\n✅ Demo users seeded.\n');
  console.log(`Demo users (password: ${DEMO_PASSWORD}):`);
  for (const u of USERS) {
    console.log(`  ${u.role.padEnd(18)} ${u.email}`);
  }

  try {
    const fs = require('fs');
    const { importAndSyncPoIndex, DEFAULT_PATH } = require('./importPoIndex');
    if (fs.existsSync(DEFAULT_PATH)) {
      console.log('\nImporting real PO INDEX — projects, vendors, products…');
      const result = await importAndSyncPoIndex(DEFAULT_PATH);
      console.log(
        `\n✅ Real data ready: ${result.inserted} inventory rows, ${result.projects} projects, ${result.vendors} vendors, ${result.materials} products`
      );
      if (result.samplePoFormat) {
        console.log(`PO format: ${result.samplePoFormat}`);
      }
      console.log('Old demo POs / products removed. Coordinator → Projects / Vendors updated.\n');
    } else {
      console.log(
        '\nPO INDEX Excel not found — demo catalog kept. Run: npm run import:po-index --workspace=apps/api\n'
      );
    }
  } catch (err) {
    console.warn('\nPO index import failed:', err.message);
    console.warn('Demo catalog kept. Fix the Excel path and re-run import:po-index.\n');
  }

  try {
    const { seedTransactionalDemo } = require('./seedTransactionalDemo');
    console.log('\nSeeding UAT transactional demo (post-import)…');
    const tx = await seedTransactionalDemo({ force: true });
    console.log(`✅ UAT transactions: ${tx.summary}\n`);
  } catch (err) {
    console.warn('\nUAT transactional seed failed:', err.message);
    console.warn('Run manually: npm run seed:transactions\n');
  }

  await mongoose.disconnect();
}

if (require.main === module) {
  seed().catch((err) => {
    console.error('Seed failed:', err);
    if (err.code === 8000 && String(err.message).includes('500 collections')) {
      console.error(
        '\nAtlas cluster is at the 500-collection limit (M0 free tier).\n' +
          'Delete unused databases in MongoDB Atlas, then run: npm run seed\n' +
          'This app needs ~17 new collections in the BEKEM database.\n'
      );
    }
    process.exit(1);
  });
}

module.exports = { seedDatabase, DEMO_PASSWORD, USERS };
