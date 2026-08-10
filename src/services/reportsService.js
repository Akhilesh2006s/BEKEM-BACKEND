const { UserRole } = require('@afios/shared');
const {
  MaterialRequest,
  PurchaseOrder,
  GoodsReceiptNote,
  MaterialIssue,
  PaymentBill,
  Project,
  PurchaseRequest,
  AuditLog,
  StockLedger,
  BranchTransfer,
  RFQ,
  WorkOrder,
  Vendor,
} = require('../models');
const {
  summarizePurchaseOrdersReceipts,
} = require('./grnFulfillmentService');

function daysBetween(from, to = new Date()) {
  if (!from) return null;
  const a = new Date(from).getTime();
  if (Number.isNaN(a)) return null;
  return Math.max(0, Math.floor((to.getTime() - a) / (24 * 60 * 60 * 1000)));
}

function parseDateRange(query) {
  const from = query.from ? new Date(query.from) : null;
  const to = query.to ? new Date(query.to) : null;
  const range = {};
  if (from && !Number.isNaN(from.getTime())) range.$gte = from;
  if (to && !Number.isNaN(to.getTime())) {
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    range.$lte = end;
  }
  return Object.keys(range).length ? range : null;
}

async function indentAgingReport(user, query = {}) {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (user.role === UserRole.SITE_INCHARGE || query.mine === '1' || query.mine === 'true') {
    filter.requestedByUserId = user._id;
  }
  const dateRange = parseDateRange(query);
  if (dateRange) filter.createdAt = dateRange;

  const rows = await MaterialRequest.find(filter)
    .sort({ updatedAt: -1 })
    .limit(500)
    .populate('projectId', 'code name')
    .populate('siteId', 'name chainageLabel')
    .populate('requestedByUserId', 'name')
    .lean();

  return rows.map((mr) => {
    const statusSince = mr.updatedAt || mr.createdAt;
    return {
      id: mr._id.toString(),
      indentNumber: mr.indentNumber,
      status: mr.status,
      projectCode: mr.projectId?.code || '',
      projectName: mr.projectId?.name || '',
      siteName: mr.siteId?.chainageLabel || mr.siteId?.name || '',
      raisedBy: mr.requestedByUserId?.name || '',
      createdAt: mr.createdAt,
      updatedAt: mr.updatedAt,
      daysOpen: daysBetween(mr.createdAt),
      daysInStatus: daysBetween(statusSince),
      purpose: mr.purpose || '',
    };
  });
}

async function openPoReport(user, query = {}) {
  const filter = {
    status: 'APPROVED',
    fulfillmentStatus: { $ne: 'closed_complete' },
  };
  const dateRange = parseDateRange(query);
  if (dateRange) filter.createdAt = dateRange;

  const orders = await PurchaseOrder.find(filter)
    .sort({ expectedDeliveryDate: 1, createdAt: -1 })
    .limit(500)
    .populate('vendorId', 'name')
    .populate({
      path: 'purchaseRequestId',
      populate: { path: 'projectId', select: 'code name' },
    })
    .lean();

  const receiptByPo = await summarizePurchaseOrdersReceipts(orders);
  const overdueOnly = query.overdue === '1' || query.overdue === 'true';
  const now = new Date();

  return orders
    .map((po) => {
      const summary = receiptByPo.get(po._id.toString()) || {
        orderedQty: 0,
        receivedQty: 0,
        remainingQty: 0,
      };
      const expected = po.expectedDeliveryDate ? new Date(po.expectedDeliveryDate) : null;
      const overdue = Boolean(expected && expected < now && summary.remainingQty > 0);
      const daysLate =
        overdue && expected ? Math.floor((now.getTime() - expected.getTime()) / 86400000) : 0;
      return {
        id: po._id.toString(),
        poNumber: po.poNumber || po.draftRef || '',
        displayPoNumber: po.displayPoNumber || '',
        vendorName: po.vendorId?.name || '',
        projectCode: po.purchaseRequestId?.projectId?.code || '',
        projectName: po.purchaseRequestId?.projectId?.name || '',
        amount: po.amount || 0,
        orderedQty: summary.orderedQty,
        receivedQty: summary.receivedQty,
        remainingQty: summary.remainingQty,
        expectedDeliveryDate: po.expectedDeliveryDate || null,
        overdue,
        daysLate,
        status: po.status,
        fulfillmentStatus: po.fulfillmentStatus || 'open_partial',
      };
    })
    .filter((row) => (overdueOnly ? row.overdue : true));
}

