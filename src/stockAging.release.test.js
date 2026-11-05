const { test } = require('node:test');
const assert = require('node:assert/strict');
test('site-filtered aging does not count remaining batches twice', async () => {
  const { setupTestDb, teardownTestDb } = require('./test/helpers');
  const { Site, Material, StockLedger, StockBatch } = require('./models');
  const { getStockAging } = require('./services/fifoStockService');
  await setupTestDb();
  try {
    const site = await Site.findOne();
    const material = await Material.findOne();
    await StockLedger.deleteMany({ siteId: site._id, materialId: material._id });
    await StockBatch.deleteMany({ siteId: site._id, materialId: material._id });
    await StockLedger.create({ siteId: site._id, materialId: material._id, quantityOnHand: 10 });
    await StockBatch.create({ siteId: site._id, materialId: material._id, receivedAt: new Date(), qtyReceived: 4, qtyRemaining: 4 });
    const rows = await getStockAging({ siteIds: [site._id.toString()] });
    const selected = rows.filter((row) => row.itemCode === material.code);
    assert.equal(selected.reduce((sum, row) => sum + row.availableQuantity, 0), 10);
    assert.equal(selected.find((row) => row.source === 'OPENING').availableQuantity, 6);
  } finally { await teardownTestDb(); }
});
