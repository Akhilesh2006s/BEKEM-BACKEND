const { MaterialCategory, Material, Project } = require('../models');

const PHASE_CATEGORIES = ['Raw Material', 'Consumables'];

const LEGACY_CATEGORY_MAP = {
  cement: 'Raw Material',
  steel: 'Raw Material',
  aggregates: 'Raw Material',
  bitumen: 'Raw Material',
  paving: 'Raw Material',
  fuel: 'Consumables',
  geosynthetics: 'Consumables',
  drainage: 'Consumables',
  fasteners: 'Consumables',
  hardware: 'Consumables',
  general: 'Consumables',
};

function mapLegacyCategory(value) {
  if (!value) return 'Consumables';
  const key = String(value).trim().toLowerCase();
  if (PHASE_CATEGORIES.some((c) => c.toLowerCase() === key)) return value.trim();
  return LEGACY_CATEGORY_MAP[key] || 'Consumables';
}

async function ensureMaterialCategories() {
  const rows = [];
  for (let i = 0; i < PHASE_CATEGORIES.length; i++) {
    const name = PHASE_CATEGORIES[i];
    const row = await MaterialCategory.findOneAndUpdate(
      { name },
      { $set: { name, isActive: true, sortOrder: i } },
      { upsert: true, new: true }
    );
    rows.push(row);
  }

  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
  const materials = await Material.find({}).select('category categoryId');
  for (const mat of materials) {
    const mappedName = mapLegacyCategory(mat.category);
    const cat = byName[mappedName] || byName['Consumables'];
    let changed = false;
    if (!mat.categoryId || mat.categoryId.toString() !== cat._id.toString()) {
      mat.categoryId = cat._id;
      changed = true;
    }
    if (mat.category !== cat.name) {
      mat.category = cat.name;
      changed = true;
    }
    if (changed) await mat.save();
  }

  return rows;
}

async function listMaterialCategories() {
  return MaterialCategory.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }).lean();
}

module.exports = {
  ensureMaterialCategories,
  listMaterialCategories,
  mapLegacyCategory,
  PHASE_CATEGORIES,
};
