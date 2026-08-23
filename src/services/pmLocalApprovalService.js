const { enrichIndentWithStock } = require('./indentStockService');
const { estimateIndentAmount } = require('./purchaseRequestService');
const { checkPmCanApprove } = require('./pmApprovalCapService');
const { indentExceedsPmApprovalLevel } = require('./indentApprovalRouting');
const { evaluateIndentBranchTransfer } = require('./pmCrossProjectStockService');

const PM_USE_BRANCH_TRANSFER_MESSAGE =
  'Current project stock plus other assigned projects can cover this indent. Request a Branch Transfer, or forward to HO — Executive will decide.';

function snapshotStock(stockContext) {
  return (stockContext?.stockByLine || []).map((s) => ({
    materialId: s.materialId,
    requestedQty: Number(s.requestedQty || 0),
    availableQty: Number(s.availableQty || 0),
  }));
}

function buildPmApprovalState(decision, capCheck, stockContext) {
  return {
    decision,
    dailyApprovedTotal: capCheck.dailyApprovedTotal,
    dailyCap: capCheck.dailyCap,
    remaining: capCheck.remaining,
    stockByLine: snapshotStock(stockContext),
  };
}

/**
 * PM sequential approval: use CURRENT ledger (after prior PM local closes)
 * and the running ₹/day cap. Store-level checks must not call this.
 *
 * Decision order:
 * 1. Per-indent PM approval level (existing)
 * 2. Current available stock vs this indent
 * 3. Combined current + other-project stock → branch transfer if it can fulfill
 * 4. Remaining daily cap vs this indent's value
 */
async function evaluatePmLocalApproval(pmUserId, mr, pmUser) {
  if (!mr.estimatedValue) {
    mr.estimatedValue = await estimateIndentAmount(mr);
  }
  const stockContext = await enrichIndentWithStock(mr);
  const capCheck = await checkPmCanApprove(pmUserId, mr);
  const exceedsLevel = indentExceedsPmApprovalLevel(mr.estimatedValue, mr.indentRequestType);

  if (exceedsLevel) {
    return { decision: 'APPROVAL_LEVEL', stockContext, capCheck };
  }
  if (!stockContext.canFullyIssue) {
    const pmStockDecision = await evaluateIndentBranchTransfer(mr, pmUser, stockContext);
    if (pmStockDecision.branchTransferViable) {
      return { decision: 'USE_BRANCH_TRANSFER', stockContext, capCheck, pmStockDecision };
    }
    return { decision: 'FORWARDED_STOCK', stockContext, capCheck, pmStockDecision };
  }
  if (mr.indentRequestType !== 'BELOW_5000' && capCheck.wouldExceed) {
    return { decision: 'FORWARDED_DAILY_CAP', stockContext, capCheck };
  }
  return { decision: 'CLOSED_LOCAL', stockContext, capCheck };
}

module.exports = {
  evaluatePmLocalApproval,
  buildPmApprovalState,
  snapshotStock,
  PM_USE_BRANCH_TRANSFER_MESSAGE,
};
