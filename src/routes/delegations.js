const express = require('express');
const { body, param } = require('express-validator');
const { UserRole } = require('@afios/shared');
const { ApprovalDelegation, User } = require('../models');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const delegationService = require('../services/delegationService');

const router = express.Router();
router.use(authenticate);

function serializeDelegation(d) {
  return {
    id: d._id.toString(),
    scope: d.scope,
    validFrom: d.validFrom?.toISOString?.(),
    validTo: d.validTo?.toISOString?.(),
    isActive: d.isActive,
    projectIds: (d.projectIds || []).map((id) => id.toString()),
    principal: d.principalUserId
      ? {
          id: d.principalUserId._id?.toString?.() || d.principalUserId.toString(),
          name: d.principalUserId.name,
          role: d.principalUserId.role,
        }
      : undefined,
    delegate: d.delegateUserId
      ? {
          id: d.delegateUserId._id?.toString?.() || d.delegateUserId.toString(),
          name: d.delegateUserId.name,
          role: d.delegateUserId.role,
        }
      : undefined,
  };
}

router.get('/status', async (req, res, next) => {
  try {
    const { asDelegate, asPrincipal } = await delegationService.getDelegationsForUser(req.user._id);
    const activeDelegate = asDelegate.filter((d) => delegationService.isDelegationActive(d));
    const canActAsChairman = activeDelegate.some((d) => d.scope === 'PO_FINAL');
    const canActAsPm = activeDelegate.some((d) => d.scope === 'MR_PM');

    res.json({
      data: {
        canActAsChairman,
        canActAsPm,
        asDelegate: activeDelegate.map(serializeDelegation),
        asPrincipal: asPrincipal
          .filter((d) => delegationService.isDelegationActive(d))
          .map(serializeDelegation),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/users', async (req, res, next) => {
  try {
    const role = req.user.role;
    let filter = {};
    if (role === UserRole.CHAIRMAN) {
      filter = { role: { $in: [UserRole.EXECUTIVE, UserRole.COORDINATOR] } };
    } else if (role === UserRole.PROJECT_MANAGER) {
      filter = { role: { $in: [UserRole.PROJECT_MANAGER, UserRole.EXECUTIVE] } };
    } else {
      return res.status(403).json({ statusCode: 403, message: 'Only chairman or PM can manage delegations' });
    }

    const users = await User.find({ ...filter, _id: { $ne: req.user._id } })
      .select('name email role')
      .sort({ name: 1 });

    res.json({
      data: users.map((u) => ({
        id: u._id.toString(),
        name: u.name,
        email: u.email,
        role: u.role,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/',
  [
    body('delegateUserId').isMongoId(),
    body('scope').isIn(['PO_FINAL', 'MR_PM']),
    body('validTo').isISO8601(),
    body('projectIds').optional().isArray(),
    body('projectIds.*').optional().isMongoId(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const { delegateUserId, scope, validTo, projectIds } = req.body;
      const role = req.user.role;

      if (scope === 'PO_FINAL' && role !== UserRole.CHAIRMAN) {
        return res.status(403).json({ statusCode: 403, message: 'Only chairman can delegate PO approval' });
      }
      if (scope === 'MR_PM' && role !== UserRole.PROJECT_MANAGER) {
        return res.status(403).json({ statusCode: 403, message: 'Only PM can delegate material approvals' });
      }

      const delegate = await User.findById(delegateUserId);
      if (!delegate) {
        return res.status(404).json({ statusCode: 404, message: 'Delegate user not found' });
      }
      if (delegateUserId === req.user._id.toString()) {
        return res.status(400).json({ statusCode: 400, message: 'Cannot delegate to yourself' });
      }

      const validToDate = new Date(validTo);
      if (validToDate <= new Date()) {
        return res.status(400).json({ statusCode: 400, message: 'validTo must be in the future' });
      }

      await ApprovalDelegation.updateMany(
        { principalUserId: req.user._id, scope, isActive: true },
        { isActive: false }
      );

      const delegation = await ApprovalDelegation.create({
        principalUserId: req.user._id,
        delegateUserId,
        scope,
        projectIds:
          scope === 'MR_PM'
            ? projectIds?.length
              ? projectIds
              : req.user.assignedProjectIds || []
            : [],
        validTo: validToDate,
        createdByUserId: req.user._id,
      });

      const populated = await ApprovalDelegation.findById(delegation._id)
        .populate('principalUserId', 'name role')
        .populate('delegateUserId', 'name role');

      res.status(201).json({ data: serializeDelegation(populated) });
    } catch (err) {
      next(err);
    }
  }
);

router.delete('/:id', param('id').isMongoId(), validate, async (req, res, next) => {
  try {
    const delegation = await ApprovalDelegation.findById(req.params.id);
    if (!delegation) {
      return res.status(404).json({ statusCode: 404, message: 'Delegation not found' });
    }
    if (delegation.principalUserId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ statusCode: 403, message: 'Forbidden' });
    }

    delegation.isActive = false;
    await delegation.save();
    res.json({ data: { id: delegation._id.toString(), revoked: true } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
