'use strict';
const { Router } = require('express');
const { mongoose, requireDatabase } = require('./db');
const User = require('./models/User');
const Candidate = require('./models/Candidate');
const Session = require('./models/Session');
const AuditLog = require('./models/AuditLog');
const { analyticsSummary, hiringTimeline } = require('./analytics');
const { dashboardMetrics } = require('./metrics');
const { HttpError, teamCreateInput, teamUpdateInput, auditInput, analyticsInput } = require('./validation');
const { requireUser, publicUser, hashPassword } = require('./auth');
const { writeAudit } = require('./audit');

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const objectId = (value, name) => {
  if (!mongoose.isObjectIdOrHexString(value)) throw new HttpError(400, name + ' must be a MongoDB ObjectId.');
  return value;
};
function uptimeSeconds() {
  return typeof process.uptime === 'function' ? Math.floor(process.uptime()) : 0;
}
// Admin gate that also records a failed attempt as access_denied (recruiters/interviewers hitting /api/admin/*).
async function requireAdminAudited(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Log in to continue.'));
  if (req.user.role !== 'admin') {
    await writeAudit(req, 'access_denied', { kind: 'route', label: req.originalUrl }, { reason: 'forbidden', role: req.user.role });
    return next(new HttpError(403, 'This action requires the admin role.'));
  }
  next();
}

module.exports = function createAdminRoutes() {
  const router = Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(requireDatabase);
  // Strict Admin gate for every route below: 401 without a token, 403 for non-admins.
  router.use(requireUser, requireAdminAudited);

  // ---- Overview ----
  router.get('/overview', wrap(async (req, res) => {
    const now = new Date();
    const [candidateTotal, activeSessions] = await Promise.all([
      Candidate.countDocuments(),
      Session.countDocuments({ expiresAt: { $gt: now } })
    ]);
    let database = 'disconnected';
    let status = 'degraded';
    try {
      await mongoose.connection.db.admin().ping();
      database = 'connected';
      status = 'ok';
    } catch { /* leave degraded until MongoDB recovers */ }
    // Storage metrics are intentionally placeholder until a storage engine is confirmed.
    res.json({
      health: { status, database, uptimeSeconds: uptimeSeconds() },
      candidates: { total: candidateTotal },
      sessions: { active: activeSessions },
      storage: { available: false, files: null, bytes: null, note: 'Pending storage engine decision.' }
    });
  }));

    // ---- Team management ----
  router.get('/team', wrap(async (req, res) => {
    const [users, sessions] = await Promise.all([
      User.find().sort({ role: 1, name: 1 }).select('-passwordHash -passwordSalt').lean(),
      Session.aggregate([
        { $match: { expiresAt: { $gt: new Date() } } },
        { $group: { _id: '$userId', count: { $sum: 1 } } }
      ])
    ]);
    const counts = new Map(sessions.map(item => [String(item._id), item.count]));
    res.json(users.map(user => ({
      id: String(user._id), name: user.name, email: user.email, role: user.role,
      active: user.active !== false, sessionCount: counts.get(String(user._id)) || 0
    })));
  }));

  router.post('/team', wrap(async (req, res) => {
    const { name, email, role, password } = teamCreateInput(req.body);
    const { passwordSalt, passwordHash } = hashPassword(password);
    let user;
    try {
      user = await User.create({ name, email, role, passwordSalt, passwordHash, active: true });
    } catch (error) {
      if (error && error.code === 11000) throw new HttpError(409, 'A team account already exists with this email.');
      throw error;
    }
    await writeAudit(req, 'team_created', { kind: 'user', id: String(user._id), label: user.email }, { role });
    res.status(201).json(publicUser(user));
  }));

  router.patch('/team/:id', wrap(async (req, res) => {
    objectId(req.params.id, 'id');
    const { role, active } = teamUpdateInput(req.body);
    // Self-protection: never let an admin lock themselves out here.
    if (String(req.user.id) === req.params.id && ((role && role !== 'admin') || active === false)) {
      throw new HttpError(409, 'You cannot change your own role or deactivate your own account from here.');
    }
    const update = {};
    if (role) update.role = role;
    if (active !== undefined) update.active = active;
    const user = await User.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true })
      .select('-passwordHash -passwordSalt').lean();
    if (!user) throw new HttpError(404, 'Team member not found.');
    if (role) {
      await writeAudit(req, 'team_role_changed', { kind: 'user', id: String(user._id), label: user.email }, { role });
    }
    if (active === false) {
      await Session.deleteMany({ userId: user._id });
      await writeAudit(req, 'sessions_revoked', { kind: 'user', id: String(user._id), label: user.email }, { reason: 'account_deactivated' });
    }
    if (active === true) {
      await writeAudit(req, 'team_reactivated', { kind: 'user', id: String(user._id), label: user.email });
    }
    res.json(publicUser(user));
  }));

  router.delete('/team/:id/sessions', wrap(async (req, res) => {
    objectId(req.params.id, 'id');
    const user = await User.findById(req.params.id).select('email').lean();
    if (!user) throw new HttpError(404, 'Team member not found.');
        const revoked = (await Session.deleteMany({ userId: user._id })).deletedCount;
    await writeAudit(req, 'sessions_revoked', { kind: 'user', id: String(user._id), label: user.email }, { count: revoked });
    res.json({ revoked });
  }));

  router.get('/team/:id', wrap(async (req, res) => {
    objectId(req.params.id, 'id');
    const user = await User.findById(req.params.id).select('-passwordHash -passwordSalt').lean();
    if (!user) throw new HttpError(404, 'Team member not found.');
    const sessionCount = await Session.countDocuments({ userId: user._id, expiresAt: { $gt: new Date() } });
    res.json({ ...publicUser(user), active: user.active !== false, sessionCount });
  }));

    // ---- Audit log ----
  router.get('/audit', wrap(async (req, res) => {
    const { limit, action } = auditInput(req.query);
    const query = action ? { action } : {};
    const items = await AuditLog.MODEL.find(query).sort({ at: -1, _id: -1 }).limit(limit).lean();
    res.json({
      items: items.map(entry => ({
        id: String(entry._id), at: entry.at, action: entry.action,
        actor: entry.actor, target: entry.target, details: entry.details
      })),
      count: items.length,
      limit
    });
  }));

  // ---- Hiring analytics: live summary + extended metrics, all derived from MongoDB ----
  router.get('/analytics', wrap(async (req, res) => {
    const { reqCode } = analyticsInput(req.query);
    const [summary, timeline] = await Promise.all([analyticsSummary(reqCode), hiringTimeline(reqCode)]);
    res.json({ ...summary, ...timeline });
  }));

  // ---- Dashboard metrics: every Admin Dashboard card in one live MongoDB snapshot ----
  router.get('/metrics', wrap(async (req, res) => {
    const { reqCode } = analyticsInput(req.query);
    res.json(await dashboardMetrics(reqCode));
  }));
  return router;
};
