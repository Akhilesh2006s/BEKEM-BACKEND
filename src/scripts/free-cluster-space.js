                                                                                                                                                                                                                                                          /**
 * Frees Atlas M0 collection quota by dropping a test database.
 * Run: node src/scripts/free-cluster-space.js
 */
require('dotenv').config();
const { connectMongo } = require('../db/connectMongo');
const mongoose = require('mongoose');

const DROP_DATABASES = ['DMS-test'];

async function main() {
  await connectMongo();
  const client = mongoose.connection.client;

  for (const name of DROP_DATABASES) {
    const db = client.db(name);
    const cols = await db.listCollections().toArray();
    if (!cols.length) {
      console.log(`Skip ${name} (empty or missing)`);
      continue;
    }
    await db.dropDatabase();
    console.log(`Dropped database "${name}" (${cols.length} collections)`);
  }

  await mongoose.disconnect();
  console.log('Done. Run: npm run seed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
