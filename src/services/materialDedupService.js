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

function normalizeCode(code) {
  return String(code || '')
    .trim()
    .toUpperCase();
}

/** Prefer the best canonical row when multiple materials share a display name. */
function pickCanonicalMaterialByName(a, b) {
  const score = (m) => {
    const name = normalizeName(m.name);
    const code = normalizeCode(m.code);
    if (!code) return 1000;
    if (code === name.replace(/\s+/g, '') || code === name.toUpperCase()) return 0;
    if (code.startsWith(name.replace(/\s+/g, '').toUpperCase().slice(0, 3))) return 1;
    return 10 + code.length;
  };
  return score(a) <= score(b) ? a : b;
}

/**
 * Remove repeated rows (same id / item code). Optionally collapse same display name
 * for indent picker lists — keeps one canonical material per normalized name.
 */
function dedupeMaterialListResults(materials, { collapseDuplicateNames = false } = {}) {
  const byId = new Map();
  for (const m of materials) {
    const id = String(m.id || m._id || '');
    if (!id || byId.has(id)) continue;
    byId.set(id, m);
  }

  const byCode = new Map();
  for (const m of byId.values()) {
    const code = normalizeCode(m.code);
    if (!code) {
      byCode.set(`__id:${m.id || m._id}`, m);
      continue;
    }
    if (!byCode.has(code)) byCode.set(code, m);
  }

  let result = [...byCode.values()];

  if (collapseDuplicateNames) {
    const byName = new Map();
    for (const m of result) {
      const key = normalizeName(m.name);
      if (!key) continue;
      const prev = byName.get(key);
      byName.set(key, prev ? pickCanonicalMaterialByName(prev, m) : m);
    }
    result = [...byName.values()];
  }

  return annotateMaterialPickerLabels(result);
}

function annotateMaterialPickerLabels(materials) {
  const nameFreq = new Map();
  for (const m of materials) {
    const key = normalizeName(m.name);
    nameFreq.set(key, (nameFreq.get(key) || 0) + 1);
  }

  return materials.map((m) => {
    const ambiguous = (nameFreq.get(normalizeName(m.name)) || 0) > 1;
    const gradePart = m.grade ? ` · ${m.grade}` : '';
    const unit = m.unit || 'Nos';
    return {
      ...m,
      pickerSubtitle: ambiguous
        ? `Item Code: ${m.code} · ${unit}`
        : `${m.code}${gradePart} · ${unit}`,
    };
  });
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

    const keep = pickCanonicalMaterialByName(
      { name: canonical.name, code: canonical.code, _id: canonical._id },
      { name: mat.name, code: mat.code, _id: mat._id }
    );
    const drop = keep._id.toString() === canonical._id.toString() ? mat : canonical;
    const winner = keep._id.toString() === canonical._id.toString() ? canonical : mat;
    if (winner._id.toString() !== canonical._id.toString()) {
      canonicalByName.set(key, winner);
    }

    await reassignMaterialReferences(drop._id, winner._id);
    drop.isActive = false;
    await drop.save();
    merged += 1;
  }

  return { merged, remaining: canonicalByName.size };
}

function dedupeMaterialSearchResults(rows) {
  return dedupeMaterialListResults(rows, { collapseDuplicateNames: true }).map((row) => ({
    id: row.id,
    itemCode: row.itemCode || row.code,
    description: row.description || row.name,
    name: row.name,
    hsnCode: row.hsnCode || '',
    gstRate: row.gstRate ?? 18,
    unit: row.unit,
    category: row.category || '',
    unitPrice: row.unitPrice ?? null,
    referenceUnitPrice: row.referenceUnitPrice ?? null,
    pickerSubtitle: row.pickerSubtitle,
  }));
}

module.exports = {
  normalizeName,
  normalizeCode,
  findMaterialDuplicate,
  pickCanonicalMaterialByName,
  dedupeMaterialListResults,
  annotateMaterialPickerLabels,
  dedupeAllMaterials,
  dedupeMaterialSearchResults,
};