async function grnRegisterReport(user, query = {}) {
  const filter = {};
  const dateRange = parseDateRange(query);
  if (dateRange) filter.receivedAt = dateRange;
  if (query.status) filter.status = query.status;

  const receipts = await GoodsReceiptNote.find(filter)
    .sort({ receivedAt: -1 })
    .limit(500)
    .populate('purchaseOrderId')
    .lean();

  const pos = receipts
    .map((g) => g.purchaseOrderId)
    .filter((po) => po && typeof po === 'object' && po.lineItems);
  const unique = [];
  const seen = new Set();
  for (const po of pos) {
    const id = po._id.toString();
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(po);
  }
  const receiptByPo = await summarizePurchaseOrdersReceipts(unique);

  return receipts.map((g) => {
    const po = g.purchaseOrderId;
    const poId = po?._id?.toString?.() || '';
    const summary = poId ? receiptByPo.get(poId) : null;
    const thisGrnQty = (g.items || []).reduce(
      (sum, item) => sum + (Number(item.quantityReceived) || 0),
      0
    );
    return {
      id: g._id.toString(),
      grnNumber: g.grnNumber,
      poNumber: g.poNumber || po?.poNumber || po?.draftRef || '',
      indentNumber: g.indentNumber || '',
      vendorName: g.vendorName || '',
      status: g.status,
      invoiceNo: g.invoiceNo || '',
      invoiceDate: g.invoiceDate || null,
      invoiceValue: g.invoiceValue || 0,
      challanNo: g.challanNo || '',
      receivedAt: g.receivedAt || g.createdAt,
      quantityThisGrn: thisGrnQty,
      quantityOrdered: summary?.orderedQty || 0,
      quantityReceived: summary?.receivedQty || 0,
      quantityRemaining: summary?.remainingQty || 0,
    };
  });
}

async function issueRegisterReport(user, query = {}) {
  const filter = {};
  const dateRange = parseDateRange(query);
  if (dateRange) filter.issuedAt = dateRange;

  if (user.role === UserRole.SITE_INCHARGE) {
    const myMrs = await MaterialRequest.find({ requestedByUserId: user._id })
      .select('_id')
      .lean();
    filter.materialRequestId = { $in: myMrs.map((m) => m._id) };
  }

  const issues = await MaterialIssue.find(filter)
    .sort({ issuedAt: -1 })
    .limit(500)
    .populate('materialRequestId', 'indentNumber projectId')
    .populate('issuedByUserId', 'name')
    .populate('items.materialId', 'name unit code')
    .lean();

  const rows = [];
  for (const issue of issues) {
    for (const item of issue.items || []) {
      rows.push({
        id: `${issue._id}-${item._id || item.materialId}`,
        issueNumber: issue.issueNumber,
        indentNumber: issue.materialRequestId?.indentNumber || '',
        materialName: item.materialId?.name || 'Material',
        materialCode: item.materialId?.code || '',
        quantity: item.quantity || 0,
        unit: item.materialId?.unit || '',
        issuedToName: issue.issuedToName || '',
        issuedToType: issue.issuedToType || '',
        issuedBy: issue.issuedByUserId?.name || '',
        issuedAt: issue.issuedAt || issue.createdAt,
        issueType: issue.issueType || '',
        status: issue.status,
      });
    }
  }
  return rows;
}

