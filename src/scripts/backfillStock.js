require('dotenv').config();
const mongoose = require('mongoose');
const { connectMongo } = require('../db/connectMongo');
const { backfillStockFromInventory } = require('../services/syncMasterDataFromInventory');
const { StockLedger } = require('../models');

async function main() {
  await connectMongo();
  const result = await backfillStockFromInventory();
  const n = await StockLedger.countDocuments();
  const sum = await StockLedger.aggregate([
    { $group: { _id: null, total: { $sum: '$quantityOnHand' } } },
  ]);
  console.log(result);
  console.log('Ledger rows:', n, 'Total qty on hand:', sum[0]?.total ?? 0);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
