'use strict';
const express = require('express');
const cors = require('cors');
const path = require('node:path');
const { HttpError } = require('./validation');
const createRoutes = require('./mongo-routes');
const createAuthRoutes = require('./auth-routes');
const createPortalRoutes = require('./portal-routes');
const createAdminRoutes = require('./admin-routes');

function createApp(db = require('./db').mongoose) {
  const app = express();
  app.disable('x-powered-by');
  const origins = (process.env.CORS_ORIGINS || [5000, 8000, 8001, 8080, 5500, 3001].flatMap(port => [`http://127.0.0.1:${port}`, `http://localhost:${port}`]).join(',')).split(',').map(s => s.trim());
  app.use(cors({ origin(origin, done) {
    done(origin && !origins.includes(origin) ? new HttpError(403, 'Origin not allowed.') : null, true);
  } }));
  app.use(express.json({ limit: '32kb' }));
  app.get('/api/health', async (req, res, next) => {
    try {
      if (db.connection.readyState !== 1) throw new Error('Not connected');
      await db.connection.db.admin().ping();
      res.json({ status: 'ok', database: 'connected' });
    } catch (error) { next(new HttpError(503, 'MongoDB is unavailable.')); }
  });
  // Auth first: /api/auth/login, /api/auth/logout, /api/auth/me, /api/auth/team.
  app.use('/api', createAuthRoutes());
  // Candidate Portal: own-application endpoints, mounted before the generic feed.
  app.use('/api/portal', createPortalRoutes());
  // Admin-only endpoints: strict Admin role gate.
  app.use('/api/admin', createAdminRoutes());
  app.use('/api', createRoutes());
  app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));
  // Serve only public entry points, never the backend directory or database.
  const root = path.resolve(__dirname, '../..');
  app.get(['/', '/index.html'], (req, res) => res.sendFile(path.join(root, 'index.html')));
  app.get('/backend-client.js', (req, res) => res.sendFile(path.join(root, 'backend-client.js')));
  app.get('/admin-client.js', (req, res) => res.sendFile(path.join(root, 'admin-client.js')));
  app.get('/portal-client.js', (req, res) => res.sendFile(path.join(root, 'portal-client.js')));
  app.use((req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.code === 'P2002') return res.status(409).json({ error: 'Email already exists.' });
    if (error.code === 'P2025') return res.status(404).json({ error: 'Record not found.' });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large.' });
    if (!error.status) console.error(error);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Internal server error.' });
  });
  return app;
}
module.exports = createApp;
