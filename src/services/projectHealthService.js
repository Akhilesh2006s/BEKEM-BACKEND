const { MaterialRequest, StockLedger, PurchaseOrder } = require('../models');

const MS_DAY = 24 * 60 * 60 * 1000;

/**
 * Composite project health (0–100) from real operational signals.
 * Avoids flat placeholder scores across all projects.
 */
async function computeProjectHealth(project) {
  const projectId = project._id;
  const now = Date.now();

  const [openIndents, lowStockCount, overduePos] = await Promise.all([
    MaterialRequest.countDocuments({
      projectId,
      status: {
        $in: ['PENDING_STORE', 'FORWARDED_TO_PM', 'PM_APPROVED', 'PURCHASE_REQUESTED', 'PO_CREATED'],
      },
    }),
    StockLedger.countDocuments({
      siteId: { $in: await getSiteIds(projectId) },
      $expr: { $lte: ['$quantityOnHand', '$lowStockThreshold'] },
    }),
    countOverduePosForProject(projectId),
  ]);

  let score = 100;

  if (openIndents > 0) score -= Math.min(25, openIndents * 3);
  if (lowStockCount > 0) score -= Math.min(30, lowStockCount * 5);
  if (overduePos > 0) score -= Math.min(20, overduePos * 4);

  const budgetTotal = project.budgetTotal || 0;
  const budgetSpent = project.budgetSpent || 0;
  if (budgetTotal > 0) {
    const burnPct = (budgetSpent / budgetTotal) * 100;
    if (burnPct > 95) score -= 15;
    else if (burnPct > 85) score -= 8;
  }

  const delayed = await MaterialRequest.countDocuments({
    projectId,
    requiredByDate: { $lt: new Date(now - MS_DAY) },
    status: { $nin: ['COMPLETED', 'CLOSED', 'REJECTED', 'CANCELLED'] },
  });
  if (delayed > 0) score -= Math.min(20, delayed * 5);

  return Math.max(0, Math.min(100, Math.round(score)));
}

async function getSiteIds(projectId) {
  const { Site } = require('../models');
  const sites = await Site.find({ projectId }).select('_id').lean();
  return sites.map((s) => s._id);
}

async function countOverduePosForProject(projectId) {
  const { PurchaseRequest } = require('../models');
  const prIds = await PurchaseRequest.find({ projectId }).select('_id').lean();
  if (!prIds.length) return 0;
  return PurchaseOrder.countDocuments({
    purchaseRequestId: { $in: prIds.map((p) => p._id) },
    status: 'APPROVED',
    fulfillmentStatus: { $ne: 'closed_complete' },
    expectedDeliveryDate: { $lt: new Date(), $ne: null },
  });
}

async function enrichProjectsWithHealth(projects) {
  return Promise.all(
    projects.map(async (p) => {
      const healthScore = await computeProjectHealth(p);
      const budgetTotal = p.budgetTotal || 0;
      const budgetSpent = p.budgetSpent || 0;
      return {
        ...p,
        healthScore,
        deployPct: budgetTotal > 0 ? Math.round((budgetSpent / budgetTotal) * 100) : null,
      };
    })
  );
}

module.exports = { computeProjectHealth, enrichProjectsWithHealth };
