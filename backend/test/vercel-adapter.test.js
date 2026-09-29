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
  assert.ok(src.includes("if (connecting) await connecting"), "it must await the shared connection.");
  // A failed connection must be retryable rather than replaying a rejected promise.
  assert.ok(src.includes("connecting = null"), "a failed connection must be cleared so the next call retries.");
});

test('the adapter does not leak the database error to the client', () => {
  const src = fs.readFileSync(path.join(root, "api/index.js"), "utf8");
  assert.ok(src.includes("Database is unavailable."), "it must return a safe 503 message.");
  assert.equal(/res\.status\(503\)\.json\(\{ error: error\.message/.test(src), false, "it must not echo the raw driver error.");
});

test('vercel.json routes /api to the adapter and leaves static files alone', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  const api = cfg.rewrites.find(r => r.source === "/api/(.*)");
  assert.ok(api, "/api/(.*) must be rewritten to the function.");
  assert.equal(api.destination, "/api/index", "the rewrite must point at api/index.");
  // The legacy builds entry pointed at server.js, which cannot run as a function.
  assert.equal(cfg.builds, undefined, "the legacy builds block must be gone.");
  // Static assets must not be captured by the API rewrite.
  const fallback = cfg.rewrites.find(r => r.source !== "/api/(.*)");
  assert.ok(fallback, "a catch-all rewrite must exist for static files.");
  assert.ok(fallback.destination === "/$1", "the catch-all must pass the path through.");
});
