const mongoose = require('mongoose');
const {
  Material,
  StockLedger,
  StockMovement,
  PurchaseOrder,
  BranchTransfer,
  MaterialRequest,
  Vendor,
} = require('../models');

function normalizeName(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

async function findMaterialDuplicate({ code, name, hsnCode, excludeId }) {
  const clauses = [];
  const normalizedCode = String(code || '').trim().toUpperCase();
  const normalizedName = normalizeName(name);
  const normalizedHsn = String(hsnCode || '').trim();

  if (normalizedCode) {
    clauses.push({ code: normalizedCode });
  }
  if (normalizedName) {
    clauses.push({ name: new RegExp(`^${normalizedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
  }
  if (normalizedHsn && normalizedName) {
    clauses.push({
      hsnCode: normalizedHsn,
      name: new RegExp(`^${normalizedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
    });
  }

  if (!clauses.length) return null;

  const filter = {
    isActive: { $ne: false },
    $or: clauses,
  };
  if (excludeId) {
    filter._id = { $ne: excludeId };
  }

  return Material.findOne(filter);
}

async function reassignMaterialReferences(fromId, toId) {
  const from = fromId.toString();
  const to = toId.toString();

  await StockLedger.updateMany({ materialId: from }, { $set: { materialId: to } });
  await StockMovement.updateMany({ materialId: from }, { $set: { materialId: to } });

  await MaterialRequest.updateMany({ materialId: from }, { $set: { materialId: to } });
  await MaterialRequest.updateMany(
    { 'items.materialId': from },
    { $set: { 'items.$[elem].materialId': to } },
    { arrayFilters: [{ 'elem.materialId': new mongoose.Types.ObjectId(from) }] }
  );

  await PurchaseOrder.updateMany(
    { 'lineItems.materialId': from },
    { $set: { 'lineItems.$[elem].materialId': to } },
    { arrayFilters: [{ 'elem.materialId': new mongoose.Types.ObjectId(from) }] }
  );

  await BranchTransfer.updateMany(
    { 'items.materialId': from },
    { $set: { 'items.$[elem].materialId': to } },
    { arrayFilters: [{ 'elem.materialId': new mongoose.Types.ObjectId(from) }] }
  );

  const vendors = await Vendor.find({ materialIds: from });
  for (const vendor of vendors) {
    const ids = new Set((vendor.materialIds || []).map((id) => id.toString()));
    ids.delete(from);
    ids.add(to);
    vendor.materialIds = [...ids];
    await vendor.save();
  }
}

async function dedupeAllMaterials() {
  const materials = await Material.find({ isActive: { $ne: false } }).sort({ createdAt: 1 });
  const canonicalByName = new Map();
  let merged = 0;

  for (const mat of materials) {
    const key = normalizeName(mat.name);
    if (!key) continue;

    const canonical = canonicalByName.get(key);
    if (!canonical) {
      canonicalByName.set(key, mat);
      continue;
    }

    await reassignMaterialReferences(mat._id, canonical._id);
    mat.isActive = false;
    await mat.save();
    merged += 1;
  }

  return { merged, remaining: canonicalByName.size };
}

function dedupeMaterialSearchResults(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = normalizeName(row.name || row.description);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

module.exports = {
  normalizeName,
  findMaterialDuplicate,
  dedupeAllMaterials,
  dedupeMaterialSearchResults,
};
