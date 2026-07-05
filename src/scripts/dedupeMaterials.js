/**
 * Merge duplicate Material Master rows (same normalized name).
 * Run: node src/scripts/dedupeMaterials.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { dedupeAllMaterials } = require('../services/materialDedupService');

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const { merged, remaining } = await dedupeAllMaterials();
  console.log(`Merged ${merged} duplicate materials. ${remaining} unique names remain.`);
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main };
