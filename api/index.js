'use strict';
// Vercel serverless adapter.
//
// The app is an Express server (backend/src/server.js) that calls app.listen() and binds a port,
// which is correct locally but not on Vercel: a serverless function is invoked with (req, res) and
// must never open a listening socket. backend/src/app.js already exports the Express app, so this
// file is a thin wrapper that connects MongoDB once per warm instance and then delegates.
//
// Local development is unchanged: `npm start` still runs server.js, and this adapter is only
// loaded by the /api routes in vercel.json.
const { mongoose, connectDatabase } = require('../backend/src/db');
const createApp = require('../backend/src/app');

let app = null;
let connecting = null;

// Reuse the app across invocations on a warm instance; reconnect only after a failure so a
// transient Mongo error does not permanently poison the container.
function getApp() {
  if (!app) {
    app = createApp(mongoose);
    connecting = connectDatabase().catch(error => {
      // Allow a later invocation to retry instead of replaying a rejected promise forever.
      connecting = null;
      throw error;
    });
  }
  return app;
}

module.exports = async (req, res) => {
  try {
    // Ensure Mongo is connected before any route runs; the routes themselves reject with 503
    // through requireDatabase when the connection is not ready.
    if (connecting) await connecting;
    return getApp()(req, res);
  } catch (error) {
    // Do not leak the driver error or connection string to the client.
    console.error('Function failed:', error && error.message);
    if (!res.headersSent) res.status(503).json({ error: 'Database is unavailable.' });
  }
};