const {
  StockInventoryRecord,
  Project,
  Site,
  Vendor,
  Material,
  User,
  PurchaseOrder,
  PurchaseRequest,
  MaterialRequest,
  RFQ,
  Quotation,
  StockLedger,
  StockMovement,
  GoodsReceiptNote,
  DeliveryVerification,
  MaterialIssue,
  BranchTransfer,
  WorkOrder,
  Incident,
  StatusHistory,
  Notification,
} = require('../models');
const {
  projectShortCode,
  vendorShortCode,
  materialCodeFromItem,
  ensureUniqueCode,
} = require('./codeGenerators');
const { normalizeName } = require('./materialDedupService');
const { getFinancialYear } = require('./procurementReferenceService');

/**
 * Wipe demo / live procurement catalog, then rebuild projects, vendors,
 * materials, and sites from Stock Inventory (real PO index data).
 */
async function syncMasterDataFromInventory({ financialYear = '25-26', clearProcurement = true } = {}) {
  const records = await StockInventoryRecord.find({ financialYear }).lean();
  if (!records.length) {
    return { projects: 0, vendors: 0, materials: 0, sites: 0, cleared: false };
  }

  if (clearProcurement) {
    await Promise.all([
      PurchaseOrder.deleteMany({}),
      PurchaseRequest.deleteMany({}),
      MaterialRequest.deleteMany({}),
      RFQ.deleteMany({}),
      Quotation.deleteMany({}),
      StockLedger.deleteMany({}),
      StockMovement.deleteMany({}),
      GoodsReceiptNote.deleteMany({}),
      DeliveryVerification.deleteMany({}),
      MaterialIssue.deleteMany({}),
      BranchTransfer.deleteMany({}),
      WorkOrder.deleteMany({}),
      Incident.deleteMany({}),
      StatusHistory.deleteMany({}),
      Notification.deleteMany({}),
    ]);
    await Promise.all([Material.deleteMany({}), Vendor.deleteMany({}), Site.deleteMany({}), Project.deleteMany({})]);
  }

  const projectNames = [...new Set(records.map((r) => r.project).filter(Boolean))].sort();
  const supplierNames = [...new Set(records.map((r) => r.supplier).filter(Boolean))].sort();

  const usedProjectCodes = new Set();
  const projectByName = new Map();
  const now = new Date();
  const startDate = new Date(`${2000 + parseInt(financialYear.slice(0, 2), 10)}-04-01`);
  const endDate = new Date(`${2000 + parseInt(financialYear.slice(3, 5), 10)}-03-31`);

  for (const name of projectNames) {
    const code = ensureUniqueCode(projectShortCode(name), usedProjectCodes);
    const project = await Project.create({
      code,
      name,
      location: name,
      status: 'ACTIVE',
      startDate,
      targetEndDate: endDate,
      budgetTotal: 0,
      budgetSpent: 0,
      healthScore: 100,
    });
    projectByName.set(name, project);

    await Site.create({
      projectId: project._id,
      name: `${name} — Main Store`,
      chainageLabel: `FY ${getFinancialYear()}`,
    });
  }

  const usedVendorCodes = new Set();
  const vendorByName = new Map();
  for (const name of supplierNames) {
    const code = ensureUniqueCode(vendorShortCode(name), usedVendorCodes);
    const vendor = await Vendor.create({
      name,
      code,
      address: '',
      category: 'General',
      suppliedCategories: ['General'],
      materialIds: [],
      rating: 0,
      isActive: true,
    });
    vendorByName.set(name, vendor);
  }

  const usedMaterialCodes = new Set();
  const materialPayloads = [];
  const materialKeys = [];
  const seenMaterialKeys = new Set();
  for (const r of records) {
    const key = normalizeName(r.itemDescription || r.itemCode);
    if (!key || seenMaterialKeys.has(key)) continue;
    seenMaterialKeys.add(key);
    materialKeys.push(key);
    const base = materialCodeFromItem(r.itemCode, r.itemDescription);
    const code = ensureUniqueCode(base, usedMaterialCodes);
    const name = (r.itemCode || r.itemDescription || code).slice(0, 120);
    materialPayloads.push({
      code,
      name,
      description: r.itemDescription || '',
      unit: r.units || 'Nos',
      category: 'General',
      isActive: true,
    });
  }

  const materialKeyToDoc = new Map();
  const MAT_BATCH = 500;
  for (let i = 0; i < materialPayloads.length; i += MAT_BATCH) {
    const batch = materialPayloads.slice(i, i + MAT_BATCH);
    const keys = materialKeys.slice(i, i + MAT_BATCH);
    const created = await Material.insertMany(batch, { ordered: false });
    created.forEach((mat, idx) => materialKeyToDoc.set(keys[idx], mat));
  }

  // Link vendors to materials they supplied in the index
  const vendorMaterials = new Map();
  for (const r of records) {
    if (!r.supplier) continue;
    const vendor = vendorByName.get(r.supplier);
    if (!vendor) continue;
    const key = `${(r.itemCode || '').toUpperCase()}||${(r.itemDescription || '').toUpperCase()}`;
    const mat = materialKeyToDoc.get(key);
    if (!mat) continue;
    if (!vendorMaterials.has(vendor._id.toString())) {
      vendorMaterials.set(vendor._id.toString(), new Set());
    }
    vendorMaterials.get(vendor._id.toString()).add(mat._id.toString());
  }

  for (const [vendorId, matIds] of vendorMaterials) {
    await Vendor.updateOne(
      { _id: vendorId },
      { $set: { materialIds: [...matIds] } }
    );
  }

  const projects = [...projectByName.values()];
  const projectIds = projects.map((p) => p._id);
  const firstSite = await Site.findOne({ projectId: projectIds[0] }).sort({ createdAt: 1 });

  // Site Manager / Project Manager: one project. Store Manager: site project only.
  // Executive / Coordinator / Chairman: all projects.
  const firstProjectId = projectIds[0] ? [projectIds[0]] : [];
  await User.updateMany(
    { role: { $in: ['PROJECT_MANAGER', 'SITE_INCHARGE'] } },
    { $set: { assignedProjectIds: firstProjectId } }
  );
  await User.updateMany(
    { role: { $in: ['COORDINATOR', 'CHAIRMAN', 'EXECUTIVE'] } },
    { $set: { assignedProjectIds: projectIds } }
  );
  if (firstSite) {
    await User.updateMany(
      { role: { $in: ['SITE_INCHARGE', 'STORE_INCHARGE'] } },
      { $set: { assignedSiteId: firstSite._id } }
    );
    await User.updateMany(
      { role: 'STORE_INCHARGE' },
      { $set: { assignedProjectIds: [firstSite.projectId] } }
    );
  }

  const stockLedgers = await buildStockLedgersFromRecords(records, {
    materialKeyToDoc,
    projectByName,
  });

  return {
    projects: projects.length,
    vendors: vendorByName.size,
    materials: materialKeyToDoc.size,
    sites: projects.length,
    stockLedgers,
    cleared: clearProcurement,
    samplePoFormat: projects[0] && vendorByName.size
      ? `BEKEM-${projects[0].code}/${[...vendorByName.values()][0].code}/0001-1/${financialYear}`
      : null,
  };
}

