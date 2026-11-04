/*
 * One-time synthetic data bootstrap for the specifically allocated Railway UAT.
 * No collection drops, deletes, mail, supplier actions, or credential output.
 * Never use seed.js against an existing or production database.
 */
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const PROJECT_ID = '84f45788-5efb-42e9-90d6-7f0271dfaa25';
const ENVIRONMENT_ID = '8d043713-75d1-42eb-9cf7-26e67ccc5051';
const DATABASE = 'bekem_uat';
const MARKER = 'isolated-uat-v1';
const ACCOUNT_SPECS = [
  ['SITE_INCHARGE', 'site', 'UAT_SITE_PASSWORD'],
  ['STORE_INCHARGE', 'store', 'UAT_STORE_PASSWORD'],
  ['PROJECT_MANAGER', 'pm', 'UAT_PM_PASSWORD'],
  ['PROJECT_MANAGER', 'pm2', 'UAT_PM2_PASSWORD'],
  ['EXECUTIVE', 'executive', 'UAT_EXECUTIVE_PASSWORD'],
  ['COORDINATOR', 'coordinator', 'UAT_COORDINATOR_PASSWORD'],
  ['CHAIRMAN', 'chairman', 'UAT_CHAIRMAN_PASSWORD'],
];

function validateEnvironment(env = process.env) {
  if (env.UAT_BOOTSTRAP !== 'CONFIRM_ISOLATED_BEKEM_UAT') throw new Error('Explicit isolated UAT bootstrap flag missing');
  if (env.RAILWAY_PROJECT_ID !== PROJECT_ID || env.RAILWAY_ENVIRONMENT_ID !== ENVIRONMENT_ID) throw new Error('Not the designated Railway UAT project and environment');
  let uri;
  try { uri = new URL(env.MONGO_URI); } catch { throw new Error('Invalid UAT MongoDB URI'); }
  if (uri.protocol !== 'mongodb:' || !uri.hostname.endsWith('.railway.internal') || uri.pathname !== `/${DATABASE}` || uri.searchParams.get('directConnection') !== 'true') {
    throw new Error('MongoDB URI must use the isolated Railway private host, bekem_uat database, and directConnection=true');
  }
  const passwords = ACCOUNT_SPECS.map(([, , key]) => env[key] || '');
  if (passwords.some((password) => password.length < 20) || new Set(passwords).size !== passwords.length) throw new Error('Every synthetic account needs a distinct password of at least 20 characters');
  return uri;
}

async function getOrCreate(Model, filter, data) {
  const existing = await Model.findOne(filter);
  if (existing) return existing;
  return Model.create(data);
}

async function bootstrap() {
  validateEnvironment();
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, serverSelectionTimeoutMS: 15000 });
  if (mongoose.connection.name !== DATABASE) throw new Error('Unexpected database name');
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName || !hello.logicalSessionTimeoutMinutes) throw new Error('A transaction-capable replica set is required');
  const collections = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray();
  const names = collections.map((c) => c.name).filter((name) => !name.startsWith('system.'));
  if (names.length && !names.includes('uat_bootstrap_markers')) throw new Error('Database is not empty and does not carry the UAT bootstrap marker');
  const markers = mongoose.connection.db.collection('uat_bootstrap_markers');
  const marker = await markers.findOne({ _id: MARKER });
  if (!marker && names.length) throw new Error('Expected UAT marker missing');
  if (!marker) await markers.insertOne({ _id: MARKER, projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, createdAt: new Date() });
  else if (marker.projectId !== PROJECT_ID || marker.environmentId !== ENVIRONMENT_ID) throw new Error('UAT marker identity mismatch');

  const models = require('../models');
  // createIndexes is additive; unlike syncIndexes it does not remove existing indexes.
  for (const model of Object.values(models)) await model.createIndexes();

  const indentCategories = [];
  for (const [i, name] of ['Civil', 'Electrical', 'Mechanical', 'Others'].entries()) {
    indentCategories.push(await getOrCreate(models.IndentCategory, { name }, { name, sortOrder: i + 1, isActive: true }));
  }
  const materialCategory = await getOrCreate(models.MaterialCategory, { name: 'Civil Materials' }, { name: 'Civil Materials', isActive: true });
  const projects = [];
  const sites = [];
  for (const number of [1, 2]) {
    const code = `UAT-PROJECT-${number}`;
    const project = await getOrCreate(models.Project, { code }, { code, name: `UAT Synthetic Project ${number}`, location: 'Acceptance test', startDate: new Date('2026-01-01'), targetEndDate: new Date('2030-12-31'), status: 'ACTIVE' });
    const site = await getOrCreate(models.Site, { projectId: project._id, name: `UAT Synthetic Site ${number}` }, { projectId: project._id, name: `UAT Synthetic Site ${number}`, chainageLabel: `UAT ${number}` });
    projects.push(project); sites.push(site);
  }
  for (const [role, handle, secretName] of ACCOUNT_SPECS) {
    const email = `${handle}.uat@example.invalid`;
    const existing = await models.User.findOne({ email });
    if (existing) {
      if (existing.role !== role) throw new Error(`Existing synthetic account has unexpected role: ${handle}`);
      continue;
    }
    const ownProject = handle === 'pm2' ? projects[1] : projects[0];
    const singleSite = role === 'SITE_INCHARGE' || role === 'STORE_INCHARGE';
    await models.User.create({
      name: `UAT ${handle}`, email, role,
      passwordHash: await bcrypt.hash(process.env[secretName], 12),
      assignedProjectIds: singleSite || role === 'PROJECT_MANAGER' ? [ownProject._id] : projects.map((p) => p._id),
      assignedSiteId: singleSite ? sites[0]._id : null,
      assignedIndentCategoryIds: role === 'EXECUTIVE' ? indentCategories.map((c) => c._id) : [],
      isSystemAdmin: role === 'CHAIRMAN',
    });
  }
  for (const item of [
    { code: 'UAT-CEMENT', name: 'UAT Cement', unit: 'Bags', referenceUnitPrice: 400 },
    { code: 'UAT-STEEL', name: 'UAT Steel', unit: 'Nos', referenceUnitPrice: 120 },
  ]) await getOrCreate(models.Material, { code: item.code }, { ...item, category: materialCategory.name, categoryId: materialCategory._id, isActive: true });
  for (const code of ['UAT-VENDOR-1', 'UAT-VENDOR-2']) {
    await getOrCreate(models.Vendor, { code }, { code, name: `Synthetic ${code}`, email: `${code.toLowerCase()}@example.invalid`, isActive: true, authorizationStatus: 'AUTHORIZED', category: 'Civil Materials' });
  }
  console.log('UAT bootstrap completed: synthetic records and declared indexes created; existing records preserved.');
}

if (require.main === module) {
  bootstrap().catch((error) => { console.error(`UAT bootstrap failed: ${error.message}`); process.exitCode = 1; }).finally(() => mongoose.disconnect());
}
module.exports = { validateEnvironment, bootstrap };
