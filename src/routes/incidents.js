const express = require('express');
const { body, param } = require('express-validator');
const { UserRole } = require('@afios/shared');
const { Incident, Project, Site } = require('../models');
const { authenticate } = require('../middleware/auth');
const { requireCapability } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { userCanAccessProject } = require('../utils/serialize');

const router = express.Router();
router.use(authenticate);

function serializeIncident(inc) {
  return {
    id: inc._id.toString(),
    incidentNumber: inc.incidentNumber,
    projectId: inc.projectId?._id?.toString() || inc.projectId?.toString(),
    siteId: inc.siteId?._id?.toString() || inc.siteId?.toString() || null,
    type: inc.type,
    severity: inc.severity,
    title: inc.title,
    description: inc.description,
    status: inc.status,
    reportedByUserId: inc.reportedByUserId?._id?.toString() || inc.reportedByUserId?.toString(),
    reportedByName: inc.reportedByUserId?.name,
    resolvedByUserId: inc.resolvedByUserId?._id?.toString() || inc.resolvedByUserId?.toString() || null,
    resolvedByName: inc.resolvedByUserId?.name,
    resolutionNote: inc.resolutionNote,
    resolvedAt: inc.resolvedAt?.toISOString?.() || null,
    createdAt: inc.createdAt?.toISOString?.(),
    project: inc.projectId?.code
      ? { id: inc.projectId._id.toString(), code: inc.projectId.code, name: inc.projectId.name }
      : undefined,
    site: inc.siteId?.name
      ? { id: inc.siteId._id.toString(), name: inc.siteId.name, chainageLabel: inc.siteId.chainageLabel }
      : undefined,
  };
}

async function nextIncidentNumber(projectCode) {
  const prefix = `INC/${projectCode}/`;
  const last = await Incident.findOne({ incidentNumber: new RegExp(`^${prefix}`) })
    .sort({ incidentNumber: -1 })
    .select('incidentNumber');
  const seq = last ? parseInt(last.incidentNumber.split('/').pop(), 10) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

router.get('/', async (req, res, next) => {
  try {
    const { status, projectId } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (projectId) filter.projectId = projectId;

    const canViewAll =
      req.user.role === UserRole.CHAIRMAN || req.user.role === UserRole.COORDINATOR;
    const canViewIncidents =
      canViewAll ||
      req.user.role === UserRole.PROJECT_MANAGER ||
      req.user.role === UserRole.EXECUTIVE;

    if (!canViewAll && !canViewIncidents) {
      filter.reportedByUserId = req.user._id;
    } else if (req.user.role === UserRole.PROJECT_MANAGER) {
      filter.projectId = { $in: req.user.assignedProjectIds || [] };
    }

    const incidents = await Incident.find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('projectId')
      .populate('siteId')
      .populate('reportedByUserId', 'name')
      .populate('resolvedByUserId', 'name');

    res.json({ data: incidents.map(serializeIncident) });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/',
  requireCapability('REPORT_INCIDENT'),
  [
    body('projectId').isMongoId(),
    body('siteId').optional({ nullable: true }).isMongoId(),
    body('type').isIn(['SAFETY', 'QUALITY', 'DELAY', 'EQUIPMENT', 'OTHER']),
    body('severity').optional().isIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
    body('title').trim().notEmpty(),
    body('description').trim().notEmpty(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const project = await Project.findById(req.body.projectId);
      if (!project) return res.status(404).json({ statusCode: 404, message: 'Project not found' });
      if (!userCanAccessProject(req.user, project._id)) {
        return res.status(403).json({ statusCode: 403, message: 'Forbidden' });
      }

      const incidentNumber = await nextIncidentNumber(project.code);
      const incident = await Incident.create({
        incidentNumber,
        projectId: project._id,
        siteId: req.body.siteId || req.user.assignedSiteId || null,
        type: req.body.type,
        severity: req.body.severity || 'MEDIUM',
        title: req.body.title,
        description: req.body.description,
        reportedByUserId: req.user._id,
      });

      const populated = await Incident.findById(incident._id)
        .populate('projectId')
        .populate('siteId')
        .populate('reportedByUserId', 'name');

      res.status(201).json({ data: serializeIncident(populated) });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/:id/resolve',
  requireCapability('RESOLVE_INCIDENT'),
  [
    param('id').isMongoId(),
    body('status').isIn(['IN_REVIEW', 'RESOLVED', 'CLOSED']),
    body('resolutionNote').optional().trim(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const incident = await Incident.findById(req.params.id);
      if (!incident) return res.status(404).json({ statusCode: 404, message: 'Not found' });

      incident.status = req.body.status;
      incident.resolutionNote = req.body.resolutionNote || '';
      if (['RESOLVED', 'CLOSED'].includes(req.body.status)) {
        incident.resolvedAt = new Date();
        incident.resolvedByUserId = req.user._id;
      }
      await incident.save();

      const populated = await Incident.findById(incident._id)
        .populate('projectId')
        .populate('siteId')
        .populate('reportedByUserId', 'name')
        .populate('resolvedByUserId', 'name');

      res.json({ data: serializeIncident(populated) });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
