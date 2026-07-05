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

function serializeTransferRow(t) {
  return {
    id: t._id.toString(),
    transferNumber: t.transferNumber,
    status: t.status,
    fromProjectId: t.fromProjectId?._id?.toString() || t.fromProjectId?.toString(),
    toProjectId: t.toProjectId?._id?.toString() || t.toProjectId?.toString(),
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
      materialId: item.materialId?._id?.toString(),
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
    canCoordinatorDecide: false,
    canCoordinatorReject: false,
    canExecute: false,
  };

  const awaitingHoReview = ['REQUESTED', 'PM_APPROVED'].includes(t.status);

  if (user.role === UserRole.COORDINATOR && awaitingHoReview) {
    flags.canCoordinatorDecide = true;
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

module.exports = {
  getProjectManagers,
  userManagesProject,
  serializeTransferRow,
  transferActionFlags,
};
