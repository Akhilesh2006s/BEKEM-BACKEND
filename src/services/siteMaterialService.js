const { Material } = require('../models');
const { findMaterialDuplicate, normalizeName } = require('./materialDedupService');
const { materialCodeFromItem, ensureUniqueCode } = require('./codeGenerators');
const { mapLegacyCategory, resolveMaterialCategory, ensureMaterialCategories } = require('./materialCategoryService');

const DEFAULT_SITE_HSN = '99999999';
const DEFAULT_GST_RATE = 18;

async function loadUsedMaterialCodes() {
  return new Set(
    (await Material.find().select('code').lean()).map((m) => String(m.code).toUpperCase())
  );
}

/**
 * Find an existing Material Master row or create one for site indent requests.
 * Returns { material, created, reused }.
 */
async function createOrResolveSiteMaterial({
  name,
  unit,
  category,
  categoryRemarks,
  description,
  createdByUserId,
}) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) {
    const err = new Error('Material name is required');
    err.statusCode = 400;
    throw err;
  }

  const lineUnit = String(unit || 'Nos').trim() || 'Nos';
  const mappedCategory = mapLegacyCategory(category || 'Civil Materials');
  const trimmedDescription = String(description || '').trim();
  const { assertCategoryRemarks } = require('./materialCategoryService');
  assertCategoryRemarks(mappedCategory, categoryRemarks);

  await ensureMaterialCategories();

  const duplicate = await findMaterialDuplicate({ name: trimmedName });
  if (duplicate && duplicate.isActive !== false) {
    return { material: duplicate, created: false, reused: true };
  }

  const usedCodes = await loadUsedMaterialCodes();
  const code = ensureUniqueCode(
    materialCodeFromItem(trimmedName, trimmedName).slice(0, 36) || 'SITE-REQ',
    usedCodes
  );

  let categoryDoc;
  try {
    categoryDoc = await resolveMaterialCategory({ category: mappedCategory });
  } catch {
    categoryDoc = await resolveMaterialCategory({ category: 'Civil Materials' });
  }

  const material = await Material.create({
    code,
    name: trimmedName,
    unit: lineUnit,
    category: categoryDoc.name,
    categoryId: categoryDoc._id,
    categoryRemarks:
      categoryDoc.name === 'Others' ? String(categoryRemarks || '').trim() : '',
    description:
      trimmedDescription ||
      'Added from site indent — pending store/PO classification',
    hsnCode: DEFAULT_SITE_HSN,
    gstRate: DEFAULT_GST_RATE,
    isActive: true,
    createdByUserId: createdByUserId || undefined,
  });

  return { material, created: true, reused: false };
}

/** Resolve indent line items — catalog ids or legacy custom names. */
async function resolveIndentLineItems(rawItems, { createdByUserId } = {}) {
  const resolved = [];

  for (const item of rawItems) {
    const qty = Number(item.quantityRequested);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const unit = String(item.unit || 'Nos').trim() || 'Nos';

    if (item.materialId) {
      const catalog = await Material.findById(item.materialId).select('unit isActive');
      if (!catalog || catalog.isActive === false) {
        const err = new Error('Material not found in catalog');
        err.statusCode = 400;
        throw err;
      }
      resolved.push({
        materialId: item.materialId,
        quantityRequested: qty,
        unit: unit || catalog.unit || 'Nos',
      });
      continue;
    }

    const name = String(item.customName || item.name || '').trim();
    if (!name) continue;

    const { material } = await createOrResolveSiteMaterial({
      name,
      unit,
      category: item.category,
      description: item.description,
      createdByUserId,
    });

    resolved.push({ materialId: material._id, quantityRequested: qty, unit });
  }

  return resolved;
}

module.exports = {
  DEFAULT_SITE_HSN,
  createOrResolveSiteMaterial,
  resolveIndentLineItems,
  normalizeName,
};
