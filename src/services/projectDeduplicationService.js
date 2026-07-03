const {
  Project,
  Site,
  MaterialRequest,
  PurchaseRequest,
  PurchaseOrder,
  WorkOrder,
  Incident,
  User,
} = require('../models');

const CANONICAL_CODE = /^PRJ-\d{3}$/i;

function pickCanonicalProject(duplicates) {
  const withCode = duplicates.find((p) => CANONICAL_CODE.test(p.code));
  if (withCode) return withCode;
  return duplicates.reduce((best, p) => {
    const bestScore = (best.budgetTotal || 0) + (best.budgetSpent || 0);
    const score = (p.budgetTotal || 0) + (p.budgetSpent || 0);
    return score >= bestScore ? p : best;
  });
}

async function reassignProjectRefs(fromId, toId) {
  await Promise.all([
    Site.updateMany({ projectId: fromId }, { projectId: toId }),
    MaterialRequest.updateMany({ projectId: fromId }, { projectId: toId }),
    PurchaseRequest.updateMany({ projectId: fromId }, { projectId: toId }),
    WorkOrder.updateMany({ projectId: fromId }, { projectId: toId }),
    Incident.updateMany({ projectId: fromId }, { projectId: toId }),
  ]);

  const users = await User.find({ assignedProjectIds: fromId });
  for (const user of users) {
    const next = user.assignedProjectIds
      .map((id) => (id.toString() === fromId.toString() ? toId : id))
      .filter((id, idx, arr) => arr.findIndex((x) => x.toString() === id.toString()) === idx);
    if (!next.some((id) => id.toString() === toId.toString())) {
      next.push(toId);
    }
    user.assignedProjectIds = next.filter((id) => id.toString() !== fromId.toString());
    await user.save();
  }
}

/**
 * Remove duplicate/orphan project records (same name, non-standard code, zero sites).
 */
async function dedupeProjects() {
  const projects = await Project.find().sort({ createdAt: 1 });
  const byName = new Map();

  for (const p of projects) {
    const key = (p.name || '').trim().toLowerCase();
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(p);
  }

  let removed = 0;

  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const canonical = pickCanonicalProject(group);
    for (const orphan of group) {
      if (orphan._id.toString() === canonical._id.toString()) continue;
      await reassignProjectRefs(orphan._id, canonical._id);
      await Project.deleteOne({ _id: orphan._id });
      removed += 1;
      console.log(`Removed duplicate project "${orphan.code}" → merged into ${canonical.code}`);
    }
  }

  const orphans = await Project.find({ code: { $not: CANONICAL_CODE } });
  for (const orphan of orphans) {
    const siteCount = await Site.countDocuments({ projectId: orphan._id });
    if (siteCount > 0) continue;
    const twin = await Project.findOne({
      _id: { $ne: orphan._id },
      name: new RegExp(`^${(orphan.name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
      code: CANONICAL_CODE,
    });
    if (!twin) continue;
    await reassignProjectRefs(orphan._id, twin._id);
    await Project.deleteOne({ _id: orphan._id });
    removed += 1;
    console.log(`Removed orphan project "${orphan.code}" → merged into ${twin.code}`);
  }

  if (removed) {
    console.log(`Project deduplication complete: ${removed} record(s) removed.`);
  }
}

module.exports = { dedupeProjects, CANONICAL_CODE };
