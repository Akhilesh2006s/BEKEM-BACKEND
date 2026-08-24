/**
 * Upsert second demo PM (pm2@bekem.com) on projects that pm@ does not own.
 * Safe to run on an existing Atlas DB without full reseed.
 *
 *   node src/scripts/ensureSecondPm.js
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { connectMongo } = require('../db/connectMongo');
const { User, Project } = require('../models');

const DEMO_PASSWORD = 'Bekem@Demo2026!';

async function main() {
  await connectMongo();
  const projects = await Project.find().sort({ createdAt: 1 }).select('_id code name');
  if (projects.length < 2) {
    console.error('Need at least 2 projects to assign a second PM');
    process.exit(1);
  }

  const primary = await User.findOne({ email: 'pm@bekem.com' });
  if (primary) {
    primary.assignedProjectIds = [projects[0]._id];
    await primary.save();
    console.log(`pm@bekem.com → ${projects[0].code}`);
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const otherIds = projects.slice(1).map((p) => p._id);
  const pm2 = await User.findOneAndUpdate(
    { email: 'pm2@bekem.com' },
    {
      $set: {
        name: 'Karthik Rao',
        email: 'pm2@bekem.com',
        role: 'PROJECT_MANAGER',
        passwordHash,
        assignedProjectIds: otherIds,
        avatarColor: '#0F766E',
        isActive: true,
      },
    },
    { upsert: true, new: true }
  );

  console.log(
    `pm2@bekem.com → ${projects
      .slice(1)
      .map((p) => p.code)
      .join(', ')}`
  );
  console.log(`Password: ${DEMO_PASSWORD}`);
  console.log(`User id: ${pm2._id}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
