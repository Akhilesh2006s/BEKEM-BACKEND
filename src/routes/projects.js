const express = require('express');
const { body, param } = require('express-validator');
const { Project, Site, User, MaterialRequest, PurchaseRequest, PurchaseOrder } = require('../models');
const { authenticate } = require('../middleware/auth');
const { requireCapability } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { UserRole } = require('@afios/shared');
const { userCanAccessProject, serializeUser, serializeMaterialRequest } = require('../utils/serialize');
const { serializePurchaseOrder } = require('../utils/serializeProcurement');
const {
  assignUserToProject,
  removeUserFromProject,
  attachProjectToAllProjectsRoles,
  isAllProjectsRole,
} = require('../services/userAssignmentService');

const router = express.Router();

router.use(authenticate);

function serializeProject(p) {
  return {
    id: p._id.toString(),
    code: p.code,
    name: p.name,
    location: p.location,
    status: p.status,
    startDate: p.startDate?.toISOString?.(),
    targetEndDate: p.targetEndDate?.toISOString?.(),
    budgetTotal: p.budgetTotal,
    budgetSpent: p.budgetSpent,
    healthScore: p.healthScore,
  };
}

router.get('/', async (req, res, next) => {
  try {
    let projects;
    if ([UserRole.EXECUTIVE, UserRole.COORDINATOR, UserRole.CHAIRMAN].includes(req.user.role)) {
      projects = await Project.find().sort({ code: 1 });
    } else if (
      [UserRole.PROJECT_MANAGER, UserRole.SITE_INCHARGE, UserRole.STORE_INCHARGE].includes(
        req.user.role
      ) &&
      req.user.assignedProjectIds?.length
    ) {
      projects = await Project.find({ _id: { $in: req.user.assignedProjectIds } }).sort({ code: 1 });
    } else {
      const site = await Site.findById(req.user.assignedSiteId).populate('projectId');
      projects = site?.projectId ? [site.projectId] : [];
    }

    res.json({ data: projects.map(serializeProject) });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/',
  requireCapability('MANAGE_PROJECTS'),
  [
    body('code').trim().notEmpty(),
    body('name').trim().notEmpty(),
    body('location').trim().notEmpty(),
    body('status').optional().isIn(['ACTIVE', 'ON_HOLD', 'COMPLETED']),
    body('budgetTotal').optional().isFloat({ min: 0 }),
    body('startDate').optional().isISO8601(),
    body('targetEndDate').optional().isISO8601(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const existing = await Project.findOne({ code: req.body.code.toUpperCase() });
      if (existing) {
        return res.status(400).json({ statusCode: 400, message: 'Project code already exists' });
      }
      const project = await Project.create({
        code: req.body.code.toUpperCase(),
        name: req.body.name,
        location: req.body.location,
        status: req.body.status || 'ACTIVE',
        startDate: req.body.startDate ? new Date(req.body.startDate) : new Date(),
        targetEndDate: req.body.targetEndDate
          ? new Date(req.body.targetEndDate)
          : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        budgetTotal: req.body.budgetTotal || 0,
        budgetSpent: 0,
        healthScore: 85,
      });
      await attachProjectToAllProjectsRoles(project._id);
      res.status(201).json({ data: serializeProject(project) });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/:id/detail', async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return res.status(404).json({ statusCode: 404, message: 'Project not found' });
    }
    if (!userCanAccessProject(req.user, project._id)) {
      return res.status(403).json({ statusCode: 403, message: 'Forbidden' });
    }

    const [sites, users, materialRequests, purchaseRequests] = await Promise.all([
      Site.find({ projectId: project._id }).sort({ name: 1 }),
      User.find({ assignedProjectIds: project._id })
        .sort({ name: 1 })
        .select('-passwordHash -refreshToken'),
      MaterialRequest.find({ projectId: project._id })
        .sort({ createdAt: -1 })
        .populate([
          { path: 'items.materialId' },
          { path: 'materialId' },
          { path: 'siteId' },
          { path: 'requestedByUserId', select: 'name' },
        ]),
      PurchaseRequest.find({ projectId: project._id }).select('_id'),
    ]);

    const prIds = purchaseRequests.map((pr) => pr._id);
    const purchaseOrders = prIds.length
      ? await PurchaseOrder.find({ purchaseRequestId: { $in: prIds } })
          .sort({ createdAt: -1 })
          .populate([
            { path: 'vendorId' },
            {
              path: 'purchaseRequestId',
              populate: [{ path: 'projectId' }, { path: 'materialRequestId' }],
            },
          ])
      : [];

    res.json({
      data: {
        project: serializeProject(project),
        sites: sites.map((s) => ({
          id: s._id.toString(),
          name: s.name,
          chainageLabel: s.chainageLabel,
          projectId: s.projectId.toString(),
        })),
        users: users.map(serializeUser),
        materialRequests: materialRequests.map(serializeMaterialRequest),
        purchaseOrders: purchaseOrders.map(serializePurchaseOrder),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return res.status(404).json({ statusCode: 404, message: 'Project not found' });
    }
    if (!userCanAccessProject(req.user, project._id)) {
      return res.status(403).json({ statusCode: 403, message: 'Forbidden' });
    }
    res.json({ data: serializeProject(project) });
  } catch (err) {
    next(err);
  }
});

router.patch(
  '/:id',
  requireCapability('MANAGE_PROJECTS'),
  [
    param('id').isMongoId(),
    body('name').optional().trim().notEmpty(),
    body('location').optional().trim().notEmpty(),
    body('status').optional().isIn(['ACTIVE', 'ON_HOLD', 'COMPLETED']),
    body('budgetTotal').optional().isFloat({ min: 0 }),
    body('healthScore').optional().isInt({ min: 0, max: 100 }),
  ],
  validate,
  async (req, res, next) => {
    try {
      const project = await Project.findById(req.params.id);
      if (!project) return res.status(404).json({ statusCode: 404, message: 'Not found' });

      if (req.body.name) project.name = req.body.name;
      if (req.body.location) project.location = req.body.location;
      if (req.body.status) project.status = req.body.status;
      if (req.body.budgetTotal !== undefined) project.budgetTotal = req.body.budgetTotal;
      if (req.body.healthScore !== undefined) project.healthScore = req.body.healthScore;

      await project.save();
      res.json({ data: serializeProject(project) });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/users',
  requireCapability('MANAGE_PROJECTS'),
  [param('id').isMongoId(), body('userId').isMongoId()],
  validate,
  async (req, res, next) => {
    try {
      const project = await Project.findById(req.params.id);
      if (!project) return res.status(404).json({ statusCode: 404, message: 'Project not found' });

      const user = await User.findById(req.body.userId);
      if (!user) return res.status(404).json({ statusCode: 404, message: 'User not found' });

      await assignUserToProject(user, project._id);
      res.json({ data: serializeUser(user) });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
      }
      next(err);
    }
  }
);

router.delete(
  '/:id/users/:userId',
  requireCapability('MANAGE_PROJECTS'),
  [param('id').isMongoId(), param('userId').isMongoId()],
  validate,
  async (req, res, next) => {
    try {
      const project = await Project.findById(req.params.id);
      if (!project) return res.status(404).json({ statusCode: 404, message: 'Project not found' });

      const user = await User.findById(req.params.userId);
      if (!user) return res.status(404).json({ statusCode: 404, message: 'User not found' });

      if (isAllProjectsRole(user.role)) {
        return res.status(400).json({
          statusCode: 400,
          message: 'Executive, Coordinator, and Chairman stay on all projects',
        });
      }

      await removeUserFromProject(user, project._id);
      res.json({ data: serializeUser(user) });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
      }
      next(err);
    }
  }
);

module.exports = router;
