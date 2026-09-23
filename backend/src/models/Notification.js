'use strict';
const { mongoose } = require('../db');
// Simulated outbound email log. No SMTP is ever used: rows are persisted in MongoDB and
// surfaced through the API/UI, so every pipeline change leaves a visible, auditable trail.
const NOTIFICATION_KINDS = ['stage_changed', 'status_changed', 'candidate_created', 'feedback_added', 'document_uploaded'];
const notificationSchema = new mongoose.Schema({
  candidateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate', required: true },
  candidateName: { type: String, required: true, trim: true, maxlength: 200 },
  recipientEmail: { type: String, required: true, trim: true, maxlength: 200 },
  kind: { type: String, required: true, enum: NOTIFICATION_KINDS },
  subject: { type: String, required: true, trim: true, maxlength: 200 },
  body: { type: String, required: true, trim: true, maxlength: 5000 },
  delivery: { type: String, required: true, enum: ['simulated'], default: 'simulated' },
  status: { type: String, required: true, enum: ['logged'], default: 'logged' },
  triggeredBy: {
    id: { type: String, trim: true, maxlength: 40, default: '' },
    name: { type: String, trim: true, maxlength: 120, default: 'Signed-out operator' },
    email: { type: String, trim: true, maxlength: 200, default: '' },
    role: { type: String, trim: true, maxlength: 40, default: '' }
  },
  pipeline: {
    reqCode: { type: String, trim: true, maxlength: 100, default: '' },
    fromStep: { type: Number, min: 1, max: 5 },
    toStep: { type: Number, min: 1, max: 5 },
    fromStatus: { type: String, trim: true, maxlength: 40, default: '' },
    toStatus: { type: String, trim: true, maxlength: 40, default: '' }
  }
}, { timestamps: true });
notificationSchema.index({ candidateId: 1, createdAt: -1 });
const Notification = mongoose.model('Notification', notificationSchema);
module.exports = Notification;
module.exports.NOTIFICATION_KINDS = NOTIFICATION_KINDS;
