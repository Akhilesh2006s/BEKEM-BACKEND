const dns = require('dns');
const mongoose = require('mongoose');

// Windows often fails Atlas SRV lookups with the system DNS resolver
dns.setServers(['8.8.8.8', '1.1.1.1']);
dns.setDefaultResultOrder('ipv4first');

async function connectMongo() {
  const uris = [process.env.MONGO_URI, process.env.MONGO_URI_DIRECT].filter(Boolean);
  let lastError;
  for (const uri of uris) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
      await repairPurchaseOrderIndexes();
      await backfillPurchaseRequestsForApprovedIndents();
      await repairBelowCapIndentsAwayFromHo();
      const { dedupeProjects } = require('../services/projectDeduplicationService');
      await dedupeProjects();
      await migrateBranchTransferStatuses();
      await enforceUserProjectAssignmentRules();
      await refreshSiteFiscalYearLabels();
      return;
    } catch (err) {
      lastError = err;
      console.warn(
        `MongoDB connect failed (${uri.startsWith('mongodb+srv') ? 'SRV' : 'direct'}):`,
        err.message
      );
    }
  }
  throw lastError;
}

async function repairPurchaseOrderIndexes() {
  try {
    const PurchaseOrder = require('../models/PurchaseOrder');
    await PurchaseOrder.collection.updateMany(
      { $or: [{ poNumber: null }, { poNumber: '' }] },
      { $unset: { poNumber: '' } }
    );
    await PurchaseOrder.syncIndexes();
  } catch (err) {
    console.warn('PurchaseOrder index repair skipped:', err.message);
  }
}

async function migrateBranchTransferStatuses() {
  try {
    const { BranchTransfer } = require('../models');
    const legacyMap = {
      PENDING_DESTINATION_PM: 'REQUESTED',
      PENDING_SOURCE_FINAL: 'PM_APPROVED',
      APPROVED: 'COORDINATOR_DECIDED',
      DISPATCHED: 'COORDINATOR_DECIDED',
      RECEIVED: 'TRANSFERRED',
      CANCELLED: 'REJECTED',
    };
    for (const [from, to] of Object.entries(legacyMap)) {
      const result = await BranchTransfer.updateMany({ status: from }, { $set: { status: to } });
      if (result.modifiedCount) {
        console.log(`Migrated ${result.modifiedCount} branch transfer(s) from ${from} to ${to}`);
      }
    }
  } catch (err) {
    console.warn('Branch transfer status migration skipped:', err.message);
  }
}

/** Keep site FY labels aligned with current Indian financial year (documents use the same). */
async function refreshSiteFiscalYearLabels() {
  try {
    const { getFinancialYear } = require('../services/procurementReferenceService');
    const { Site } = require('../models');
    const fy = getFinancialYear();
    const result = await Site.updateMany(
      { chainageLabel: { $regex: /^FY \d{2}-\d{2}$/ } },
      { $set: { chainageLabel: `FY ${fy}` } }
    );
    if (result.modifiedCount) {
      console.log(`Updated ${result.modifiedCount} site FY label(s) to FY ${fy}`);
    }
  } catch (err) {
    console.warn('Site FY label refresh skipped:', err.message);
  }
}

/** Apply role-based project assignment rules for all users. */
async function enforceUserProjectAssignmentRules() {
  try {
    const { UserRole } = require('@afios/shared');
    const { User } = require('../models');
    const { applyRoleAssignments } = require('../services/userAssignmentService');
    const users = await User.find({
      role: {
        $in: [
          UserRole.SITE_INCHARGE,
          UserRole.STORE_INCHARGE,
          UserRole.PROJECT_MANAGER,
          UserRole.EXECUTIVE,
          UserRole.COORDINATOR,
          UserRole.CHAIRMAN,
        ],
      },
    });
    let updated = 0;
    for (const user of users) {
      const before = (user.assignedProjectIds || []).map(String).join(',');
      await applyRoleAssignments(user, {
        assignedProjectIds: user.assignedProjectIds,
        assignedSiteId: user.assignedSiteId,
      });
      const after = (user.assignedProjectIds || []).map(String).join(',');
      if (before !== after || user.isModified()) {
        await user.save();
        updated += 1;
      }
    }
    if (updated) {
      console.log(`Applied project assignment rules for ${updated} user(s)`);
    }
  } catch (err) {
    console.warn('User project assignment migration skipped:', err.message);
  }
}

/** Indents approved before auto-PR: create missing purchase requests once. */
async function backfillPurchaseRequestsForApprovedIndents() {
  try {
    const { UserRole } = require('@afios/shared');
    const { MaterialRequest, PurchaseRequest, User } = require('../models');
    const { createPurchaseRequestForIndent } = require('../services/purchaseRequestService');

    // Only Above ₹5,000 indents need HO purchase requests. Below ₹5,000 stay with Store after PM.
    const stale = await MaterialRequest.find({
      status: 'PM_APPROVED',
      indentRequestType: { $ne: 'BELOW_5000' },
    }).select('_id');
    if (!stale.length) return;

    const pm = await User.findOne({ role: UserRole.PROJECT_MANAGER }).select('_id');
    if (!pm) return;

    for (const mr of stale) {
      const hasPr = await PurchaseRequest.exists({ materialRequestId: mr._id });
      if (hasPr) continue;
      const populated = await MaterialRequest.findById(mr._id)
        .populate('projectId')
        .populate('items.materialId');
      if (populated) {
        await createPurchaseRequestForIndent(populated, pm._id);
        console.log(`Backfilled purchase request for indent ${populated.indentNumber}`);
      }
    }
  } catch (err) {
    console.warn('PM_APPROVED PR backfill skipped:', err.message);
  }
}

/**
 * Below ₹5,000 must not sit in HO queues. Pull them back to Store after PM approval.
 */
async function repairBelowCapIndentsAwayFromHo() {
  try {
    const { MaterialRequest, PurchaseRequest } = require('../models');
    const statusHistoryService = require('../services/statusHistoryService');

    const misplaced = await MaterialRequest.find({
      indentRequestType: 'BELOW_5000',
      status: {
        $in: [
          'PENDING_HO',
          'PENDING_EXECUTIVE_DECISION',
          'PURCHASE_REQUESTED',
          'EXECUTIVE_DECISION_PO',
          'EXECUTIVE_DECISION_BRANCH_TRANSFER',
        ],
      },
    });

    for (const mr of misplaced) {
      const fromStatus = mr.status;
      mr.status = 'PM_APPROVED';
      mr.pendingWithRole = 'STORE_INCHARGE';
      mr.escalatedToHo = false;
      await mr.save();

      await PurchaseRequest.deleteMany({
        materialRequestId: mr._id,
        status: { $in: ['OPEN', 'DRAFT'] },
      });

      await statusHistoryService.record(
        'MaterialRequest',
        mr._id,
        fromStatus,
        'PM_APPROVED',
        null,
        'Auto-repair: Below ₹5,000 returned to Store (no HO procurement)'
      );
      console.log(`Repaired Below ₹5,000 indent ${mr.indentNumber}: ${fromStatus} → PM_APPROVED`);
    }
  } catch (err) {
    console.warn('Below ₹5,000 HO repair skipped:', err.message);
  }
}

module.exports = { connectMongo };
