'use strict';
// Vercel cannot run backend/src/server.js: it calls app.listen() and exports no (req,res)
// handler. api/index.js adapts the existing Express app instead. These tests pin the contract.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const root = path.resolve(__dirname, "../..");

test('the adapter exports a request handler instead of listening on a port', () => {
  const src = fs.readFileSync(path.join(root, "api/index.js"), "utf8");
  assert.ok(src.includes("module.exports = async (req, res)"), "api/index.js must export an async (req,res) handler.");
  assert.equal(/^\s*(?!.*\/\/).*\.listen\(/m.test(src), false, "a serverless function must not open a listening socket (comments excluded).");
  assert.equal(src.includes("127.0.0.1"), false, "a serverless function must not bind a host.");
});

test('the adapter reuses one Express app and one Mongo connection per warm instance', () => {
  const src = fs.readFileSync(path.join(root, "api/index.js"), "utf8");
  assert.ok(src.includes("if (!app)"), "the app must be created once and reused.");
  // The connection must be awaited on EVERY invocation. An "if (connecting)" guard is skipped on a
  // cold start (where nothing has connected yet), which let the request reach Express before Mongo
  // was ready and made the first request of every cold start fail.
  assert.ok(src.includes("await getConnection()"), "the handler must always await the shared connection.");
  assert.equal(/if \(connecting\)/.test(src), false, "the connection await must not be conditional.");
  // A failed connection must be retryable rather than replaying a rejected promise.
  assert.ok(src.includes("cached.promise = null"), "a failed connection must be cleared so the next call retries.");
  assert.ok(src.includes("if (!cached.promise)"), "a new attempt must be started only when none is cached.");
});

test('the connection fails fast instead of hanging until the platform timeout', () => {
  const src = fs.readFileSync(path.join(root, "api/index.js"), "utf8");
  // bufferCommands:false stops Mongoose parking queries in an internal buffer while the driver
  // handshakes, which is what turned an unreachable cluster into a 504 rather than an error.
  assert.ok(src.includes("bufferCommands: false"), "connect options must disable Mongoose's command buffer.");
  assert.ok(src.includes("serverSelectionTimeoutMS: 5000"), "the connect must give up after 5 seconds.");
  // A rejection must surface as a 503 rather than the raw driver error.
  assert.ok(src.includes("Database is unavailable."), "an unreachable database must return 503.");
});

test('the adapter does not leak the database error to the client', () => {
  const src = fs.readFileSync(path.join(root, "api/index.js"), "utf8");
  assert.ok(src.includes("Database is unavailable."), "it must return a safe 503 message.");
  assert.equal(/res\.status\(503\)\.json\(\{ error: error\.message/.test(src), false, "it must not echo the raw driver error.");
});

test('vercel.json routes only /api to the adapter and never rewrites static paths', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  const api = cfg.rewrites.find(r => r.source === "/api/(.*)");
  assert.ok(api, "/api/(.*) must be rewritten to the function.");
  assert.equal(api.destination, "/api/index", "the rewrite must point at api/index.");
  // The legacy builds entry pointed at server.js, which cannot run as a function.
  assert.equal(cfg.builds, undefined, "the legacy builds block must be gone.");

  // A catch-all that rewrites a path to itself ("/((?!api/).*)" -> "/$1") makes Vercel resolve a
  // static asset against the rewrite rules forever, so every non-API request hangs until the
  // 300s function timeout. Static files must be served from the filesystem instead, which means
  // the only rewrite allowed is the /api one.
  assert.equal(cfg.rewrites.length, 1, "vercel.json must contain exactly one rewrite (the /api route).");
  const selfReferential = cfg.rewrites.filter(r => r.destination === r.source || /^\/\$1$/.test(r.destination));
  assert.deepEqual(selfReferential, [], "no rewrite may map a path back onto itself (/$1 loops).");
});

test('the liveness probe is answered before any database work', () => {
  const src = fs.readFileSync(path.join(root, "api/index.js"), "utf8");
  assert.ok(src.includes("/api/ping"), "the adapter must recognise the liveness path.");
  // The probe must be checked BEFORE the connection await; a route inside Express would still
  // block for serverSelectionTimeoutMS because the handler connects first.
  const probe = src.indexOf("if (path === LIVE_PATH)");
  const connect = src.indexOf("await getConnection()");
  assert.ok(probe > -1, "the adapter must short-circuit the liveness path.");
  assert.ok(probe < connect, "the liveness check must run before the database await.");
  // It must use raw Node response APIs: there is no Express at this layer.
  assert.ok(src.includes("res.statusCode = 200"), "the probe must set res.statusCode directly.");
  assert.equal(/res\.status\(200\)/.test(src), false, "res.status() does not exist on a raw Node response.");
});

test('the readiness check still reports the real database state', () => {
  const app = fs.readFileSync(path.join(root, "backend/src/app.js"), "utf8");
  // /api/ping is liveness only. /api/health must keep pinging Mongo so it reports 503 when the
  // database is down; a hardcoded 200 there would make the Admin Dashboard lie.
  assert.ok(app.includes("app.get('/api/ping'"), "the Express app must expose the liveness route too.");
  const health = app.slice(app.indexOf("app.get('/api/health'"));
  assert.ok(health.includes("admin().ping()"), "/api/health must still ping the database.");
  assert.ok(health.includes("503"), "/api/health must still return 503 when Mongo is unavailable.");
  assert.ok(app.indexOf("app.get('/api/ping'") < app.indexOf("app.get('/api/health'"), "the liveness route must be registered first.");
});
