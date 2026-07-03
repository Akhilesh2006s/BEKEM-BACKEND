const mongoose = require('mongoose');

const INCIDENT_TYPES = ['SAFETY', 'QUALITY', 'DELAY', 'EQUIPMENT', 'OTHER'];
const INCIDENT_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const INCIDENT_STATUSES = ['OPEN', 'IN_REVIEW', 'RESOLVED', 'CLOSED'];

const incidentSchema = new mongoose.Schema(
  {
    incidentNumber: { type: String, required: true, unique: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site' },
    type: { type: String, enum: INCIDENT_TYPES, required: true },
    severity: { type: String, enum: INCIDENT_SEVERITIES, default: 'MEDIUM' },
    title: { type: String, required: true },
    description: { type: String, required: true },
    status: { type: String, enum: INCIDENT_STATUSES, default: 'OPEN' },
    reportedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    resolvedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    resolutionNote: { type: String, default: '' },
    resolvedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Incident', incidentSchema);
module.exports.INCIDENT_TYPES = INCIDENT_TYPES;
module.exports.INCIDENT_SEVERITIES = INCIDENT_SEVERITIES;
module.exports.INCIDENT_STATUSES = INCIDENT_STATUSES;
