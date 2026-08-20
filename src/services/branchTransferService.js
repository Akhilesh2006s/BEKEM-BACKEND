const { UserRole } = require('@afios/shared');
const { User } = require('../models');

async function getProjectManagers(projectId) {
  if (!projectId) return [];
  return User.find({
    role: UserRole.PROJECT_MANAGER,
    assignedProjectIds: projectId,
  });
}

function userManagesProject(user, projectId) {
  if (!user || !projectId) return false;
  const pid = projectId._id ? projectId._id.toString() : projectId.toString();
  return (user.assignedProjectIds || [])
    .map((id) => id.toString())
    .includes(pid);
}

const CLOSED_INDENT_BT_STATUSES = ['REJECTED', 'RAISE_PO_INSTEAD'];
const INDENT_BT_STATUSES = ['FORWARDED_TO_PM', 'BRANCH_TRANSFER_REQUESTED'];

function serializeTransferRow(t) {
  return {
    id: t._id.toString(),
    transferNumber: t.transferNumber,
    status: t.status,
    fromProjectId: t.fromProjectId?._id?.toString() || t.fromProjectId?.toString(),
    toProjectId: t.toProjectId?._id?.toString() || t.toProjectId?.toString(),
    fromSiteId: t.fromSiteId?._id?.toString() || t.fromSiteId?.toString(),
    toSiteId: t.toSiteId?._id?.toString() || t.toSiteId?.toString(),
    fromProject: t.fromProjectId?.code,
    toProject: t.toProjectId?.code,
    fromProjectName: t.fromProjectId?.name,
    toProjectName: t.toProjectId?.name,
    fromSite: t.fromSiteId?.name,
    toSite: t.toSiteId?.name,
    materialRequestId: t.materialRequestId?._id?.toString() || t.materialRequestId?.toString(),
    coordinatorDecision: t.coordinatorDecision,
    itemCount: t.items.length,
    items: t.items.map((item) => ({
      materialId: item.materialId?._id?.toString() || item.materialId?.toString(),
      materialName: item.materialId?.name,
      quantity: item.quantity,
      quantityReceived: item.quantityReceived,
    })),
    note: t.note,
    rejectionNote: t.rejectionNote || '',
    requestedBy: t.requestedByUserId?.name,
    requestedByUserId: t.requestedByUserId?._id?.toString() || t.requestedByUserId?.toString(),
    pmApprovedBy: t.pmApprovedByUserId?.name,
    pmApprovedAt: t.pmApprovedAt?.toISOString?.(),
    coordinatorDecidedBy: t.coordinatorDecidedByUserId?.name,
    coordinatorDecidedAt: t.coordinatorDecidedAt?.toISOString?.(),
    transferredAt: t.transferredAt?.toISOString?.(),
    createdAt: t.createdAt?.toISOString?.(),
  };
}

function transferActionFlags(t, user) {
  const flags = {
    canPmApprove: false,
    canPmReject: false,
    canExecutiveApprove: false,
    canExecutiveReject: false,
    canCoordinatorDecide: false,
    canCoordinatorReject: false,
    canExecute: false,
  };

  if (user.role === UserRole.EXECUTIVE && t.status === 'REQUESTED') {
    flags.canExecutiveApprove = true;
    flags.canExecutiveReject = true;
  }

  if (user.role === UserRole.COORDINATOR && t.status === 'REQUESTED') {
    flags.canCoordinatorReject = true;
  }

  if (
    user.role === UserRole.COORDINATOR &&
    t.status === 'COORDINATOR_DECIDED' &&
    t.coordinatorDecision === 'transfer'
  ) {
    flags.canExecute = true;
  }

  return flags;
}

function qtyCoveredByTransfers(transfers) {
  const byMaterial = new Map();
  for (const t of transfers) {
    for (const item of t.items || []) {
      const mid = (item.materialId?._id || item.materialId).toString();
      byMaterial.set(mid, (byMaterial.get(mid) || 0) + Number(item.quantity || 0));
    }
  }
  return byMaterial;
}

function fail(statusCode, message, extra = {}) {
  return { ok: false, statusCode, body: { statusCode, message, ...extra } };
}

async function notifyBranchTransferRequested(transfer, toProjectId) {
  const notificationService = require('./notificationService');
  const destinationPms = await getProjectManagers(toProjectId);
  const coordinators = await User.find({ role: UserRole.COORDINATOR });
  const executives = await User.find({ role: UserRole.EXECUTIVE });
  const number = transfer.transferNumber;
  for (const c of coordinators) {
    await notificationService.notifyUser(c._id, {
      title: 'Branch transfer request — Executive review',
      body: `${number}: PM requested stock from another project — awaiting Executive approval.`,
      relatedEntityType: 'BranchTransfer',
      relatedEntityId: transfer._id,
    });
  }
  for (const exec of executives) {
    await notificationService.notifyUser(exec._id, {
      title: 'Branch transfer awaiting your approval',
      body: `${number}: review and approve or reject — no modifications allowed.`,
      relatedEntityType: 'BranchTransfer',
      relatedEntityId: transfer._id,
    });
  }
  for (const pm of destinationPms) {
    await notificationService.notifyUser(pm._id, {
      title: 'Branch transfer submitted',
      body: `${number} sent to Head Office for approval — you will be notified when decided.`,
      relatedEntityType: 'BranchTransfer',
      relatedEntityId: transfer._id,
    });
  }
}

