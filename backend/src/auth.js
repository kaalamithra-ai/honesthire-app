'use strict';
const crypto = require('node:crypto');
const { HttpError } = require('./validation');
const User = require('./models/User');
const Session = require('./models/Session');
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const KEY_BYTES = 64;
const ANONYMOUS_ACTOR = { id: '', name: 'Signed-out operator', email: '', role: '' };
// Master Admin Security Verification: admins must present this platform passcode on
// top of their email/password before a session token is issued. It stays server-side
// only and is compared timing-safely, so response timing cannot leak it. Override with
// ADMIN_SECRET_KEY in any real deployment; the default is the local demo passcode.
const DEFAULT_ADMIN_SECRET = '8884014055';
function adminSecret() { return process.env.ADMIN_SECRET_KEY || DEFAULT_ADMIN_SECRET; }
function verifyAdminSecret(submitted) {
  if (typeof submitted !== 'string' || !submitted.trim()) return false;
  const sha256 = value => crypto.createHash('sha256').update(value).digest();
  return crypto.timingSafeEqual(sha256(submitted.trim()), sha256(adminSecret()));
}
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { passwordSalt: salt, passwordHash: crypto.scryptSync(password, salt, KEY_BYTES).toString('hex') };
}
function verifyPassword(password, user) {
  try {
    const expected = Buffer.from(String(user.passwordHash || ''), 'hex');
    if (!expected.length || !user.passwordSalt) return false;
    return crypto.timingSafeEqual(expected, crypto.scryptSync(password, user.passwordSalt, expected.length));
  } catch (error) { return false; }
}
function publicUser(user) {
  return { id: String(user._id), name: user.name, email: user.email, role: user.role };
}
function bearerToken(req) {
  const header = String(req.get('authorization') || '').trim();
  const match = /^bearer\s+([A-Za-z0-9_-]{16,200})$/i.exec(header);
  return match ? match[1] : '';
}
async function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await Session.create({ token, userId: user._id, name: user.name, email: user.email, role: user.role, expiresAt });
  return { token, expiresAt };
}
async function endSession(token) { return Session.deleteOne({ token }); }
async function actorFromToken(token) {
  if (!token) return null;
  const session = await Session.findOne({ token }).lean();
  if (!session) return null;
  if (!session.expiresAt || session.expiresAt.getTime() <= Date.now()) return null;
  const user = await User.findById(session.userId).lean();
  if (!user || user.active === false) return null;
  return publicUser(user);
}
// Optional attribution for routes that stay public: returns the signed-in member
// when a valid token is present, otherwise a clearly-labeled anonymous actor.
async function actorFromRequest(req) {
  const user = await actorFromToken(bearerToken(req));
  return user || { ...ANONYMOUS_ACTOR };
}
// Attaches req.user + req.sessionToken, or fails with 401 so feedback/uploads stay attributable.
function requireUser(req, res, next) {
  Promise.resolve((async () => {
    const token = bearerToken(req);
    if (!token) throw new HttpError(401, 'Log in to continue.');
    const session = await Session.findOne({ token }).lean();
    if (!session) throw new HttpError(401, 'Session not found. Log in again.');
    if (!session.expiresAt || session.expiresAt.getTime() <= Date.now()) {
      await Session.deleteOne({ token });
      throw new HttpError(401, 'Session expired. Log in again.');
    }
    const user = await User.findById(session.userId).lean();
    if (!user || user.active === false) {
      await Session.deleteOne({ token });
      throw new HttpError(401, 'This team account is no longer active.');
    }
    req.user = publicUser(user);
    req.sessionToken = token;
  })()).then(() => next()).catch(next);
}
// Role gate: the signed-in user must hold one of the accepted roles.
// requireRole('admin') and requireRole(['recruiter', 'interviewer']) both work,
// so existing single-role callers are unaffected.
function requireRole(roles) {
  const accepted = Array.isArray(roles) ? roles : [roles];
  return (req, res, next) => {
    if (!req.user) return next(new HttpError(401, 'Log in to continue.'));
    if (!accepted.includes(req.user.role)) {
      return next(new HttpError(403, 'This action requires the ' + accepted.join(' or ') + ' role.'));
    }
    next();
  };
}
function requireAdmin(req, res, next) {
  requireRole('admin')(req, res, next);
}
// Employee = internal hiring staff (recruiter or interviewer). Reads/writes the
// vetting feed, interviews, pipeline, feedback and internal document management.
const STAFF_ROLES = ['recruiter', 'interviewer', 'admin'];
function requireStaff(req, res, next) {
  requireRole(STAFF_ROLES)(req, res, next);
}
// Candidate = external applicant. The portal is limited to their own record.
function requireCandidate(req, res, next) {
  requireRole('candidate')(req, res, next);
}
// Attaches req.ownCandidateId (the caller's linked Candidate). 409 when nothing
// is linked so the portal can surface a clear "no application on file" state.
// Candidates can never touch another record; staff have the feed/APIs instead.
async function requireOwnCandidate(req, res, next) {
  try {
    if (!req.user) throw new HttpError(401, 'Log in to continue.');
    if (req.user.role !== 'candidate') {
      throw new HttpError(403, 'Candidate portal access requires the candidate role.');
    }
    const user = await User.findById(req.user.id).select('candidateId').lean();
    const target = req.params && (req.params.id || req.params.candidateId);
    if (target && String(target) !== String(user && user.candidateId)) {
      throw new HttpError(403, 'You can only access your own application.');
    }
    if (!user || !user.candidateId) {
      throw new HttpError(409, 'No application is linked to this account yet.');
    }
    req.ownCandidateId = String(user.candidateId);
    next();
  } catch (error) { next(error); }
}

module.exports = {
  TOKEN_TTL_MS,
  ANONYMOUS_ACTOR,
  STAFF_ROLES,
  DEFAULT_ADMIN_SECRET,
  adminSecret,
  verifyAdminSecret,
  hashPassword,
  verifyPassword,
  publicUser,
  bearerToken,
  createSession,
  endSession,
  actorFromToken,
  actorFromRequest,
  requireUser,
  requireRole,
  requireAdmin,
  requireStaff,
  requireCandidate,
  requireOwnCandidate
};