async function projectMaterialCostReport(user, query = {}) {
  const projects = await Project.find({})
    .select('code name budgetTotal')
    .sort({ code: 1 })
    .lean();

  const prs = await PurchaseRequest.find({})
    .select('_id projectId materialRequestId')
    .lean();
  const prByProject = new Map();
  for (const pr of prs) {
    const key = pr.projectId?.toString();
    if (!key) continue;
    if (!prByProject.has(key)) prByProject.set(key, []);
    prByProject.get(key).push(pr);
  }

  const pos = await PurchaseOrder.find({ status: { $ne: 'REJECTED' } })
    .select('purchaseRequestId amount status fulfillmentStatus')
    .lean();
  const poByPr = new Map();
  for (const po of pos) {
    const key = po.purchaseRequestId?.toString();
    if (!key) continue;
    if (!poByPr.has(key)) poByPr.set(key, []);
    poByPr.get(key).push(po);
  }

  const grns = await GoodsReceiptNote.find({
    status: { $nin: ['DRAFT', 'REJECTED'] },
  })
    .select('purchaseOrderId invoiceValue receivedQuantity')
    .lean();
  const grnByPo = new Map();
  for (const grn of grns) {
    const key = grn.purchaseOrderId?.toString();
    if (!key) continue;
    grnByPo.set(key, (grnByPo.get(key) || 0) + (Number(grn.invoiceValue) || 0));
  }

  const issues = await MaterialIssue.find({})
    .populate({
      path: 'materialRequestId',
      select: 'projectId',
    })
    .populate('items.materialId', 'referenceUnitPrice')
    .lean();

  const issuedByProject = new Map();
  for (const issue of issues) {
    const projectId = issue.materialRequestId?.projectId?.toString?.();
    if (!projectId) continue;
    let value = 0;
    for (const item of issue.items || []) {
      const rate = Number(item.materialId?.referenceUnitPrice || 0);
      value += rate * (Number(item.quantity) || 0);
    }
    issuedByProject.set(projectId, (issuedByProject.get(projectId) || 0) + value);
  }

  return projects.map((project) => {
    const projectId = project._id.toString();
    const projectPrs = prByProject.get(projectId) || [];
    let openPoCommitment = 0;
    let poValue = 0;
    let grnValue = 0;
    for (const pr of projectPrs) {
      const list = poByPr.get(pr._id.toString()) || [];
      for (const po of list) {
        poValue += Number(po.amount) || 0;
        if (po.status === 'APPROVED' && po.fulfillmentStatus !== 'closed_complete') {
          openPoCommitment += Number(po.amount) || 0;
        }
        grnValue += grnByPo.get(po._id.toString()) || 0;
      }
    }
    const issuedValue = issuedByProject.get(projectId) || 0;
    return {
      id: projectId,
      projectCode: project.code,
      projectName: project.name,
      budget: project.budgetTotal || 0,
      issuedValue: Math.round(issuedValue),
      grnValue: Math.round(grnValue),
      poValue: Math.round(poValue),
      openPoCommitment: Math.round(openPoCommitment),
      totalExposure: Math.round(issuedValue + openPoCommitment),
    };
  });
}

async function threeWayExceptionsReport(user, query = {}) {
  const grns = await GoodsReceiptNote.find({
    $or: [
      { status: 'ON_HOLD' },
      { isPartialGrn: true },
      { 'varianceDetails.lines.0': { $exists: true } },
    ],
  })
    .sort({ updatedAt: -1 })
    .limit(300)
    .populate('purchaseOrderId', 'poNumber draftRef amount vendorId')
    .lean();

  return grns.map((g) => {
    const lines = g.varianceDetails?.lines || [];
    const qtyVar = lines.some((l) => l.qtyDeviation);
    const priceVar = lines.some((l) => l.priceDeviation);
    return {
      id: g._id.toString(),
      grnNumber: g.grnNumber,
      poNumber: g.poNumber || g.purchaseOrderId?.poNumber || g.purchaseOrderId?.draftRef || '',
      vendorName: g.vendorName || '',
      status: g.status,
      approvalStage: g.approvalStage || '',
      holdReasons: (g.holdReasons || []).join('; '),
      invoiceNo: g.invoiceNo || '',
      invoiceValue: g.invoiceValue || 0,
      qtyVariance: qtyVar,
      priceVariance: priceVar,
      receivedAt: g.receivedAt || g.createdAt,
    };
  });
}

async function apAgingReport(user, query = {}) {
  const bills = await PaymentBill.find({
    paymentStatus: { $in: ['PENDING', 'PARTIAL', 'OVERDUE'] },
  })
    .sort({ dueDate: 1 })
    .limit(500)
    .populate('vendorId', 'name gstNumber')
    .populate('projectId', 'code name')
    .lean();

  const now = new Date();
  return bills.map((bill) => {
    const basis = bill.dueDate || bill.invoiceDate || bill.createdAt;
    const age = daysBetween(basis, now) || 0;
    let bucket = '0-30';
    if (age > 90) bucket = '90+';
    else if (age > 60) bucket = '61-90';
    else if (age > 30) bucket = '31-60';
    return {
      id: bill._id.toString(),
      billNumber: bill.billNumber,
      vendorName: bill.vendorId?.name || '',
      gstin: bill.vendorId?.gstNumber || '',
      projectCode: bill.projectId?.code || '',
      invoiceNumber: bill.invoiceNumber || '',
      invoiceValue: bill.invoiceValue || 0,
      paidAmount: bill.paidAmount || 0,
      outstandingAmount: bill.outstandingAmount || 0,
      paymentStatus: bill.paymentStatus,
      dueDate: bill.dueDate || null,
      agingDays: age,
      agingBucket: bucket,
    };
  });
}

