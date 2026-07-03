const express = require('express');
const bcrypt = require('bcryptjs');
const { body, param } = require('express-validator');
const { UserRole } = require('@afios/shared');
const { User, Project, Site } = require('../models');
const { authenticate } = require('../middleware/auth');
const { requireCapability } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { serializeUser } = require('../utils/serialize');
const { applyRoleAssignments, isAllProjectsRole } = require('../services/userAssignmentService');

const router = express.Router();
router.use(authenticate);
router.use(requireCapability('MANAGE_USERS'));

const ROLES = Object.values(UserRole);

router.get('/', async (req, res, next) => {
  try {
    const users = await User.find()
      .sort({ name: 1 })
      .select('-passwordHash -refreshToken')
      .populate('assignedProjectIds', 'code name');
    res.json({
      data: users.map((u) => ({
        ...serializeUser(u),
        projects: (u.assignedProjectIds || [])
          .filter((p) => p && p.code)
          .map((p) => ({ id: p._id.toString(), code: p.code, name: p.name })),
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/meta', async (req, res, next) => {
  try {
    const [projects, sites] = await Promise.all([
      Project.find().sort({ code: 1 }).select('code name'),
      Site.find().sort({ name: 1 }).select('name chainageLabel projectId'),
    ]);
    res.json({
      data: {
        roles: ROLES,
        assignmentRules: {
          singleProject: [UserRole.SITE_INCHARGE, UserRole.PROJECT_MANAGER],
          multiProject: [UserRole.STORE_INCHARGE],
          allProjects: [UserRole.EXECUTIVE, UserRole.COORDINATOR, UserRole.CHAIRMAN],
        },
        projects: projects.map((p) => ({
          id: p._id.toString(),
          code: p.code,
          name: p.name,
        })),
        sites: sites.map((s) => ({
          id: s._id.toString(),
          name: s.name,
          chainageLabel: s.chainageLabel,
          projectId: s.projectId?.toString(),
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/',
  [
    body('name').trim().notEmpty(),
    body('email').isEmail(),
    body('password').isLength({ min: 8 }),
    body('role').isIn(ROLES),
    body('assignedProjectIds').optional().isArray(),
    body('assignedProjectIds.*').optional().isMongoId(),
    body('assignedSiteId').optional({ nullable: true }).isMongoId(),
    body('avatarColor').optional().trim(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const email = req.body.email.toLowerCase();
      const existing = await User.findOne({ email });
      if (existing) {
        return res.status(409).json({ statusCode: 409, message: 'Email already in use' });
      }

      const passwordHash = await bcrypt.hash(req.body.password, 10);
      const user = new User({
        name: req.body.name.trim(),
        email,
        passwordHash,
        role: req.body.role,
        assignedProjectIds: [],
        assignedSiteId: null,
        avatarColor: req.body.avatarColor || '#2563EB',
      });

      // HQ roles get all projects automatically; site/store/PM are assigned in Projects section.
      if (isAllProjectsRole(req.body.role)) {
        await applyRoleAssignments(user, { assignedProjectIds: [], assignedSiteId: null });
      }
      await user.save();

      res.status(201).json({ data: serializeUser(user) });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/:id',
  [
    param('id').isMongoId(),
    body('name').optional().trim().notEmpty(),
    body('assignedProjectIds').optional().isArray(),
    body('assignedProjectIds.*').optional().isMongoId(),
    body('assignedSiteId').optional({ nullable: true }).isMongoId(),
    body('avatarColor').optional().trim(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const user = await User.findById(req.params.id);
      if (!user) return res.status(404).json({ statusCode: 404, message: 'User not found' });

      if (req.body.name) user.name = req.body.name.trim();
      if (req.body.avatarColor) user.avatarColor = req.body.avatarColor;

      await applyRoleAssignments(user, {
        assignedProjectIds:
          req.body.assignedProjectIds !== undefined
            ? req.body.assignedProjectIds
            : user.assignedProjectIds,
        assignedSiteId:
          req.body.assignedSiteId !== undefined ? req.body.assignedSiteId : user.assignedSiteId,
      });

      await user.save();
      res.json({ data: serializeUser(user) });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
