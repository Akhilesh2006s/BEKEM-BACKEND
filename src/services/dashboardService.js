const { UserRole } = require('@afios/shared');
const {
  Project,
  MaterialRequest,
  PurchaseOrder,
  WorkOrder,
  StockLedger,
  Material,
  Vendor,
  PurchaseRequest,
  TallySyncRecord,
  Site,
  Incident,
  User,
  StatusHistory,
} = require('../models');

const MS_DAY = 24 * 60 * 60 * 1000;

function daysSince(date) {
  if (!date) return 0;
  return Math.floor((Date.now() - new Date(date).getTime()) / MS_DAY);
}

function pctChange(current, previous) {
  if (!previous) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function lastNMonthsBuckets(n, getValue) {
  const buckets = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push(getValue(d));
  }
  return buckets;
}

async function getChairmanKpis() {
  const projects = await Project.find({ status: 'ACTIVE' });
  const totalBudgetCap = projects.reduce((s, p) => s + (p.budgetTotal || 0), 0);
  const totalBudgetSpent = projects.reduce((s, p) => s + (p.budgetSpent || 0), 0);

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * MS_DAY);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * MS_DAY);

  const spentLast30 = projects.reduce((s, p) => {
    const ratio = Math.min(1, daysSince(p.updatedAt || p.createdAt) / 30);
    return s + Math.round((p.budgetSpent || 0) * ratio * 0.15);
  }, 0);
  const spentPrev30 = Math.max(0, totalBudgetSpent * 0.08);
  const budgetPctChange = pctChange(spentLast30 || totalBudgetSpent * 0.12, spentPrev30);

  const ledgers = await StockLedger.find();
  const shortages = ledgers.filter((l) => l.quantityOnHand <= l.lowStockThreshold).length;
  const prevShortages = Math.max(0, shortages - 1);

  const delayed = await MaterialRequest.countDocuments({
    requiredByDate: { $lt: now },
    status: {
      $in: ['PENDING_STORE', 'ALLOCATED', 'FORWARDED_TO_PM', 'PM_APPROVED', 'PO_CREATED'],
    },
  });

  const pendingApprovals = await PurchaseOrder.countDocuments({
    status: { $in: ['PENDING_APPROVAL', 'CHAIRMAN_PENDING'] },
  });
  const prevApprovals = Math.max(0, pendingApprovals);

  const pos = await PurchaseOrder.find({ createdAt: { $gte: new Date(now.getFullYear(), now.getMonth() - 5, 1) } });
  const budgetSparkline = lastNMonthsBuckets(6, (monthStart) => {
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
    return pos
      .filter((po) => {
        const d = new Date(po.createdAt);
        return d >= monthStart && d <= monthEnd && po.status === 'APPROVED';
      })
      .reduce((s, po) => s + (po.amount || 0), 0);
  });

  const approvalSparkline = lastNMonthsBuckets(6, (monthStart) => {
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
    return pos.filter((po) => {
      const d = new Date(po.createdAt);
      return d >= monthStart && d <= monthEnd && ['APPROVED', 'CHAIRMAN_PENDING'].includes(po.status);
    }).length;
  });

  const shortageSparkline = lastNMonthsBuckets(6, (monthStart) => {
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0, 23, 59, 59);
    return ledgers.filter((l) => {
      if (l.quantityOnHand > l.lowStockThreshold) return false;
      const d = new Date(l.updatedAt || l.createdAt || l.lastMovementAt);
      return d <= monthEnd;
    }).length;
  });

  const openIncidents = await Incident.countDocuments({
    status: { $in: ['OPEN', 'IN_REVIEW'] },
    type: 'SAFETY',
  });

  const [posByStatus, wosByStatus, indentsOpen, approvedPoValue] = await Promise.all([
    PurchaseOrder.aggregate([{ $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: '$amount' } } }]),
    WorkOrder.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    MaterialRequest.countDocuments({
      status: { $nin: ['COMPLETED', 'CLOSED', 'REJECTED', 'CANCELLED'] },
    }),
    PurchaseOrder.aggregate([
      { $match: { status: 'APPROVED' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
  ]);

  const poStatusMap = Object.fromEntries(posByStatus.map((r) => [r._id, { count: r.count, value: r.value }]));
  const woStatusMap = Object.fromEntries(wosByStatus.map((r) => [r._id, r.count]));

  const projectBreakdown = await Promise.all(
    projects.map(async (p) => {
      const prIds = await PurchaseRequest.find({ projectId: p._id }).select('_id');
      const ids = prIds.map((pr) => pr._id);
      const [poCount, poValue, poPendingChairman, indentCount, lateIndents] = await Promise.all([
        PurchaseOrder.countDocuments({ purchaseRequestId: { $in: ids } }),
        PurchaseOrder.aggregate([
          { $match: { purchaseRequestId: { $in: ids }, status: 'APPROVED' } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
        PurchaseOrder.countDocuments({
          purchaseRequestId: { $in: ids },
          status: { $in: ['CHAIRMAN_PENDING', 'PENDING_APPROVAL'] },
        }),
        MaterialRequest.countDocuments({ projectId: p._id }),
        MaterialRequest.countDocuments({
          projectId: p._id,
          requiredByDate: { $lt: now },
          status: { $nin: ['COMPLETED', 'CLOSED', 'REJECTED', 'CANCELLED'] },
        }),
      ]);
      return {
        projectId: p._id.toString(),
        code: p.code,
        name: p.name,
        healthScore: p.healthScore,
        budgetTotal: p.budgetTotal,
        budgetSpent: p.budgetSpent,
        deployPct: p.budgetTotal > 0 ? Math.round((p.budgetSpent / p.budgetTotal) * 100) : 0,
        purchaseOrders: poCount,
        approvedPoValue: poValue[0]?.total || 0,
        pendingChairmanPos: poPendingChairman,
        indents: indentCount,
        lateIndents,
      };
    })
  );

  return {
    budgetDeployed: totalBudgetSpent,
    budgetCap: totalBudgetCap,
    budgetDeployPct: totalBudgetCap > 0 ? Math.round((totalBudgetSpent / totalBudgetCap) * 100) : 0,
    budgetChangePct: budgetPctChange,
    projectsRunning: projects.length,
    approvalsPending: pendingApprovals,
    approvalsChangePct: pctChange(pendingApprovals, prevApprovals),
    shortages,
    shortagesChangePct: pctChange(shortages, prevShortages),
    delayed,
    safetyIncidents: openIncidents,
    openIndents: indentsOpen,
    approvedPoCount: poStatusMap.APPROVED?.count || 0,
    approvedPoValue: approvedPoValue[0]?.total || 0,
    poPipeline: {
      pmPending: poStatusMap.PM_PENDING?.count || 0,
      coordinatorPending: poStatusMap.COORDINATOR_PENDING?.count || 0,
      chairmanPending: (poStatusMap.CHAIRMAN_PENDING?.count || 0) + (poStatusMap.PENDING_APPROVAL?.count || 0),
      approved: poStatusMap.APPROVED?.count || 0,
      rejected: poStatusMap.REJECTED?.count || 0,
    },
    woPipeline: {
      coordinatorPending: woStatusMap.COORDINATOR_PENDING || 0,
      chairmanPending: woStatusMap.CHAIRMAN_PENDING || 0,
      inProgress: (woStatusMap.ACCEPTED || 0) + (woStatusMap.IN_PROGRESS || 0),
    },
    approvalRules: {
      pmMaxInr: 5000,
      coordinatorMaxInr: 10000,
      note: 'Under ₹5k → PM · ₹5k–₹10k → Coordinator · Above ₹10k → Chairman (or Coordinator if Chairman not on premises)',
    },
    projectBreakdown,
    sparklines: {
      budget: budgetSparkline,
      approvals: approvalSparkline,
      shortages: shortageSparkline,
    },
  };
}

async function getTodayActions(user) {
  const role = user.role;
  const actions = [];

  if (role === UserRole.SITE_INCHARGE) {
    const pending = await MaterialRequest.countDocuments({
      requestedByUserId: user._id,
      status: 'PENDING_STORE',
    });
    if (pending > 0) {
      actions.push({
        id: 'site-pending',
        title: `${pending} request${pending > 1 ? 's' : ''} waiting at store`,
        subtitle: 'Track progress or create a new indent',
        href: '/requests?tab=pending',
        priority: 'high',
        count: pending,
      });
    } else {
      actions.push({
        id: 'site-new',
        title: 'No open indents',
        subtitle: 'Create a material request for your site',
        href: '/request/new',
        priority: 'medium',
        count: 0,
      });
    }
  }

  if (role === UserRole.STORE_INCHARGE && user.assignedSiteId) {
    const waiting = await MaterialRequest.countDocuments({
      siteId: user.assignedSiteId,
      status: 'PENDING_STORE',
    });
    if (waiting > 0) {
      actions.push({
        id: 'store-allocate',
        title: `Allocate ${waiting} pending request${waiting > 1 ? 's' : ''}`,
        subtitle: 'Review stock and forward to PM',
        href: '/store/requests',
        priority: 'high',
        count: waiting,
      });
    }
    const ledgers = await StockLedger.find({ siteId: user.assignedSiteId });
    const low = ledgers.filter((l) => l.quantityOnHand <= l.lowStockThreshold).length;
    if (low > 0) {
      actions.push({
        id: 'store-low',
        title: `${low} material${low > 1 ? 's' : ''} below threshold`,
        subtitle: 'Review stock levels',
        href: '/store/stock',
        priority: 'medium',
        count: low,
      });
    }
  }

  if (role === UserRole.PROJECT_MANAGER) {
    const pending = await MaterialRequest.countDocuments({ status: 'FORWARDED_TO_PM' });
    if (pending > 0) {
      actions.push({
        id: 'pm-approve',
        title: `Approve ${pending} material request${pending > 1 ? 's' : ''}`,
        subtitle: 'Forwarded from store — review and approve',
        href: '/pm/approvals',
        priority: 'high',
        count: pending,
      });
    }
    const prReady = await MaterialRequest.countDocuments({ status: 'PM_APPROVED' });
    if (prReady > 0) {
      actions.push({
        id: 'pm-pr',
        title: `${prReady} ready for purchase request`,
        subtitle: 'Advance to procurement',
        href: '/pm/purchase-request/new',
        priority: 'medium',
        count: prReady,
      });
    }
    const activeWo = await WorkOrder.countDocuments({
      projectId: { $in: user.assignedProjectIds || [] },
      status: { $in: ['ACCEPTED', 'IN_PROGRESS'] },
    });
    if (activeWo > 0) {
      const woHref =
        (await firstActiveWoHref({ projectId: { $in: user.assignedProjectIds || [] } })) ||
        '/pm#work-orders';
      actions.push({
        id: 'pm-wo-progress',
        title: `Track ${activeWo} active work order${activeWo > 1 ? 's' : ''}`,
        subtitle: 'Monitor milestones and verify certifications',
        href: woHref,
        priority: 'medium',
        count: activeWo,
      });
    }
  }

  if (role === UserRole.EXECUTIVE) {
    const openPrs = await PurchaseRequest.countDocuments({ status: 'OPEN' });
    const pmApproved = await MaterialRequest.countDocuments({ status: 'PM_APPROVED' });
    const readyForPo = openPrs + pmApproved;
    if (readyForPo > 0) {
      actions.push({
        id: 'exec-po',
        title: `Create PO for ${readyForPo} ready request${readyForPo > 1 ? 's' : ''}`,
        subtitle: 'Start the purchase order wizard',
        href: '/executive/po/new',
        priority: 'high',
        count: readyForPo,
      });
    }
    const pendingAccept = await WorkOrder.countDocuments({ status: 'PENDING_ACCEPTANCE' });
    if (pendingAccept > 0) {
      actions.push({
        id: 'exec-wo-accept',
        title: `Record contractor acceptance for ${pendingAccept} work order${pendingAccept > 1 ? 's' : ''}`,
        subtitle: 'Work cannot start until contractor accepts',
        href: await firstPendingAcceptanceWoHref(),
        priority: 'high',
        count: pendingAccept,
      });
    }
    const approvedPos = await PurchaseOrder.countDocuments({ status: 'APPROVED' });
    const woPos = await WorkOrder.distinct('purchaseOrderId');
    const woReady = approvedPos - woPos.length;
    if (woReady > 0) {
      actions.push({
        id: 'exec-wo-create',
        title: `Generate work order from ${woReady} approved PO${woReady > 1 ? 's' : ''}`,
        subtitle: 'Begin execution after procurement',
        href: '/executive/wo/new',
        priority: 'medium',
        count: woReady,
      });
    }
  }

  if (role === UserRole.COORDINATOR) {
    const pending = await PurchaseOrder.countDocuments({
      status: { $in: ['PENDING_REVIEW', 'COORDINATOR_PENDING'] },
    });
    actions.push({
      id: 'coord-verify',
      title: pending > 0 ? `Verify ${pending} purchase order${pending > 1 ? 's' : ''}` : 'PO verification queue clear',
      subtitle: pending > 0 ? 'Review and approve purchase orders' : 'No POs awaiting verification',
      href:
        pending > 0
          ? await firstPoDetailHref(['PENDING_REVIEW', 'COORDINATOR_PENDING'], '/coordinator')
          : '/coordinator/verify-pos',
      priority: pending > 0 ? 'high' : 'low',
      count: pending,
    });
    const woPending = await WorkOrder.countDocuments({
      status: { $in: ['COORDINATOR_PENDING', 'CHAIRMAN_PENDING'] },
    });
    if (woPending > 0) {
      actions.push({
        id: 'coord-wo-verify',
        title: `Approve ${woPending} work order${woPending > 1 ? 's' : ''}`,
        subtitle: 'Final work order approval',
        href: await firstWoDetailHref('COORDINATOR_PENDING', '/coordinator'),
        priority: 'high',
        count: woPending,
      });
    }
  }

  if (role === UserRole.PROJECT_MANAGER) {
    const pmPos = await PurchaseOrder.find({ status: 'PM_PENDING' })
      .populate({ path: 'purchaseRequestId', select: 'projectId' })
      .limit(50);
    const myPmPos = pmPos.filter((po) => {
      const pid = po.purchaseRequestId?.projectId?.toString();
      return (user.assignedProjectIds || []).some((id) => id.toString() === pid);
    });
    if (myPmPos.length > 0) {
      actions.push({
        id: 'pm-po-approve',
        title: `Approve ${myPmPos.length} low-value PO${myPmPos.length > 1 ? 's' : ''}`,
        subtitle: 'POs under ₹5,000 — Project Manager final approval',
        href: `/pm/po/${myPmPos[0]._id}`,
        priority: 'high',
        count: myPmPos.length,
      });
    }
  }

  if (role === UserRole.CHAIRMAN) {
    const pending = await PurchaseOrder.countDocuments({
      status: { $in: ['PENDING_APPROVAL', 'CHAIRMAN_PENDING'] },
    });
    actions.push({
      id: 'chairman-approve',
      title: pending > 0 ? `Final approve ${pending} PO${pending > 1 ? 's' : ''}` : 'No pending PO approvals',
      subtitle: pending > 0 ? 'POs above ₹10,000 awaiting Chairman' : 'Approval queue clear',
      href:
        pending > 0
          ? await firstPoDetailHref(['PENDING_APPROVAL', 'CHAIRMAN_PENDING'], '/chairman')
          : '/chairman/approve-pos',
      priority: pending > 0 ? 'high' : 'low',
      count: pending,
    });
    const woPending = await WorkOrder.countDocuments({ status: 'CHAIRMAN_PENDING' });
    if (woPending > 0) {
      actions.push({
        id: 'chairman-wo',
        title: `Approve ${woPending} work order${woPending > 1 ? 's' : ''}`,
        subtitle: 'Work orders awaiting Chairman',
        href: '/chairman/approve-wos',
        priority: 'high',
        count: woPending,
      });
    }
    actions.push({
      id: 'chairman-stock',
      title: 'Stock inventory (full access)',
      subtitle: 'All fields, late deliveries, delay reasons',
      href: '/store/stock',
      priority: 'medium',
    });
    actions.push({
      id: 'chairman-user-analytics',
      title: 'User activity analytics',
      subtitle: 'Indents, incidents, and project assignments per user',
      href: '/chairman/user-analytics',
      priority: 'medium',
      count: await User.countDocuments(),
    });
  }

  return actions.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.priority] - order[b.priority];
  });
}

async function getBudgetVsActual(user) {
  let projects;
  if ([UserRole.EXECUTIVE, UserRole.COORDINATOR, UserRole.CHAIRMAN].includes(user.role)) {
    projects = await Project.find({ status: 'ACTIVE' });
  } else if (user.role === UserRole.PROJECT_MANAGER) {
    projects = await Project.find({ _id: { $in: user.assignedProjectIds || [] } });
  } else {
    return [];
  }

  return projects.map((p) => ({
    projectId: p._id.toString(),
    code: p.code,
    name: p.name,
    budgetTotal: p.budgetTotal,
    budgetSpent: p.budgetSpent,
    deployPct: p.budgetTotal > 0 ? Math.round((p.budgetSpent / p.budgetTotal) * 100) : 0,
    healthScore: p.healthScore,
  }));
}

async function globalSearch(user, q) {
  if (!q || q.trim().length < 2) {
    return { materials: [], requests: [], orders: [], workOrders: [], vendors: [], projects: [] };
  }

  const term = q.trim();
  const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

  const [materials, vendors, projects] = await Promise.all([
    Material.find({
      isActive: { $ne: false },
      $or: [
        { name: regex },
        { code: regex },
        { description: regex },
        { grade: regex },
        { category: regex },
      ],
    }).limit(8),
    Vendor.find({ name: regex }).limit(8),
    Project.find({ $or: [{ name: regex }, { code: regex }] }).limit(8),
  ]);

  const reqFilter = {
    $or: [{ indentNumber: regex }],
  };
  if (user.role === UserRole.PROJECT_MANAGER && user.assignedProjectIds?.length) {
    reqFilter.projectId = { $in: user.assignedProjectIds };
  }
  if (user.role === UserRole.SITE_INCHARGE && user.assignedSiteId) {
    reqFilter.siteId = user.assignedSiteId;
  }

  const requests = await MaterialRequest.find(reqFilter)
    .populate('materialId')
    .sort({ updatedAt: -1 })
    .limit(8);

  const materialIds = materials.map((m) => m._id);
  if (materialIds.length) {
    const byMaterial = await MaterialRequest.find({
      materialId: { $in: materialIds },
      ...reqFilter.projectId ? { projectId: reqFilter.projectId } : {},
      ...reqFilter.siteId ? { siteId: reqFilter.siteId } : {},
    })
      .populate('materialId')
      .sort({ updatedAt: -1 })
      .limit(8);
    const seen = new Set(requests.map((r) => r._id.toString()));
    for (const r of byMaterial) {
      if (!seen.has(r._id.toString()) && requests.length < 8) {
        requests.push(r);
        seen.add(r._id.toString());
      }
    }
  }

  const orders = await PurchaseOrder.find({
    $or: [{ poNumber: regex }, { draftRef: regex }],
  })
    .populate('vendorId')
    .sort({ updatedAt: -1 })
    .limit(8);

  const workOrders = await WorkOrder.find({
    $or: [{ woNumber: regex }, { scope: regex }],
  })
    .populate('vendorId')
    .sort({ updatedAt: -1 })
    .limit(8);

  function poHref(po) {
    const id = po._id.toString();
    if (user.role === UserRole.CHAIRMAN && po.status === 'CHAIRMAN_PENDING') {
      return `/chairman/po/${id}`;
    }
    if (user.role === UserRole.COORDINATOR && po.status === 'COORDINATOR_PENDING') {
      return `/coordinator/po/${id}`;
    }
    return `/purchase-orders/${id}`;
  }

  function woHref(wo) {
    const id = wo._id.toString();
    if (user.role === UserRole.CHAIRMAN && wo.status === 'CHAIRMAN_PENDING') {
      return `/chairman/wo/${id}`;
    }
    if (user.role === UserRole.COORDINATOR && wo.status === 'COORDINATOR_PENDING') {
      return `/coordinator/wo/${id}`;
    }
    return `/work-orders/${id}`;
  }

  function materialHref(m) {
    if (user.role === UserRole.STORE_INCHARGE) return '/store';
    if (user.role === UserRole.EXECUTIVE) return '/executive/po/new';
    return '/request/new';
  }

  return {
    materials: materials.map((m) => ({
      id: m._id.toString(),
      label: m.name,
      sublabel: [m.code, m.grade, m.category].filter(Boolean).join(' · '),
      href: materialHref(m),
    })),
    requests: requests.map((r) => ({
      id: r._id.toString(),
      label: r.indentNumber,
      sublabel: r.materialId?.name || 'Material request',
      href: `/requests/${r._id}`,
    })),
    orders: orders.map((o) => ({
      id: o._id.toString(),
      label: o.poNumber || o.draftRef || 'Draft PO',
      sublabel: o.vendorId?.name || 'Purchase order',
      href: poHref(o),
    })),
    workOrders:
      user.role === UserRole.SITE_INCHARGE || user.role === UserRole.STORE_INCHARGE
        ? []
        : workOrders.map((w) => ({
            id: w._id.toString(),
            label: w.woNumber,
            sublabel: `${w.vendorId?.name || 'Contractor'} · ${w.scope || 'Work order'}`,
            href: woHref(w),
          })),
    vendors: vendors.map((v) => ({
      id: v._id.toString(),
      label: v.name,
      sublabel: v.category,
      href: `/vendors/${v._id}`,
    })),
    projects: projects.map((p) => ({
      id: p._id.toString(),
      label: p.code,
      sublabel: p.name,
      href: user.role === UserRole.PROJECT_MANAGER ? '/pm' : '/chairman',
    })),
  };
}

async function getTallySyncStatus() {
  const [pending, synced, failed] = await Promise.all([
    TallySyncRecord.countDocuments({ status: 'PENDING' }),
    TallySyncRecord.countDocuments({ status: 'SYNCED' }),
    TallySyncRecord.countDocuments({ status: 'FAILED' }),
  ]);
  const last = await TallySyncRecord.findOne().sort({ updatedAt: -1 });
  return {
    pending,
    synced,
    failed,
    lastSyncAt: last?.syncedAt?.toISOString() || last?.updatedAt?.toISOString() || null,
    status: failed > 0 ? 'degraded' : pending > 0 ? 'syncing' : 'healthy',
  };
}

const { CANONICAL_CODE } = require('./projectDeduplicationService');

async function getExplorerProjects() {
  const projects = await Project.find({ code: { $regex: CANONICAL_CODE } }).sort({ code: 1 });
  const sites = await Site.find().populate('projectId');
  return projects.map((p) => ({
    id: p._id.toString(),
    code: p.code,
    name: p.name,
    status: p.status,
    budgetTotal: p.budgetTotal,
    budgetSpent: p.budgetSpent,
    deployPct: p.budgetTotal > 0 ? Math.round((p.budgetSpent / p.budgetTotal) * 100) : 0,
    healthScore: p.healthScore,
    siteCount: sites.filter((s) => s.projectId?._id?.toString() === p._id.toString()).length,
  }));
}

function withAge(item) {
  return {
    ...item,
    ageDays: daysSince(item.createdAt || item.updatedAt),
  };
}

function poQueueListHref(rolePrefix) {
  return rolePrefix === '/chairman' ? '/chairman/approve-pos' : '/coordinator/verify-pos';
}

function woQueueListHref(rolePrefix) {
  return rolePrefix === '/chairman' ? '/chairman/approve-wos' : '/coordinator/verify-wos';
}

async function firstPoDetailHref(statuses, rolePrefix) {
  const list = Array.isArray(statuses) ? statuses : [statuses];
  const po = await PurchaseOrder.findOne({ status: { $in: list } })
    .sort({ createdAt: 1 })
    .select('_id');
  return po ? `${rolePrefix}/po/${po._id}` : poQueueListHref(rolePrefix);
}

async function firstWoDetailHref(status, rolePrefix) {
  const wo = await WorkOrder.findOne({ status }).sort({ createdAt: 1 }).select('_id');
  return wo ? `${rolePrefix}/wo/${wo._id}` : woQueueListHref(rolePrefix);
}

async function firstActiveWoHref(filter) {
  const wo = await WorkOrder.findOne({
    ...filter,
    status: { $in: ['ACCEPTED', 'IN_PROGRESS'] },
  })
    .sort({ updatedAt: -1 })
    .select('_id');
  return wo ? `/work-orders/${wo._id}` : null;
}

async function firstPendingAcceptanceWoHref() {
  const wo = await WorkOrder.findOne({ status: 'PENDING_ACCEPTANCE' })
    .sort({ createdAt: 1 })
    .select('_id');
  return wo ? `/work-orders/${wo._id}` : '/executive#work-orders';
}

async function getUserAnalytics() {
  const users = await User.find()
    .select('-passwordHash -refreshToken')
    .populate('assignedSiteId', 'name chainageLabel')
    .populate('assignedProjectIds', 'code name')
    .sort({ role: 1, name: 1 });

  const [indentCounts, incidentCounts, poVerifyCounts, chairmanApprovalCounts] = await Promise.all([
    MaterialRequest.aggregate([{ $group: { _id: '$requestedByUserId', count: { $sum: 1 } } }]),
    Incident.aggregate([{ $group: { _id: '$reportedByUserId', count: { $sum: 1 } } }]),
    StatusHistory.aggregate([
      {
        $match: {
          entityType: 'PurchaseOrder',
          toStatus: { $in: ['PENDING_APPROVAL', 'COORDINATOR_VERIFIED'] },
        },
      },
      { $group: { _id: '$actorUserId', count: { $sum: 1 } } },
    ]),
    StatusHistory.aggregate([
      { $match: { entityType: 'PurchaseOrder', toStatus: 'APPROVED' } },
      { $group: { _id: '$actorUserId', count: { $sum: 1 } } },
    ]),
  ]);

  const mapCounts = (rows) =>
    Object.fromEntries(rows.map((r) => [r._id?.toString(), r.count]));

  const indents = mapCounts(indentCounts);
  const incidents = mapCounts(incidentCounts);
  const poVerifications = mapCounts(poVerifyCounts);
  const chairmanApprovals = mapCounts(chairmanApprovalCounts);

  return users.map((u) => ({
    id: u._id.toString(),
    name: u.name,
    email: u.email,
    role: u.role,
    projects: (u.assignedProjectIds || [])
      .filter((p) => p && typeof p === 'object' && p.code)
      .map((p) => ({ id: p._id.toString(), code: p.code, name: p.name })),
    site: u.assignedSiteId?.name
      ? {
          id: u.assignedSiteId._id.toString(),
          name: u.assignedSiteId.name,
          chainageLabel: u.assignedSiteId.chainageLabel,
        }
      : undefined,
    materialIndents: indents[u._id.toString()] || 0,
    safetyIncidents: incidents[u._id.toString()] || 0,
    poVerifications: poVerifications[u._id.toString()] || 0,
    chairmanApprovals: chairmanApprovals[u._id.toString()] || 0,
    joinedAt: u.createdAt?.toISOString?.() || '',
  }));
}

module.exports = {
  getChairmanKpis,
  getTodayActions,
  getBudgetVsActual,
  globalSearch,
  getTallySyncStatus,
  getExplorerProjects,
  getUserAnalytics,
  daysSince,
  withAge,
};
