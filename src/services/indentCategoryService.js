const { IndentCategory } = require('../models');

const DEFAULT_INDENT_CATEGORIES = [
  { name: 'Civil', sortOrder: 1 },
  { name: 'Electrical', sortOrder: 2 },
  { name: 'Mechanical', sortOrder: 3 },
  { name: 'Others', sortOrder: 4 },
];

async function ensureIndentCategories() {
  const general = await IndentCategory.findOne({ name: 'General' });
  const others = await IndentCategory.findOne({ name: 'Others' });
  if (general && !others) {
    general.name = 'Others';
    general.isActive = true;
    general.sortOrder = 4;
    await general.save();
  } else if (general && others) {
    general.isActive = false;
    await general.save();
  }

  for (const row of DEFAULT_INDENT_CATEGORIES) {
    await IndentCategory.findOneAndUpdate(
      { name: row.name },
      { $setOnInsert: { name: row.name, sortOrder: row.sortOrder, isActive: true } },
      { upsert: true, new: true }
    );
  }
}

async function listIndentCategories({ activeOnly = true } = {}) {
  await ensureIndentCategories();
  const filter = activeOnly ? { isActive: true } : {};
  return IndentCategory.find(filter).sort({ sortOrder: 1, name: 1 }).lean();
}

async function createIndentCategory({ name, sortOrder = 0 }) {
  const trimmed = name.trim();
  if (!trimmed) {
    const err = new Error('Category name is required');
    err.statusCode = 400;
    throw err;
  }
  const existing = await IndentCategory.findOne({ name: trimmed });
  if (existing) {
    const err = new Error('Category name already exists');
    err.statusCode = 409;
    throw err;
  }
  return IndentCategory.create({ name: trimmed, sortOrder, isActive: true });
}

async function updateIndentCategory(id, patch) {
  const row = await IndentCategory.findById(id);
  if (!row) {
    const err = new Error('Category not found');
    err.statusCode = 404;
    throw err;
  }
  if (patch.name != null) {
    const trimmed = patch.name.trim();
    if (!trimmed) {
      const err = new Error('Category name is required');
      err.statusCode = 400;
      throw err;
    }
    const duplicate = await IndentCategory.findOne({ name: trimmed, _id: { $ne: id } });
    if (duplicate) {
      const err = new Error('Category name already exists');
      err.statusCode = 409;
      throw err;
    }
    row.name = trimmed;
  }
  if (patch.isActive != null) row.isActive = !!patch.isActive;
  if (patch.sortOrder != null) row.sortOrder = Number(patch.sortOrder) || 0;
  await row.save();
  return row;
}

async function resolveIndentCategory(categoryId) {
  if (!categoryId) {
    const err = new Error('Indent category is required');
    err.statusCode = 400;
    throw err;
  }
  const cat = await IndentCategory.findOne({ _id: categoryId, isActive: true });
  if (!cat) {
    const err = new Error('Invalid indent category');
    err.statusCode = 400;
    throw err;
  }
  return cat;
}

function serializeIndentCategory(row) {
  return {
    id: row._id.toString(),
    name: row.name,
    isActive: row.isActive !== false,
    sortOrder: row.sortOrder || 0,
  };
}

module.exports = {
  DEFAULT_INDENT_CATEGORIES,
  ensureIndentCategories,
  listIndentCategories,
  createIndentCategory,
  updateIndentCategory,
  resolveIndentCategory,
  serializeIndentCategory,
};
