/**
 * Backfill StockBatch lots from historical GoodsReceiptNote lines (Req 55–57).
 * Safe to re-run: skips GRNs that already have batches.
 *
 * Usage: node src/scripts/backfillStockBatches.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const { GoodsReceiptNote, StockBatch } = require('../models');

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/afios';
  await mongoose.connect(uri);

  const grns = await GoodsReceiptNote.find({
    status: { $nin: ['DRAFT', 'ON_HOLD', 'REJECTED'] },
  }).lean();

  let created = 0;
  let skipped = 0;

  for (const grn of grns) {
    const existing = await StockBatch.countDocuments({ grnId: grn._id });
    if (existing > 0) {
      skipped += 1;
      continue;
    }

    const receivedAt = grn.receivedAt || grn.deliveryDate || grn.createdAt || new Date();
    for (const item of grn.items || []) {
      const qty = Number(item.quantityReceived) || 0;
      if (qty <= 0) continue;
      await StockBatch.create({
        siteId: grn.siteId,
        materialId: item.materialId,
        grnId: grn._id,
        grnNumber: grn.grnNumber || '',
        receivedAt,
        qtyReceived: qty,
        qtyRemaining: qty,
      });
      created += 1;
    }
  }

  console.log(`StockBatch backfill complete: created=${created} grnsSkipped=${skipped} scanned=${grns.length}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
