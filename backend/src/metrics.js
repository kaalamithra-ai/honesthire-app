'use strict';
const { mongoose } = require('./db');
const Session = require('./models/Session');
const User = require('./models/User');
const AuditLog = require('./models/AuditLog');
const documents = require('./documents');
const { analyticsSummary, hiringTimeline } = require('./analytics');

function uptimeSeconds() {
  return typeof process.uptime === 'function' ? Math.floor(process.uptime()) : 0;
}
// Human-readable uptime ("2m 3s") so the dashboard can show the unit it prints.
function formatUptime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (days) parts.push(days + 'd');
  if (hours || days) parts.push(hours + 'h');
  if (minutes || hours || days) parts.push(minutes + 'm');
  parts.push(seconds % 60 + 's');
  return parts.join(' ');
}
function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return value + ' B';
  const units = ['KB', 'MB', 'GB'];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return Math.round(size * 10) / 10 + ' ' + units[unit];
}
async function healthSnapshot() {
  try {
    await mongoose.connection.db.admin().ping();
    return { status: 'ok', database: 'connected' };
  } catch {
    return { status: 'degraded', database: 'disconnected' };
  }
}
// Real storage numbers straight from the GridFS bucket — no placeholder. Any
// read failure degrades to an explicit "unavailable" note instead of lying.
async function storageStats() {
  try {
    const files = mongoose.connection.db.collection(documents.BUCKET + '.files');
    const [count, totals] = await Promise.all([
      files.countDocuments(),
      files.aggregate([{ $group: { _id: null, bytes: { $sum: '$length' } } }]).toArray()
    ]);
    const bytes = totals.length ? Number(totals[0].bytes) || 0 : 0;
    return {
      available: true,
      bucket: documents.BUCKET,
      files: count,
      bytes,
      note: count + ' file' + (count === 1 ? '' : 's') + ' · ' + formatBytes(bytes) + ' (GridFS ' + documents.BUCKET + ')'
    };
  } catch {
    return { available: false, bucket: documents.BUCKET, files: null, bytes: null, note: 'Storage stats unavailable.' };
  }
}
// Every Admin Dashboard card in one live MongoDB snapshot. Strictly read-only:
// standalone MongoDB has no transactions, so nothing here writes.
async function dashboardMetrics(reqCode = '') {
  const now = new Date();
  const [health, summary, timeline, sessionRoles, userTotal, activeUsers, userRoles, auditTotal, storage] = await Promise.all([
    healthSnapshot(),
    analyticsSummary(reqCode),
    hiringTimeline(reqCode),
    // Live session store: every login (staff and candidate) creates a Session row,
    // logout deletes it and MongoDB TTL-drops expired ones.
    Session.aggregate([
      { $match: { expiresAt: { $gt: now } } },
      { $group: { _id: '$role', count: { $sum: 1 } } }
    ]),
    User.countDocuments(),
    User.countDocuments({ active: { $ne: false } }),
    User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
    AuditLog.MODEL.countDocuments(),
    storageStats()
  ]);
  const sessionsByRole = {};
  const usersByRole = {};
  let staffSessions = 0;
  let candidateSessions = 0;
  for (const item of sessionRoles) {
    sessionsByRole[item._id] = item.count;
    if (item._id === 'candidate') candidateSessions += item.count; else staffSessions += item.count;
  }
  for (const item of userRoles) usersByRole[item._id] = item.count;
  const statusCounts = summary.statusCounts;
  return {
    generatedAt: new Date().toISOString(),
    scope: reqCode || 'all',
    health: { ...health, uptimeSeconds: uptimeSeconds(), uptime: formatUptime(uptimeSeconds()) },
    candidates: {
      total: summary.totals.candidates,
      byVerification: summary.verificationCounts,
      byTier: summary.tierCounts,
      averageTrustScore: summary.averageTrustScore
    },
    pipelines: {
      total: Object.values(statusCounts).reduce((sum, count) => sum + count, 0),
      statusCounts,
      stageDistribution: summary.stageDistribution,
      stageLabels: summary.stageLabels,
      averageDaysToHire: timeline.averageDaysToHire,
      offerAcceptanceRate: timeline.offerAcceptanceRate
    },
    sessions: {
      active: staffSessions + candidateSessions,
      staff: staffSessions,
      candidates: candidateSessions,
      byRole: sessionsByRole
    },
    users: { total: userTotal, active: activeUsers, byRole: usersByRole },
    storage,
    requisitions: timeline.candidatesPerRequisition,
    audit: { total: auditTotal }
  };
}
module.exports = { dashboardMetrics, uptimeSeconds, formatUptime, formatBytes };