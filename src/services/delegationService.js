const { UserRole, PERMISSION_MATRIX } = require('@afios/shared');
const { ApprovalDelegation, User } = require('../models');
const { userCanAccessProject } = require('../utils/serialize');

function hasCapability(role, capability) {
  return (PERMISSION_MATRIX[role] || []).includes(capability);
}

function isDelegationActive(delegation, now = new Date()) {
  if (!delegation?.isActive) return false;
  const from = new Date(delegation.validFrom);
  const to = new Date(delegation.validTo);
  return from <= now && now <= to;
}

async function findActiveDelegation(delegateUserId, scope, projectId) {
  const delegations = await ApprovalDelegation.find({
    delegateUserId,
    scope,
    isActive: true,
    validFrom: { $lte: new Date() },
    validTo: { $gte: new Date() },
  }).populate('principalUserId', 'name role assignedProjectIds');

  for (const d of delegations) {
    const principal = d.principalUserId;
    if (!principal) continue;

    if (scope === 'PO_FINAL' && principal.role !== UserRole.CHAIRMAN) continue;
    if (scope === 'MR_PM' && principal.role !== UserRole.PROJECT_MANAGER) continue;

    if (scope === 'MR_PM' && projectId) {
      const allowed =
        d.projectIds?.length > 0
          ? d.projectIds.map((id) => id.toString())
          : (principal.assignedProjectIds || []).map((id) => id.toString());
      if (!allowed.includes(projectId.toString())) continue;
    }

    return d;
  }
  return null;
}

async function resolveApproval(user, capability, scope, projectId) {
  if (!user) {
    return { allowed: false, message: 'Unauthorized' };
  }

  if (hasCapability(user.role, capability)) {
    if (
      scope === 'MR_PM' &&
      user.role === UserRole.PROJECT_MANAGER &&
      projectId &&
      !userCanAccessProject(user, projectId)
    ) {
      return { allowed: false, message: 'Forbidden: project out of scope' };
    }
    return { allowed: true, principal: user, delegation: null };
  }

  const delegation = await findActiveDelegation(user._id, scope, projectId);
  if (!delegation) {
    return { allowed: false, message: `Forbidden: lacks ${capability}` };
  }

  const principal = delegation.principalUserId;
  if (!hasCapability(principal.role, capability)) {
    return { allowed: false, message: 'Delegation principal lacks capability' };
  }

  return {
    allowed: true,
    principal,
    delegation,
  };
}

function formatApprovalNote(baseNote, approvalContext) {
  if (!approvalContext?.delegation || !approvalContext?.principal) return baseNote;
  return `${baseNote} (on behalf of ${approvalContext.principal.name})`;
}

async function getDelegationsForUser(userId) {
  const [asDelegate, asPrincipal] = await Promise.all([
    ApprovalDelegation.find({ delegateUserId: userId, isActive: true })
      .sort({ validTo: 1 })
      .populate('principalUserId', 'name role')
      .populate('delegateUserId', 'name role'),
    ApprovalDelegation.find({ principalUserId: userId, isActive: true })
      .sort({ validTo: 1 })
      .populate('principalUserId', 'name role')
      .populate('delegateUserId', 'name role'),
  ]);
  return { asDelegate, asPrincipal };
}

async function getPoFinalDelegateUserIds() {
  const now = new Date();
  const delegations = await ApprovalDelegation.find({
    scope: 'PO_FINAL',
    isActive: true,
    validFrom: { $lte: now },
    validTo: { $gte: now },
  }).select('delegateUserId');
  return delegations.map((d) => d.delegateUserId);
}

module.exports = {
  hasCapability,
  isDelegationActive,
  resolveApproval,
  formatApprovalNote,
  getDelegationsForUser,
  getPoFinalDelegateUserIds,
};
