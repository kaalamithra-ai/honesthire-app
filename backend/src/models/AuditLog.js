'use strict';
const { mongoose } = require('../db');

const ROLE_ENUM = {
  admin: 'Admin',
  recruiter: 'Recruiter',
  interviewer: 'Interviewer'
};

const AUDIT_ACTIONS = [
  'login', 'login_failed', 'logout',
  'candidate_created', 'feedback_added', 'checks_updated', 'document_uploaded', 'document_deleted',
  'pipeline_changed', 'export_generated',
  'team_created', 'team_role_changed', 'team_deactivated', 'team_reactivated', 'sessions_revoked',
  'access_denied'
];
Object.seal(AUDIT_ACTIONS);

const auditActionEnum = Object.freeze(Object.fromEntries(AUDIT_ACTIONS.map(a => [a, a])));

const auditLogSchema = new mongoose.Schema({
  actor: {
    id: { type: String, default: '' },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, default: '', trim: true, lowercase: true, maxlength: 200 },
    role: { type: String, default: '' }
  },
  action: { type: String, required: true, enum: auditActionEnum },
  target: {
    kind: { type: String, default: '', trim: true, maxlength: 80 },
    id: { type: String, default: '' },
    label: { type: String, default: '', trim: true, maxlength: 200 }
  },
  details: mongoose.Schema.Types.Mixed,
  ip: { type: String, default: '', trim: true, maxlength: 60 },
  userAgent: { type: String, default: '', trim: true, maxlength: 400 },
  at: { type: Date, required: true, default: Date.now, index: true }
}, { timestamps: true, minimize: true });

auditLogSchema.index({ at: -1, 'actor.id': 1 });
auditLogSchema.index({ action: 1, at: -1 });

module.exports = {
  ActionEnum: auditActionEnum,
  Roles: Object.freeze(ROLE_ENUM),
  MODEL: mongoose.model('AuditLog', auditLogSchema)
};
