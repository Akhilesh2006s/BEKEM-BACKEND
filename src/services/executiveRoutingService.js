const { UserRole } = require('@afios/shared');
const { User } = require('../models');

function resolveCategoryId(ref) {
  if (!ref) return null;
  if (ref._id) return ref._id.toString();
  return ref.toString();
}

function normalizeCategoryIds(ids) {
  return (ids || []).map((id) => resolveCategoryId(id)).filter(Boolean);
}

function executiveHasCategoryAssignments(user) {
  return normalizeCategoryIds(user.assignedIndentCategoryIds).length > 0;
}

function buildExecutiveIndentCategoryFilter(user) {
  if (user.role !== UserRole.EXECUTIVE) return {};
  const assigned = normalizeCategoryIds(user.assignedIndentCategoryIds);
  if (!assigned.length) return {};
  return {
    $or: [
      { indentCategoryId: { $in: assigned } },
      { indentCategoryId: { $exists: false } },
      { indentCategoryId: null },
    ],
  };
}

function executiveCanAccessIndent(user, mr) {
  if (user.role !== UserRole.EXECUTIVE) return true;
  const assigned = normalizeCategoryIds(user.assignedIndentCategoryIds);
  if (!assigned.length) return true;
  const categoryId = resolveCategoryId(mr.indentCategoryId);
  if (!categoryId) return true;
  return assigned.includes(categoryId);
}

async function getExecutivesForIndent(indentCategoryId) {
  if (!indentCategoryId) {
    return User.find({ role: UserRole.EXECUTIVE }).select('_id');
  }

  const assigned = await User.find({
    role: UserRole.EXECUTIVE,
    assignedIndentCategoryIds: indentCategoryId,
  }).select('_id');

  if (!assigned.length) {
    return User.find({ role: UserRole.EXECUTIVE }).select('_id');
  }

  return assigned;
}

async function notifyExecutivesForIndent(indentCategoryId, notificationService, payload) {
  const executives = await getExecutivesForIndent(indentCategoryId);
  await notificationService.notifyUsers(
    executives.map((u) => u._id),
    payload
  );
}

module.exports = {
  executiveHasCategoryAssignments,
  buildExecutiveIndentCategoryFilter,
  executiveCanAccessIndent,
  getExecutivesForIndent,
  notifyExecutivesForIndent,
};
