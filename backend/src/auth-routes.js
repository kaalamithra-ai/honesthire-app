'use strict';
const { Router } = require('express');
const { requireDatabase } = require('./db');
const User = require('./models/User');
const { HttpError, loginInput } = require('./validation');
const { verifyPassword, publicUser, createSession, endSession, requireUser, verifyAdminSecret } = require('./auth');
const { writeAudit } = require('./audit');
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

module.exports = function createAuthRoutes() {
  const router = Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(requireDatabase);
  router.post('/auth/login', wrap(async (req, res) => {
    const { email, password, adminKey } = loginInput(req.body);
        const user = await User.findOne({ email });
    // Same message for unknown accounts and wrong passwords: no account enumeration.
    if (!user || user.active === false || !verifyPassword(password, user)) {
      const reason = !user ? 'unknown_account' : user.active === false ? 'inactive' : 'bad_password';
      await writeAudit(req, 'login_failed', { kind: 'user', label: email }, { reason });
      throw new HttpError(401, 'Invalid email or password.');
    }
        // Master Admin Security Verification: admins must present the platform passcode on
    // top of their email/password before any session token is issued.
    if (user.role === 'admin' && !verifyAdminSecret(adminKey)) {
      await writeAudit(req, 'login_failed', { kind: 'user', id: String(user._id), label: email },
        { reason: adminKey ? 'admin_secret_invalid' : 'admin_secret_missing' });
      throw new HttpError(401, 'Invalid Admin Credentials or Passcode');
    }
const { token, expiresAt } = await createSession(user);
        const loginDetails = { role: user.role };
    if (user.role === 'admin') loginDetails.mfa = 'admin_secret';
    await writeAudit(req, 'login', { kind: 'user', id: String(user._id), label: user.email }, loginDetails, user);
    res.json({ token, expiresAt, user: publicUser(user) });
  }));
    router.post('/auth/logout', requireUser, wrap(async (req, res) => {
    await writeAudit(req, 'logout', { kind: 'user', id: String(req.user.id), label: req.user.email }, { role: req.user.role }, req.user);
    await endSession(req.sessionToken);
    res.status(204).end();
  }));
  router.get('/auth/me', requireUser, (req, res) => res.json({ user: req.user }));
  // Names of the team accounts so the login screen can offer them; passwords are never returned.
  router.get('/auth/team', wrap(async (req, res) => {
    const users = await User.find({ active: true }).sort({ role: 1, name: 1 }).lean();
    res.json({ items: users.map(publicUser) });
  }));
  return router;
};
