const { OrgSettings } = require('../models');

const DEFAULT_EXPENSE_CATEGORIES = [
  {
    key: 'GROCERY',
    label: 'Grocery',
    requiresPo: false,
    pmMaxInr: 3000,
    coordinatorMaxInr: 8000,
    description: 'Site grocery and consumables — may proceed without PO under limits',
  },
  {
    key: 'MESS',
    label: 'Mess',
    requiresPo: false,
    pmMaxInr: 5000,
    coordinatorMaxInr: 15000,
    description: 'Mess and catering expenses — coordinator approval above PM band',
  },
  {
    key: 'OFFICE_EXPENSE',
    label: 'Office Expenses',
    requiresPo: true,
    pmMaxInr: 5000,
    coordinatorMaxInr: 10000,
    description: 'HO office supplies — PO required; standard approval bands apply',
  },
  {
    key: 'EMERGENCY',
    label: 'Emergency Purchases',
    requiresPo: false,
    pmMaxInr: 10000,
    coordinatorMaxInr: 25000,
    description: 'Emergency procurement — elevated limits; PO optional per coordinator',
  },
];

function envDefaults() {
  return {
    poPmMaxInr: Number(process.env.PO_PM_MAX_INR || 5000),
    poCoordinatorMaxInr: Number(process.env.PO_COORDINATOR_MAX_INR || 10000),
    mrPmDailyMaxInr: Number(process.env.MR_PM_DAILY_MAX_INR || 5000),
    timezone: process.env.APP_TIMEZONE || 'Asia/Kolkata',
    expenseCategories: DEFAULT_EXPENSE_CATEGORIES.map((c) => ({ ...c })),
  };
}

let cache = null;

function fmtInr(n) {
  return `₹${Number(n).toLocaleString('en-IN')}`;
}

function buildApprovalRoutingNote(settings) {
  const pm = settings.poPmMaxInr;
  const coord = settings.poCoordinatorMaxInr;
  return `Under ${fmtInr(pm)} → Project Manager · ${fmtInr(pm)}–${fmtInr(coord)} → Coordinator · Above ${fmtInr(coord)} → Chairman (Coordinator may approve with written reason if Chairman not on premises).`;
}

function serialize(doc) {
  const base = doc ? doc.toObject() : envDefaults();
  const settings = {
    poPmMaxInr: base.poPmMaxInr ?? envDefaults().poPmMaxInr,
    poCoordinatorMaxInr: base.poCoordinatorMaxInr ?? envDefaults().poCoordinatorMaxInr,
    mrPmDailyMaxInr: base.mrPmDailyMaxInr ?? envDefaults().mrPmDailyMaxInr,
    timezone: base.timezone || envDefaults().timezone,
    expenseCategories:
      base.expenseCategories?.length > 0
        ? base.expenseCategories
        : envDefaults().expenseCategories,
    updatedAt: base.updatedAt?.toISOString?.() || base.updatedAt,
  };
  return {
    ...settings,
    approvalRoutingNote: buildApprovalRoutingNote(settings),
  };
}

function getSettings() {
  if (!cache) return serialize(null);
  return { ...cache };
}

async function loadOrgSettings() {
  let doc = await OrgSettings.findOne({ singleton: 'global' });
  if (!doc) {
    doc = await OrgSettings.create({ singleton: 'global', ...envDefaults() });
  } else if (!doc.expenseCategories?.length) {
    doc.expenseCategories = envDefaults().expenseCategories;
    await doc.save();
  }
  cache = serialize(doc);
  return cache;
}

async function updateOrgSettings(patch, actorUserId) {
  let doc = await OrgSettings.findOne({ singleton: 'global' });
  if (!doc) {
    doc = await OrgSettings.create({ singleton: 'global', ...envDefaults() });
  }

  if (patch.poPmMaxInr != null) doc.poPmMaxInr = Number(patch.poPmMaxInr);
  if (patch.poCoordinatorMaxInr != null) doc.poCoordinatorMaxInr = Number(patch.poCoordinatorMaxInr);
  if (patch.mrPmDailyMaxInr != null) doc.mrPmDailyMaxInr = Number(patch.mrPmDailyMaxInr);
  if (patch.timezone) doc.timezone = String(patch.timezone).trim();
  if (Array.isArray(patch.expenseCategories)) {
    doc.expenseCategories = patch.expenseCategories.map((row) => ({
      key: row.key,
      label: row.label,
      requiresPo: Boolean(row.requiresPo),
      pmMaxInr: Number(row.pmMaxInr) || 0,
      coordinatorMaxInr: Number(row.coordinatorMaxInr) || 0,
      description: row.description || '',
    }));
  }
  if (actorUserId) doc.updatedByUserId = actorUserId;
  await doc.save();
  cache = serialize(doc);
  return cache;
}

function getApprovalLimits() {
  const s = getSettings();
  return {
    poPmMaxInr: s.poPmMaxInr,
    poCoordinatorMaxInr: s.poCoordinatorMaxInr,
    mrPmDailyMaxInr: s.mrPmDailyMaxInr,
    approvalRoutingNote: s.approvalRoutingNote,
  };
}

module.exports = {
  DEFAULT_EXPENSE_CATEGORIES,
  envDefaults,
  loadOrgSettings,
  getSettings,
  getApprovalLimits,
  updateOrgSettings,
  buildApprovalRoutingNote,
};
