'use strict';
const Notification = require('./models/Notification');
const { NOTIFICATION_KINDS } = require('./models/Notification');
// Simulated outbound email: rows are persisted in MongoDB and surfaced via the API/UI.
// No SMTP is used, so the demo works with zero credentials and every message stays auditable.
const STEP_LABELS = ['Applied / Sourced', 'Initial Screening', 'Technical Assessment', 'Background & Reference Checks', 'Offer & Onboarding'];
function stepLabel(step) { return STEP_LABELS[step - 1] || ('Step ' + step); }
function recipientFor(candidate) {
  const email = String((candidate && candidate.email) || '').trim();
  return email || (String(candidate.name || 'Candidate').trim() + ' <no-email-on-file>');
}
function composePipelineEmail({ candidate, pipeline, action, fromStep, toStep, fromStatus, toStatus, actor }) {
  const who = actor && actor.name ? actor.name : 'Signed-out operator';
  const reqCode = pipeline && pipeline.reqCode ? ' (' + pipeline.reqCode + ')' : '';
  const stepText = fromStep === toStep
    ? 'remain at Step ' + toStep + ' — ' + stepLabel(toStep)
    : 'move from Step ' + fromStep + ' (' + stepLabel(fromStep) + ') to Step ' + toStep + ' (' + stepLabel(toStep) + ')';
  const statusText = fromStatus === toStatus
    ? 'pipeline status stays ' + String(toStatus).replaceAll('_', ' ')
    : 'pipeline status changes from ' + String(fromStatus).replaceAll('_', ' ') + ' to ' + String(toStatus).replaceAll('_', ' ');
  return {
    kind: fromStep === toStep ? 'status_changed' : 'stage_changed',
    subject: 'Honest Hire update: ' + candidate.name + ' — ' + (action === 'offer' ? 'final offer' : String(action).replaceAll('_', ' ')) + reqCode,
    body: [
      'Hi ' + candidate.name + ',',
      '',
      'This is a simulated status update from the Honest Hire recruiting team' + reqCode + '.',
      'After the "' + String(action).replaceAll('_', ' ') + '" action by ' + who + ', you ' + stepText + ' and your ' + statusText + '.',
      '',
      'Trust score ' + candidate.trustScore + '/100 · clearance Tier ' + candidate.clearanceTier + '.',
      '',
      'No email was actually sent — this message is logged in MongoDB for the hiring team to review.',
      '— Honest Hire (simulated email)'
    ].join('\n')
  };
}
function triggeredBy(actor) {
  return {
    id: String((actor && actor.id) || ''),
    name: String((actor && actor.name) || 'Signed-out operator'),
    email: String((actor && actor.email) || ''),
    role: String((actor && actor.role) || '')
  };
}
async function queueNotification({ candidate, pipeline, kind, subject, body, actor, snapshot }) {
  if (!NOTIFICATION_KINDS.includes(kind)) throw new Error('Unknown notification kind: ' + kind);
  const by = triggeredBy(actor);
  const row = await Notification.create({
    candidateId: candidate._id,
    candidateName: candidate.name,
    recipientEmail: recipientFor(candidate),
    kind, subject, body,
    delivery: 'simulated',
    status: 'logged',
    triggeredBy: by,
    pipeline: {
      reqCode: (pipeline && pipeline.reqCode) || '',
      fromStep: snapshot ? snapshot.fromStep : undefined,
      toStep: snapshot ? snapshot.toStep : undefined,
      fromStatus: snapshot ? snapshot.fromStatus : '',
      toStatus: snapshot ? snapshot.toStatus : ''
    }
  });
  return row.toObject();
}
module.exports = {
  STEP_LABELS,
  stepLabel,
  recipientFor,
  composePipelineEmail,
  triggeredBy,
    queueNotification
};
