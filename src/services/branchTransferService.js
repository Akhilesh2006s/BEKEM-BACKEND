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
  return (user.assignedProjectIds || [])
    .map((id) => id.toString())
    .includes(projectId.toString());
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
    itemCount: t.items.length,
    items: t.items.map((item) => ({
      materialId: item.materialId?._id?.toString(),
      materialName: item.materialId?.name,
      quantity: item.quantity,
    })),
    note: t.note,
    rejectionNote: t.rejectionNote || '',
    requestedBy: t.requestedByUserId?.name,
    requestedByUserId: t.requestedByUserId?._id?.toString() || t.requestedByUserId?.toString(),
    destinationApprovedBy: t.destinationApprovedByUserId?.name,
    sourceFinalApprovedBy: t.sourceFinalApprovedByUserId?.name,
    createdAt: t.createdAt?.toISOString?.(),
  };
}

module.exports = {
  getProjectManagers,
  userManagesProject,
  serializeTransferRow,
};