function inventoryQty(r) {
  let qty = Number(r.qty) || 0;
  if (!qty && r.qtyAvailable != null && r.qtyAvailable !== '') {
    const n = parseFloat(String(r.qtyAvailable).replace(/[^0-9.-]/g, ''));
    if (Number.isFinite(n) && n > 0) qty = n;
  }
  if (!qty) qty = Number(r.qtyBalance) || 0;
  if (!qty) qty = Number(r.qtyReceived) || 0;
  return qty > 0 ? qty : 0;
}

/**
 * Sum inventory QTY per material × project site into StockLedger (live catalog stock).
 */
async function buildStockLedgersFromRecords(records, { materialKeyToDoc, projectByName }) {
  const siteByProjectId = new Map();
  for (const project of projectByName.values()) {
    const site = await Site.findOne({ projectId: project._id }).sort({ createdAt: 1 });
    if (site) siteByProjectId.set(project._id.toString(), site);
  }

  const stockMap = new Map();
  for (const r of records) {
    const key = `${(r.itemCode || '').toUpperCase()}||${(r.itemDescription || '').toUpperCase()}`;
    const mat = materialKeyToDoc.get(key);
    const project = projectByName.get(r.project);
    if (!mat || !project) continue;
    const site = siteByProjectId.get(project._id.toString());
    if (!site) continue;
    const qty = inventoryQty(r);
    if (qty <= 0) continue;
    const mapKey = `${mat._id.toString()}|${site._id.toString()}`;
    stockMap.set(mapKey, (stockMap.get(mapKey) || 0) + qty);
  }

  const ledgerDocs = [];
  for (const [mapKey, qty] of stockMap) {
    const [materialId, siteId] = mapKey.split('|');
    ledgerDocs.push({
      siteId,
      materialId,
      quantityOnHand: qty,
      lowStockThreshold: 10,
      lastMovementAt: new Date(),
    });
  }

  const BATCH = 500;
  for (let i = 0; i < ledgerDocs.length; i += BATCH) {
    await StockLedger.insertMany(ledgerDocs.slice(i, i + BATCH), { ordered: false });
  }
  return ledgerDocs.length;
}

