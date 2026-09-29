'use strict';
// Standalone liveness probe.
//
// Vercel serves the filesystem before it applies rewrites, so this file answers /api/ping
// directly and never reaches the /api/(.*) -> /api/index rewrite in vercel.json.
//
// It is deliberately dependency-free: no web framework, no database driver, no database handle.
// That means the health signal keeps working even if the main function's modules fail to load or
// the database is unreachable, which is exactly when you most need a liveness answer. The full
// readiness check remains GET /api/health, served by api/index.js.
module.exports = function ping(req, res) {
  if (res.writableEnded) return;
  const body = JSON.stringify({ status: 'ok' });
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
};