const express = require('express');
const { body, param } = require('express-validator');
const { Site } = require('../models');
const { authenticate } = require('../middleware/auth');
const { requireCapability } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { userCanAccessSite } = require('../utils/serialize');
const { UserRole } = require('@afios/shared');

const router = express.Router();

router.use(authenticate);

function serializeSite(site) {
  return {
    id: site._id.toString(),
    projectId: site.projectId?._id?.toString() || site.projectId?.toString(),
    name: site.name,
    chainageLabel: site.chainageLabel,
    project: site.projectId?.code
      ? { id: site.projectId._id.toString(), code: site.projectId.code, name: site.projectId.name }
      : undefined,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const { projectId } = req.query;
    const filter = {};
    if (projectId) filter.projectId = projectId;

    let sites;
    if ([UserRole.CHAIRMAN, UserRole.COORDINATOR, UserRole.EXECUTIVE].includes(req.user.role)) {
      sites = await Site.find(filter).populate('projectId').sort({ name: 1 });
    } else if (req.user.role === UserRole.PROJECT_MANAGER) {
      filter.projectId = { $in: req.user.assignedProjectIds || [] };
      sites = await Site.find(filter).populate('projectId').sort({ name: 1 });
    } else if (req.user.assignedSiteId) {
      sites = await Site.find({ _id: req.user.assignedSiteId }).populate('projectId');
    } else {
      sites = [];
    }

    res.json({ data: sites.map(serializeSite) });
  } catch (err) {
    next(err);
  }
});

router.get('/my', async (req, res, next) => {
  try {
    if (!req.user.assignedSiteId) {
      return res.json({ data: null });
    }
    const site = await Site.findById(req.user.assignedSiteId).populate('projectId');
    if (!site) {
      return res.json({ data: null });
    }
    res.json({ data: serializeSite(site) });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/',
  requireCapability('MANAGE_PROJECTS'),
  [
    body('projectId').isMongoId(),
    body('name').trim().notEmpty(),
    body('chainageLabel').trim().notEmpty(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const site = await Site.create({
        projectId: req.body.projectId,
        name: req.body.name,
        chainageLabel: req.body.chainageLabel,
      });
      const populated = await Site.findById(site._id).populate('projectId');
      res.status(201).json({ data: serializeSite(populated) });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/:id', async (req, res, next) => {
  try {
    const site = await Site.findById(req.params.id).populate('projectId');
    if (!site) {
      return res.status(404).json({ statusCode: 404, message: 'Site not found' });
    }
    if (!userCanAccessSite(req.user, site._id)) {
      return res.status(403).json({ statusCode: 403, message: 'Forbidden' });
    }
    res.json({ data: serializeSite(site) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