/**
 * Backfill StockLedger from existing inventory + materials (no full re-import).
 * Stock qty = sum of inventory line QTY per product per project site.
 */
async function backfillStockFromInventory({ financialYear = '25-26' } = {}) {
  const records = await StockInventoryRecord.find({ financialYear }).lean();
  if (!records.length) return { ledgers: 0 };

  const materials = await Material.find({ isActive: { $ne: false } }).lean();
  /** Same key used when materials were created from inventory rows. */
  const byImportKey = new Map();
  for (const m of materials) {
    const name = String(m.name || '').toUpperCase();
    const desc = String(m.description || '').toUpperCase();
    byImportKey.set(`${name}||${desc}`, m);
    if (m.code) byImportKey.set(`${String(m.code).toUpperCase()}||${desc}`, m);
  }

  const projects = await Project.find().lean();
  const projectByName = new Map(projects.map((p) => [p.name, p]));
  const siteByProjectId = new Map();
  for (const p of projects) {
    const site = await Site.findOne({ projectId: p._id }).sort({ createdAt: 1 });
    if (site) siteByProjectId.set(p._id.toString(), site);
  }

  const stockMap = new Map();
  for (const r of records) {
    const itemCode = String(r.itemCode || '').toUpperCase();
    const itemDesc = String(r.itemDescription || '').toUpperCase();
    const name = (itemCode || itemDesc).slice(0, 120);
    const codeKey = materialCodeFromItem(r.itemCode, r.itemDescription).toUpperCase();
    const mat =
      byImportKey.get(`${name}||${itemDesc}`) ||
      byImportKey.get(`${codeKey}||${itemDesc}`) ||
      byImportKey.get(`${itemCode}||${itemDesc}`);
    if (!mat) continue;

    const project = projectByName.get(r.project);
    if (!project) continue;
    const site = siteByProjectId.get(project._id.toString());
    if (!site) continue;

    const qty = inventoryQty(r);
    if (qty <= 0) continue;
    const mapKey = `${mat._id.toString()}|${site._id.toString()}`;
    stockMap.set(mapKey, (stockMap.get(mapKey) || 0) + qty);
  }

  await StockLedger.deleteMany({});
  const ledgerDocs = [];
  for (const [mapKey, qty] of stockMap) {
    const [materialId, siteId] = mapKey.split('|');
    ledgerDocs.push({
      siteId,
      materialId,
      quantityOnHand: qty,
      lowStockThreshold: 10,
      lastMovementAt: new Date(),
    });
  }

  const BATCH = 500;
  for (let i = 0; i < ledgerDocs.length; i += BATCH) {
    await StockLedger.insertMany(ledgerDocs.slice(i, i + BATCH), { ordered: false });
  }

  return { ledgers: ledgerDocs.length, materialsMatched: stockMap.size };
}

module.exports = {
  syncMasterDataFromInventory,
  backfillStockFromInventory,
};
