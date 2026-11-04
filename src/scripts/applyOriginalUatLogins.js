/* One-time, explicitly enabled change for the designated synthetic UAT only.
 * Uses existing users and preserves their IDs, role, project assignments and records.
 * Password is supplied privately through the environment and never logged.
 */
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const PROJECT_ID = '84f45788-5efb-42e9-90d6-7f0271dfaa25';
const ENVIRONMENT_ID = '8d043713-75d1-42eb-9cf7-26e67ccc5051';
const MARKER = 'isolated-uat-v1';
const ACCOUNTS = [
  ['site', 'SITE_INCHARGE', 'request@bekem.com'],
  ['store', 'STORE_INCHARGE', 'storeincharge@bekem.com'],
  ['pm', 'PROJECT_MANAGER', 'pm@bekem.com'],
  ['pm2', 'PROJECT_MANAGER', 'pm2@bekem.com'],
  ['executive', 'EXECUTIVE', 'executive@bekem.com'],
  ['coordinator', 'COORDINATOR', 'coordinator@bekem.com'],
  ['chairman', 'CHAIRMAN', 'chairman@bekem.com'],
];

function validateEnvironment(env = process.env) {
  if (env.UAT_APPLY_ORIGINAL_LOGINS !== 'CONFIRM_ISOLATED_BEKEM_UAT') throw new Error('UAT credential change flag missing');
  if (env.RAILWAY_PROJECT_ID !== PROJECT_ID || env.RAILWAY_ENVIRONMENT_ID !== ENVIRONMENT_ID) throw new Error('Not the designated Railway UAT environment');
  let uri;
  try { uri = new URL(env.MONGO_URI); } catch { throw new Error('Invalid UAT MongoDB URI'); }
  if (uri.protocol !== 'mongodb:' || !uri.hostname.endsWith('.railway.internal') || uri.pathname !== '/bekem_uat' || uri.searchParams.get('directConnection') !== 'true') throw new Error('Not the designated private UAT database');
  if (!env.UAT_DEMO_PASSWORD || env.UAT_DEMO_PASSWORD.length < 8) throw new Error('UAT demo password missing or too short');
}

async function applyOriginalUatLogins() {
  validateEnvironment();
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, serverSelectionTimeoutMS: 15000 });
  if (mongoose.connection.name !== 'bekem_uat') throw new Error('Unexpected database');
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName || !hello.logicalSessionTimeoutMinutes) throw new Error('Replica set required');
  const marker = await mongoose.connection.db.collection('uat_bootstrap_markers').findOne({ _id: MARKER });
  if (!marker || marker.projectId !== PROJECT_ID || marker.environmentId !== ENVIRONMENT_ID) throw new Error('UAT marker not found');
  const User = require('../models/User');
  const passwordHash = await bcrypt.hash(process.env.UAT_DEMO_PASSWORD, 12);
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const [handle, role, targetEmail] of ACCOUNTS) {
        const oldEmail = `${handle}.uat@example.invalid`;
        const candidates = await User.find({ email: { $in: [oldEmail, targetEmail] } }).session(session);
        if (candidates.length !== 1 || candidates[0].role !== role || candidates[0].name !== `UAT ${handle}`) throw new Error(`Missing account, unexpected role, or email collision: ${handle}`);
        const user = candidates[0];
        user.email = targetEmail;
        user.passwordHash = passwordHash;
        user.refreshToken = null;
        await user.save({ session });
      }
    });
  } finally { await session.endSession(); }
  console.log('Updated seven designated synthetic UAT logins; user IDs and assignments preserved.');
}

if (require.main === module) {
  applyOriginalUatLogins().catch((error) => { console.error(`UAT login update failed: ${error.message}`); process.exitCode = 1; }).finally(() => mongoose.disconnect());
}
module.exports = { validateEnvironment, applyOriginalUatLogins };
