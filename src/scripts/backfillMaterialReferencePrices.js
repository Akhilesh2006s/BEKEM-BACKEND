/**
 * Backfill Material.referenceUnitPrice from Stock Inventory unitRate
 * for materials that still show ₹0 on Below ₹5,000 indents.
 *
 * Usage: node src/scripts/backfillMaterialReferencePrices.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const { Material, StockInventoryRecord } = require('../models');

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/afios';
  await mongoose.connect(uri);

  const materials = await Material.find({
    $or: [{ referenceUnitPrice: null }, { referenceUnitPrice: { $lte: 0 } }, { referenceUnitPrice: { $exists: false } }],
  })
    .select('code name referenceUnitPrice')
    .lean();

  let updated = 0;
  let skipped = 0;

  for (const m of materials) {
    const code = String(m.code || '').trim();
    const name = String(m.name || '').trim();
    const or = [];
    if (code) or.push({ itemCode: code });
    if (name) or.push({ itemDescription: name });
    if (!or.length) {
      skipped += 1;
      continue;
    }

    const inv = await StockInventoryRecord.findOne({
      unitRate: { $gt: 0 },
      $or: or,
    })
      .sort({ poDate: -1, updatedAt: -1 })
      .select('unitRate')
      .lean();

    const rate = Number(inv?.unitRate);
    if (!(rate > 0)) {
      skipped += 1;
      continue;
    }

    await Material.updateOne({ _id: m._id }, { $set: { referenceUnitPrice: rate } });
    updated += 1;
  }

  console.log(`referenceUnitPrice backfill: updated=${updated} skipped=${skipped} scanned=${materials.length}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
