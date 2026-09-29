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
const { mongoose } = require('../backend/src/db');
const createApp = require('../backend/src/app');

// One cached connection per warm function instance. Mongoose is told to fail fast
// (serverSelectionTimeoutMS in db.js) and bufferCommands:false is set below, so an unreachable
// Atlas cluster rejects in about five seconds with a 503 instead of hanging until Vercel's 300s
// function timeout. A rejected promise is discarded so the next invocation retries rather than
// replaying the same failure forever.
const cached = { conn: null, promise: null };
let app = null;

const CONNECT_OPTS = {
  // Never let a query sit in Mongoose's buffer while the driver is still handshaking: with no
  // connection the query would wait forever, which is what produced the 504s.
  bufferCommands: false,
  // Fail the connect attempt quickly instead of waiting out the platform timeout.
  serverSelectionTimeoutMS: 5000,
};

async function getConnection() {
  if (!cached.promise) {
    cached.promise = mongoose.connect(process.env.MONGODB_URI, CONNECT_OPTS).then(m => m);
  }
  try {
    cached.conn = await cached.promise;
  } catch (error) {
    // Clear the rejected promise so a later request starts a fresh attempt.
    cached.promise = null;
    cached.conn = null;
    throw error;
  }
  return cached.conn;
}

// Build the Express app once and keep it: rebuilding it per request would re-register every
// router on every invocation.
function getApp() {
  if (!app) app = createApp(mongoose);
  return app;
}

module.exports = async (req, res) => {
  try {
    // Always await the connection (or its failure) before touching the app. Skipping this on a
    // cold start is what let requests reach Express before Mongo was connected.
    await getConnection();
    return getApp()(req, res);
  } catch (error) {
    // Do not leak the driver error or connection string to the client.
    console.error('Function failed:', error && error.message);
    // This runs before Express is ever reached, so `res` is a raw Node response: it has no
    // res.status()/res.json() helpers. Using them here throws and turns a clean 503 into a 500.
    if (!res.headersSent) {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Database is unavailable.' }));
    }
  }
};