async function createIndentLinkedTransfers(user, { materialRequestId, note, sources }) {
  const { BranchTransfer, Site, MaterialRequest, StockLedger } = require('../models');
  const { generateTransferNumber } = require('./documentNumberService');
  const statusHistoryService = require('./statusHistoryService');
  const { getIndentLineItems } = require('./materialRequestHelpers');

  if (user.role !== UserRole.PROJECT_MANAGER) {
    return fail(403, 'Only Project Managers can initiate branch transfers');
  }
  if (!Array.isArray(sources) || !sources.length) {
    return fail(400, 'Select at least one source site and take quantity');
  }

  const mr = await MaterialRequest.findById(materialRequestId);
  if (!mr) return fail(404, 'Linked indent not found');
  if (!INDENT_BT_STATUSES.includes(mr.status)) {
    return fail(400, 'Indent is not awaiting PM review');
  }

  const toProjectId = (mr.projectId?._id || mr.projectId).toString();
  const toSiteId = mr.siteId ? (mr.siteId._id || mr.siteId).toString() : undefined;
  if (!userManagesProject(user, toProjectId)) {
    return fail(403, 'You do not manage the requesting project');
  }

  const requestedByMaterial = new Map();
  for (const line of getIndentLineItems(mr)) {
    const mid = (line.materialId?._id || line.materialId).toString();
    requestedByMaterial.set(
      mid,
      (requestedByMaterial.get(mid) || 0) + Number(line.quantityRequested || 0)
    );
  }

  const existing = await BranchTransfer.find({
    materialRequestId: mr._id,
    status: { $nin: CLOSED_INDENT_BT_STATUSES },
  });
  const planned = qtyCoveredByTransfers(existing);
  const usedSites = new Set(existing.map((t) => t.fromSiteId?.toString()).filter(Boolean));
  const seenSites = new Set();

  for (const source of sources) {
    const fromProjectId = String(source.fromProjectId || '');
    const fromSiteId = String(source.fromSiteId || '');
    if (!fromProjectId || !fromSiteId) {
      return fail(400, 'Each source must include a project and site');
    }
    if (seenSites.has(fromSiteId)) {
      return fail(400, 'Each source site can only appear once');
    }
    seenSites.add(fromSiteId);
    if (usedSites.has(fromSiteId)) {
      return fail(409, 'A branch transfer is already in progress from this site for this indent');
    }
    if (!userManagesProject(user, fromProjectId)) {
      return fail(403, 'You do not manage the source project');
    }
    if (fromProjectId === toProjectId) {
      return fail(400, 'Source and destination projects must differ');
    }
    if (toSiteId && fromSiteId === toSiteId) {
      return fail(400, 'Source site must differ from the indent site');
    }

    const sourceSite = await Site.findById(fromSiteId).select('projectId');
    if (!sourceSite || sourceSite.projectId.toString() !== fromProjectId) {
      return fail(400, 'Source site must belong to the source project');
    }
    if (!Array.isArray(source.items) || !source.items.length) {
      return fail(400, 'Each source must include at least one take quantity');
    }

    for (const item of source.items) {
      const qty = Number(item.quantity);
      if (!(qty > 0)) {
        return fail(400, 'Take quantity must be greater than zero');
      }
      const mid = String(item.materialId);
      const requested = requestedByMaterial.get(mid);
      if (requested == null) {
        return fail(400, 'Transfer item is not on this indent');
      }
      const next = (planned.get(mid) || 0) + qty;
      if (next > requested + 1e-9) {
        return fail(400, 'Take quantities cannot exceed the indent remaining quantity');
      }
      planned.set(mid, next);

      const ledger = await StockLedger.findOne({
        siteId: fromSiteId,
        materialId: mid,
      }).select('quantityOnHand quantityReserved');
      const available = Math.max(
        0,
        (ledger?.quantityOnHand || 0) - (ledger?.quantityReserved || 0)
      );
      if (available < qty) {
        return fail(400, 'Insufficient stock at the selected source site for this transfer');
      }
    }
  }

  const created = [];
  for (const source of sources) {
    const transferNumber = await generateTransferNumber();
    const transfer = await BranchTransfer.create({
      transferNumber,
      fromProjectId: source.fromProjectId,
      fromSiteId: source.fromSiteId,
      toProjectId,
      toSiteId: toSiteId || undefined,
      items: source.items,
      note: note || '',
      materialRequestId: mr._id,
      requestedByUserId: user._id,
      status: 'REQUESTED',
    });
    await statusHistoryService.record(
      'BranchTransfer',
      transfer._id,
      null,
      'REQUESTED',
      user._id,
      note?.trim()
        ? `Branch transfer ${transferNumber} requested by PM: ${note.trim()}`
        : `Branch transfer ${transferNumber} requested by PM`
    );
    created.push(transfer);
  }

  const numbers = created.map((t) => t.transferNumber).join(', ');
  const prev = mr.status;
  if (mr.status !== 'BRANCH_TRANSFER_REQUESTED') {
    mr.status = 'BRANCH_TRANSFER_REQUESTED';
    mr.pendingWithRole = 'EXECUTIVE';
    await mr.save();
  }
  await statusHistoryService.record(
    'MaterialRequest',
    mr._id,
    prev,
    'BRANCH_TRANSFER_REQUESTED',
    user._id,
    `Branch transfer${created.length > 1 ? 's' : ''} ${numbers} requested — no purchase order`
  );

  for (const transfer of created) {
    await notifyBranchTransferRequested(transfer, toProjectId);
  }

  return { ok: true, transfers: created, mr };
}

module.exports = {
  getProjectManagers,
  userManagesProject,
  serializeTransferRow,
  transferActionFlags,
  CLOSED_INDENT_BT_STATUSES,
  INDENT_BT_STATUSES,
  qtyCoveredByTransfers,
  createIndentLinkedTransfers,
};