async function pipelineMisReport(user) {
  const [
    pendingStore,
    pendingPm,
    pendingHo,
    purchaseRequested,
    openPos,
    pendingGrn,
    onHoldGrn,
    coordinatorPo,
    chairmanPo,
  ] = await Promise.all([
    MaterialRequest.countDocuments({ status: 'PENDING_STORE' }),
    MaterialRequest.countDocuments({
      status: { $in: ['FORWARDED_TO_PM', 'ALLOCATED', 'PM_APPROVED'] },
    }),
    MaterialRequest.countDocuments({
      status: { $in: ['PENDING_HO', 'PENDING_EXECUTIVE_DECISION'] },
    }),
    MaterialRequest.countDocuments({
      status: { $in: ['PURCHASE_REQUESTED', 'RFQ_OPEN', 'QUOTED', 'VENDOR_SELECTED', 'PO_CREATED'] },
    }),
    PurchaseOrder.countDocuments({
      status: 'APPROVED',
      fulfillmentStatus: { $ne: 'closed_complete' },
    }),
    PurchaseOrder.countDocuments({
      status: 'APPROVED',
      fulfillmentStatus: { $ne: 'closed_complete' },
    }),
    GoodsReceiptNote.countDocuments({ status: 'ON_HOLD' }),
    PurchaseOrder.countDocuments({
      status: { $in: ['COORDINATOR_PENDING', 'PENDING_REVIEW', 'PM_PENDING'] },
    }),
    PurchaseOrder.countDocuments({
      status: { $in: ['CHAIRMAN_PENDING', 'PENDING_APPROVAL'] },
    }),
  ]);

  const openPoValue = await PurchaseOrder.aggregate([
    {
      $match: {
        status: 'APPROVED',
        fulfillmentStatus: { $ne: 'closed_complete' },
      },
    },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);

  const apOutstanding = await PaymentBill.aggregate([
    { $match: { paymentStatus: { $in: ['PENDING', 'PARTIAL', 'OVERDUE'] } } },
    { $group: { _id: null, total: { $sum: '$outstandingAmount' } } },
  ]);

  return [
    { stage: 'Indents at Store', count: pendingStore, value: null },
    { stage: 'Indents with PM', count: pendingPm, value: null },
    { stage: 'Awaiting Executive decision', count: pendingHo, value: null },
    { stage: 'PR / RFQ / PO creation', count: purchaseRequested, value: null },
    { stage: 'PO awaiting Coordinator', count: coordinatorPo, value: null },
    { stage: 'PO awaiting Chairman', count: chairmanPo, value: null },
    { stage: 'Open PO (pending GRN)', count: openPos, value: openPoValue[0]?.total || 0 },
    { stage: 'GRN on hold', count: onHoldGrn, value: null },
    { stage: 'Pending material receipt POs', count: pendingGrn, value: null },
    {
      stage: 'Vendor AP outstanding',
      count: null,
      value: apOutstanding[0]?.total || 0,
    },
  ];
}

async function approvalTrailReport(user, query = {}) {
  const filter = {};
  if (query.entityType) filter.entityType = query.entityType;
  const dateRange = parseDateRange(query);
  if (dateRange) filter.timestamp = dateRange;

  const logs = await AuditLog.find(filter)
    .sort({ timestamp: -1 })
    .limit(500)
    .populate('actorUserId', 'name role')
    .lean();

  return logs.map((log) => ({
    id: log._id.toString(),
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId?.toString?.() || '',
    actorName: log.actorUserId?.name || 'System',
    actorRole: log.actorUserId?.role || '',
    timestamp: log.timestamp || log.createdAt,
    remark:
      log.afterState?.remark ||
      log.afterState?.note ||
      log.beforeState?.remark ||
      '',
  }));
}

async function shortageReport(user, query = {}) {
  const ledgers = await StockLedger.find({})
    .populate('materialId', 'name code unit')
    .populate('siteId', 'name chainageLabel')
    .limit(1000)
    .lean();

  const openIndents = await MaterialRequest.find({
    status: { $nin: ['COMPLETED', 'CLOSED', 'REJECTED', 'CANCELLED', 'ISSUED'] },
  })
    .select('items materialId quantityRequested')
    .lean();

  const openIndentQty = new Map();
  for (const mr of openIndents) {
    const items = mr.items?.length
      ? mr.items
      : mr.materialId
        ? [{ materialId: mr.materialId, quantityRequested: mr.quantityRequested }]
        : [];
    for (const item of items) {
      const key = (item.materialId?._id || item.materialId)?.toString?.();
      if (!key) continue;
      openIndentQty.set(key, (openIndentQty.get(key) || 0) + Number(item.quantityRequested || 0));
    }
  }

  const openPos = await PurchaseOrder.find({
    status: 'APPROVED',
    fulfillmentStatus: { $ne: 'closed_complete' },
  })
    .select('lineItems')
    .lean();
  const openPoQty = new Map();
  for (const po of openPos) {
    for (const line of po.lineItems || []) {
      const key = (line.materialId?._id || line.materialId)?.toString?.();
      if (!key) continue;
      openPoQty.set(key, (openPoQty.get(key) || 0) + Number(line.quantity || 0));
    }
  }

  return ledgers
    .map((l) => {
      const onHand = Number(l.quantityOnHand || 0);
      const reserved = Number(l.quantityReserved || 0);
      const available = Math.max(0, onHand - reserved);
      const threshold = Number(l.lowStockThreshold ?? 10);
      const materialId = (l.materialId?._id || l.materialId)?.toString?.() || '';
      const shortfall = Math.max(0, threshold - available);
      return {
        id: l._id.toString(),
        materialName: l.materialId?.name || 'Material',
        materialCode: l.materialId?.code || '',
        unit: l.materialId?.unit || '',
        siteName: l.siteId?.chainageLabel || l.siteId?.name || '',
        quantityOnHand: onHand,
        availableQty: available,
        lowStockThreshold: threshold,
        shortfall,
        openIndentQty: openIndentQty.get(materialId) || 0,
        openPoQty: openPoQty.get(materialId) || 0,
        isLowStock: available <= threshold,
      };
    })
    .filter((row) => row.isLowStock)
    .sort((a, b) => b.shortfall - a.shortfall);
}

async function priceCompareReport(user, query = {}) {
  const orders = await PurchaseOrder.find({ status: { $in: ['APPROVED', 'COORDINATOR_PENDING', 'CHAIRMAN_PENDING'] } })
    .sort({ createdAt: -1 })
    .limit(400)
    .populate('vendorId', 'name')
    .lean();

  const byMaterial = new Map();
  for (const po of orders) {
    for (const line of po.lineItems || []) {
      const materialId = (line.materialId?._id || line.materialId)?.toString?.();
      if (!materialId) continue;
      const entry = {
        materialId,
        description: line.description || '',
        rate: Number(line.rate || 0),
        poNumber: po.poNumber || po.draftRef || '',
        vendorName: po.vendorId?.name || '',
        createdAt: po.createdAt,
      };
      if (!byMaterial.has(materialId)) byMaterial.set(materialId, []);
      byMaterial.get(materialId).push(entry);
    }
  }

  const rows = [];
  for (const [, list] of byMaterial) {
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const current = list[0];
    const previous = list[1];
    if (!current) continue;
    const lastRate = previous ? previous.rate : null;
    const pct =
      lastRate && lastRate > 0 ? ((current.rate - lastRate) / lastRate) * 100 : null;
    rows.push({
      id: `${current.materialId}-${current.poNumber}`,
      materialName: current.description || current.materialId,
      currentPo: current.poNumber,
      currentVendor: current.vendorName,
      currentRate: current.rate,
      lastPo: previous?.poNumber || '',
      lastVendor: previous?.vendorName || '',
      lastRate: lastRate,
      changePct: pct == null ? null : Math.round(pct * 10) / 10,
      createdAt: current.createdAt,
    });
  }
  return rows.slice(0, 500);
}

async function gstRegisterReport(user, query = {}) {
  const filter = { status: { $nin: ['DRAFT', 'REJECTED'] } };
  const dateRange = parseDateRange(query);
  if (dateRange) filter.receivedAt = dateRange;

  const grns = await GoodsReceiptNote.find(filter)
    .sort({ receivedAt: -1 })
    .limit(500)
    .populate({
      path: 'purchaseOrderId',
      select: 'lineItems vendorId',
      populate: { path: 'vendorId', select: 'name gstNumber' },
    })
    .lean();

  return grns.map((g) => {
    const vendor = g.purchaseOrderId?.vendorId;
    const invoiceValue = Number(g.invoiceValue || 0);
    // Infer GST from first PO line or default 18%
    const gstPercent = Number(g.purchaseOrderId?.lineItems?.[0]?.gstPercent ?? 18);
    const taxable = Math.round((invoiceValue / (1 + gstPercent / 100)) * 100) / 100;
    const tax = Math.round((invoiceValue - taxable) * 100) / 100;
    return {
      id: g._id.toString(),
      grnNumber: g.grnNumber,
      invoiceNo: g.invoiceNo || '',
      invoiceDate: g.invoiceDate || g.receivedAt,
      vendorName: g.vendorName || vendor?.name || '',
      gstin: vendor?.gstNumber || '',
      taxableValue: taxable,
      gstPercent,
      gstAmount: tax,
      invoiceValue,
      status: g.status,
    };
  });
}

async function docCompletenessReport(user, query = {}) {
  const grns = await GoodsReceiptNote.find({ status: { $nin: ['DRAFT', 'REJECTED'] } })
    .sort({ receivedAt: -1 })
    .limit(400)
    .lean();

  return grns
    .map((g) => {
      const attachments = g.attachments || [];
      const hasInvoice = attachments.some((a) => a.category === 'INVOICE');
      const hasChallan = attachments.some((a) => a.category === 'CHALLAN');
      const hasEway = Boolean(String(g.ewayBillNumber || '').trim());
      const needsEway = Number(g.invoiceValue || 0) > 50000;
      const missing = [];
      if (!g.invoiceNo) missing.push('Invoice number');
      if (!hasInvoice) missing.push('Invoice file');
      if (!hasChallan) missing.push('Challan file');
      if (needsEway && !hasEway) missing.push('E-Way bill');
      return {
        id: g._id.toString(),
        grnNumber: g.grnNumber,
        poNumber: g.poNumber || '',
        vendorName: g.vendorName || '',
        invoiceNo: g.invoiceNo || '',
        invoiceValue: g.invoiceValue || 0,
        hasInvoiceFile: hasInvoice,
        hasChallanFile: hasChallan,
        hasEway,
        missingDocs: missing.join('; ') || 'Complete',
        incomplete: missing.length > 0,
        status: g.status,
        receivedAt: g.receivedAt,
      };
    })
    .filter((row) => row.incomplete);
}

async function spendByVendorReport(user, query = {}) {
  const pos = await PurchaseOrder.find({ status: { $ne: 'REJECTED' } })
    .select('vendorId amount status')
    .lean();
  const grns = await GoodsReceiptNote.find({ status: { $nin: ['DRAFT', 'REJECTED'] } })
    .select('vendorId invoiceValue purchaseOrderId')
    .populate('purchaseOrderId', 'vendorId')
    .lean();
  const bills = await PaymentBill.find({})
    .select('vendorId paidAmount invoiceValue outstandingAmount')
    .lean();

  const map = new Map();
  const bump = (vendorId, field, value) => {
    const key = vendorId?.toString?.() || 'unknown';
    if (!map.has(key)) {
      map.set(key, {
        vendorId: key,
        poValue: 0,
        grnValue: 0,
        paidAmount: 0,
        outstandingAmount: 0,
        poCount: 0,
      });
    }
    const row = map.get(key);
    row[field] += Number(value) || 0;
  };

  for (const po of pos) {
    bump(po.vendorId, 'poValue', po.amount);
    const key = po.vendorId?.toString?.() || 'unknown';
    map.get(key).poCount += 1;
  }
  for (const g of grns) {
    const vendorId = g.vendorId || g.purchaseOrderId?.vendorId;
    bump(vendorId, 'grnValue', g.invoiceValue);
  }
  for (const b of bills) {
    bump(b.vendorId, 'paidAmount', b.paidAmount);
    bump(b.vendorId, 'outstandingAmount', b.outstandingAmount);
  }

  const vendorIds = [...map.keys()].filter((id) => id !== 'unknown');
  const vendors = await Vendor.find({ _id: { $in: vendorIds } })
    .select('name code')
    .lean();
  const nameById = new Map(vendors.map((v) => [v._id.toString(), v.name]));

  const totalPo = [...map.values()].reduce((s, r) => s + r.poValue, 0) || 1;
  return [...map.entries()]
    .map(([id, row]) => ({
      id,
      vendorName: nameById.get(id) || (id === 'unknown' ? 'Unknown' : id),
      poCount: row.poCount,
      poValue: Math.round(row.poValue),
      grnValue: Math.round(row.grnValue),
      paidAmount: Math.round(row.paidAmount),
      outstandingAmount: Math.round(row.outstandingAmount),
      pctOfPoSpend: Math.round((row.poValue / totalPo) * 1000) / 10,
    }))
    .sort((a, b) => b.poValue - a.poValue);
}

async function branchTransferReport(user, query = {}) {
  const filter = {};
  if (query.status) filter.status = query.status;
  const dateRange = parseDateRange(query);
  if (dateRange) filter.createdAt = dateRange;

  const rows = await BranchTransfer.find(filter)
    .sort({ createdAt: -1 })
    .limit(400)
    .populate('fromProjectId', 'code name')
    .populate('toProjectId', 'code name')
    .populate('requestedByUserId', 'name')
    .populate('items.materialId', 'name unit')
    .lean();

  const out = [];
  for (const bt of rows) {
    for (const item of bt.items || []) {
      out.push({
        id: `${bt._id}-${item._id || item.materialId}`,
        transferNumber: bt.transferNumber,
        fromProject: bt.fromProjectId?.code || '',
        toProject: bt.toProjectId?.code || '',
        materialName: item.materialId?.name || 'Material',
        quantity: item.quantity || 0,
        quantityReceived: item.quantityReceived || 0,
        status: bt.status,
        requestedBy: bt.requestedByUserId?.name || '',
        createdAt: bt.createdAt,
      });
    }
  }
  return out;
}

async function rfqPipelineReport(user, query = {}) {
  const rfqs = await RFQ.find({})
    .sort({ createdAt: -1 })
    .limit(400)
    .populate({
      path: 'purchaseRequestId',
      select: 'prNumber projectId materialRequestId',
      populate: [
        { path: 'projectId', select: 'code name' },
        { path: 'materialRequestId', select: 'indentNumber' },
      ],
    })
    .populate('createdByUserId', 'name role')
    .lean();

  const prIds = rfqs.map((r) => r.purchaseRequestId?._id).filter(Boolean);
  const pos = await PurchaseOrder.find({ purchaseRequestId: { $in: prIds } })
    .select('purchaseRequestId poNumber status')
    .lean();
  const poByPr = new Map();
  for (const po of pos) {
    const key = po.purchaseRequestId?.toString();
    if (key && !poByPr.has(key)) poByPr.set(key, po);
  }

  return rfqs.map((r) => {
    const prId = r.purchaseRequestId?._id?.toString();
    const po = prId ? poByPr.get(prId) : null;
    return {
      id: r._id.toString(),
      rfqNumber: r.rfqNumber,
      status: r.status,
      prNumber: r.purchaseRequestId?.prNumber || '',
      indentNumber: r.purchaseRequestId?.materialRequestId?.indentNumber || '',
      projectCode: r.purchaseRequestId?.projectId?.code || '',
      raisedBy: r.createdByUserId?.name || '',
      quotesObtainedAt: r.quotesObtainedAt || null,
      daysOpen: daysBetween(r.createdAt),
      poNumber: po?.poNumber || '',
      poStatus: po?.status || '',
      createdAt: r.createdAt,
    };
  });
}

async function grnPaymentRecoReport(user, query = {}) {
  const grns = await GoodsReceiptNote.find({ status: { $nin: ['DRAFT', 'REJECTED', 'ON_HOLD'] } })
    .sort({ receivedAt: -1 })
    .limit(400)
    .lean();
  const grnIds = grns.map((g) => g._id);
  const bills = await PaymentBill.find({ grnId: { $in: grnIds } }).lean();
  const billByGrn = new Map();
  for (const b of bills) {
    const key = b.grnId?.toString();
    if (key) billByGrn.set(key, b);
  }

  return grns.map((g) => {
    const bill = billByGrn.get(g._id.toString());
    const invoiced = Number(g.invoiceValue || 0);
    const paid = Number(bill?.paidAmount || 0);
    const outstanding = bill
      ? Number(bill.outstandingAmount || 0)
      : invoiced;
    return {
      id: g._id.toString(),
      grnNumber: g.grnNumber,
      poNumber: g.poNumber || '',
      vendorName: g.vendorName || '',
      invoiceNo: g.invoiceNo || '',
      grnInvoiceValue: invoiced,
      billNumber: bill?.billNumber || '',
      billInvoiceValue: bill?.invoiceValue ?? null,
      paidAmount: paid,
      outstandingAmount: outstanding,
      paymentStatus: bill?.paymentStatus || 'NO_BILL',
      matched: Boolean(bill) && Math.abs(invoiced - Number(bill.invoiceValue || 0)) < 1,
      receivedAt: g.receivedAt,
    };
  });
}

async function cancelledProcurementReport(user, query = {}) {
  const dateRange = parseDateRange(query);
  const mrFilter = { status: { $in: ['REJECTED', 'CANCELLED'] } };
  const poFilter = { status: 'REJECTED' };
  if (dateRange) {
    mrFilter.updatedAt = dateRange;
    poFilter.updatedAt = dateRange;
  }

  const [mrs, pos] = await Promise.all([
    MaterialRequest.find(mrFilter)
      .sort({ updatedAt: -1 })
      .limit(200)
      .populate('projectId', 'code')
      .populate('requestedByUserId', 'name')
      .lean(),
    PurchaseOrder.find(poFilter)
      .sort({ updatedAt: -1 })
      .limit(200)
      .populate('vendorId', 'name')
      .lean(),
  ]);

  return [
    ...mrs.map((mr) => ({
      id: mr._id.toString(),
      docType: 'Indent',
      docNumber: mr.indentNumber,
      projectCode: mr.projectId?.code || '',
      party: mr.requestedByUserId?.name || '',
      amount: mr.estimatedValue || 0,
      status: mr.status,
      updatedAt: mr.updatedAt,
      reason: mr.purpose || '',
    })),
    ...pos.map((po) => ({
      id: po._id.toString(),
      docType: 'PO',
      docNumber: po.poNumber || po.draftRef || '',
      projectCode: '',
      party: po.vendorId?.name || '',
      amount: po.amount || 0,
      status: po.status,
      updatedAt: po.updatedAt,
      reason: '',
    })),
  ].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

async function workOrderCostReport(user, query = {}) {
  const filter = {};
  if (query.status) filter.status = query.status;
  const dateRange = parseDateRange(query);
  if (dateRange) filter.createdAt = dateRange;

  const wos = await WorkOrder.find(filter)
    .sort({ createdAt: -1 })
    .limit(400)
    .populate('projectId', 'code name')
    .populate('vendorId', 'name')
    .lean();

  return wos.map((wo) => {
    const milestones = wo.milestones || [];
    const done = milestones.filter((m) => m.status === 'COMPLETED').length;
    const materialQty = (wo.materialIssues || []).reduce(
      (s, m) => s + Number(m.quantity || 0),
      0
    );
    return {
      id: wo._id.toString(),
      woNumber: wo.woNumber || wo._id.toString(),
      projectCode: wo.projectId?.code || '',
      vendorName: wo.vendorId?.name || '',
      status: wo.status,
      amount: wo.contractValue || 0,
      progressPercent: wo.progressPercent || 0,
      completedQuantity: wo.completedQuantity || 0,
      totalQuantity: wo.totalQuantity || 0,
      milestonesTotal: milestones.length,
      milestonesDone: done,
      milestonePct: milestones.length ? Math.round((done / milestones.length) * 100) : 0,
      materialQty,
      createdAt: wo.createdAt,
    };
  });
}

async function stockMovementReport(user, query = {}) {
  const dateRange = parseDateRange(query);
  const grnFilter = { status: { $nin: ['DRAFT', 'REJECTED'] } };
  const issueFilter = {};
  if (dateRange) {
    grnFilter.receivedAt = dateRange;
    issueFilter.issuedAt = dateRange;
  }

  const [grns, issues] = await Promise.all([
    GoodsReceiptNote.find(grnFilter)
      .sort({ receivedAt: -1 })
      .limit(250)
      .populate('items.materialId', 'name unit')
      .lean(),
    MaterialIssue.find(issueFilter)
      .sort({ issuedAt: -1 })
      .limit(250)
      .populate('items.materialId', 'name unit')
      .populate('materialRequestId', 'indentNumber')
      .lean(),
  ]);

  const rows = [];
  for (const g of grns) {
    for (const item of g.items || []) {
      rows.push({
        id: `in-${g._id}-${item._id || item.materialId}`,
        movementType: 'IN — GRN',
        docNumber: g.grnNumber,
        ref: g.poNumber || '',
        materialName: item.materialId?.name || 'Material',
        quantity: item.quantityReceived || 0,
        unit: item.materialId?.unit || '',
        party: g.vendorName || '',
        movedAt: g.receivedAt || g.createdAt,
      });
    }
  }
  for (const issue of issues) {
    for (const item of issue.items || []) {
      rows.push({
        id: `out-${issue._id}-${item._id || item.materialId}`,
        movementType: 'OUT — Issue',
        docNumber: issue.issueNumber,
        ref: issue.materialRequestId?.indentNumber || '',
        materialName: item.materialId?.name || 'Material',
        quantity: item.quantity || 0,
        unit: item.materialId?.unit || '',
        party: issue.issuedToName || '',
        movedAt: issue.issuedAt || issue.createdAt,
      });
    }
  }
  return rows.sort((a, b) => new Date(b.movedAt) - new Date(a.movedAt)).slice(0, 500);
}

module.exports = {
  indentAgingReport,
  openPoReport,
  grnRegisterReport,
  issueRegisterReport,
  projectMaterialCostReport,
  threeWayExceptionsReport,
  apAgingReport,
  pipelineMisReport,
  approvalTrailReport,
  shortageReport,
  priceCompareReport,
  gstRegisterReport,
  docCompletenessReport,
  spendByVendorReport,
  branchTransferReport,
  rfqPipelineReport,
  grnPaymentRecoReport,
  cancelledProcurementReport,
  workOrderCostReport,
  stockMovementReport,
};
