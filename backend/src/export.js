'use strict';
const Notification = require('./models/Notification');
const { STEP_RANGE, STAGE_LABELS, analyticsSummary } = require('./analytics');
// Server-generated CSV keeps one code path for filters, feedback history and document metadata,
// so the download always matches the JSON feed with the same query string.
const EXPORT_COLUMNS = [
  '_id', 'name', 'email', 'role', 'location', 'trustScore', 'clearanceTier', 'verificationStatus',
  'verifiedSkills', 'idDocuments', 'reqCode', 'currentStep', 'completionPercentage', 'pipelineStatus',
  'feedbackCount', 'feedbackHistory', 'documentCount', 'documentNames'
];
function csvCell(value) {
  const text = value === undefined || value === null ? '' : String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}
function exportRow(item) {
  const pipeline = item.pipeline || {};
  const feedback = Array.isArray(item.feedback) ? item.feedback : [];
  const documents = Array.isArray(item.documents) ? item.documents : [];
  const history = feedback.map(entry => {
    const author = entry.author ? ' — ' + entry.author : '';
    return String(entry.text || '').replace(/\s+/g, ' ').trim() + author;
  }).filter(Boolean);
  return [
    item._id, item.name, item.email || '', item.role, item.location, item.trustScore,
    item.clearanceTier, item.verificationStatus, (item.verifiedSkills || []).join(' | '),
    (item.idDocuments || []).join(' | '), pipeline.reqCode || '',
    pipeline.currentStep === undefined ? '' : pipeline.currentStep,
    pipeline.completionPercentage === undefined ? '' : pipeline.completionPercentage,
    pipeline.status || '', feedback.length, history.join(' || '),
    documents.length, documents.map(entry => entry.name).join(' | ')
  ].map(csvCell).join(',');
}
function exportCsv(items) {
  return EXPORT_COLUMNS.join(',') + '\r\n' + items.map(exportRow).join('\r\n') + '\r\n';
}
function notificationsFor(candidate, limit = 50) {
  return Notification.find({ candidateId: candidate._id }).sort({ createdAt: -1 }).limit(limit).lean();
}
module.exports = { STEP_RANGE, STAGE_LABELS, EXPORT_COLUMNS, csvCell, exportRow, exportCsv, notificationsFor, analyticsSummary };
