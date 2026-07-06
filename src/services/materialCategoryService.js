const { MaterialCategory, Material } = require('../models');

const PHASE_CATEGORIES = [
  'Stationery',
  'Electrical Materials',
  'Civil Materials',
  'Mechanical Materials',
  'Others',
];

const LEGACY_CATEGORY_MAP = {
  cement: 'Civil Materials',
  steel: 'Civil Materials',
  aggregates: 'Civil Materials',
  bitumen: 'Civil Materials',
  paving: 'Civil Materials',
  'raw material': 'Civil Materials',
  fuel: 'Mechanical Materials',
  geosynthetics: 'Mechanical Materials',
  drainage: 'Mechanical Materials',
  fasteners: 'Mechanical Materials',
  hardware: 'Mechanical Materials',
  mechanical: 'Mechanical Materials',
  electrical: 'Electrical Materials',
  'electrical materials': 'Electrical Materials',
  stationery: 'Stationery',
  consumables: 'Stationery',
  consumable: 'Stationery',
  general: 'Others',
  others: 'Others',
};

function mapLegacyCategory(value) {
  if (!value) return 'Civil Materials';
  const key = String(value).trim().toLowerCase();
  if (PHASE_CATEGORIES.some((c) => c.toLowerCase() === key)) {
    return PHASE_CATEGORIES.find((c) => c.toLowerCase() === key) || value.trim();
  }
  return LEGACY_CATEGORY_MAP[key] || 'Civil Materials';
}

function requiresCategoryRemarks(categoryName) {
  return String(categoryName || '').trim() === 'Others';
}

function assertCategoryRemarks(categoryName, remarks) {
  if (!requiresCategoryRemarks(categoryName)) return;
  const text = String(remarks || '').trim();
  if (!text) {
    const err = new Error('Remarks are required when category is Others');
    err.statusCode = 400;
    throw err;
  }
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

  await MaterialCategory.updateMany(
    { name: { $nin: PHASE_CATEGORIES } },
    { $set: { isActive: false } }
  );

  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
  const materials = await Material.find({}).select('category categoryId');
  for (const mat of materials) {
    const mappedName = mapLegacyCategory(mat.category);
    const cat = byName[mappedName] || byName['Civil Materials'];
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

async function resolveMaterialCategory({ categoryId, category }) {
  if (categoryId) {
    const cat = await MaterialCategory.findOne({ _id: categoryId, isActive: true });
    if (!cat) {
      const err = new Error('Invalid material category');
      err.statusCode = 400;
      throw err;
    }
    return cat;
  }
  const name = mapLegacyCategory(category);
  const cat = await MaterialCategory.findOne({ name, isActive: true });
  if (!cat) {
    const err = new Error('Invalid material category');
    err.statusCode = 400;
    throw err;
  }
  return cat;
}

module.exports = {
  ensureMaterialCategories,
  listMaterialCategories,
  mapLegacyCategory,
  resolveMaterialCategory,
  requiresCategoryRemarks,
  assertCategoryRemarks,
  PHASE_CATEGORIES,
};
