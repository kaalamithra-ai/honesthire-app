'use strict';
// Regression test for the "Failed to fetch" error on the hosted site. Every client hardcoded
// http://localhost:5000, so a page served from any real host sent its API calls to the
// visitor own machine. The base is now resolved once, with same-origin as the default for
// a hosted page and localhost:5000 only for local development.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, "../..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

const files = ["index.html", "backend-client.js", "admin-client.js", "portal-client.js"];

test('a hosted page no longer hardcodes localhost:5000 as the API base', () => {
  for (const file of files) {
    const src = fs.readFileSync(path.join(root, file), "utf8");
    assert.equal(/HONEST_HIRE_API_BASE\s*\|\|\s*["']http:\/\/localhost:5000/.test(src), false,
      file + " must not default straight to localhost:5000");
  }
  // A single shared resolver owns the decision.
  assert.ok(html.includes("function resolveApiBase()"), "index.html must define resolveApiBase().");
  assert.ok(html.includes("HONEST_HIRE_API_BASE_RESOLVED"), "the resolved base must be published on window.");
});

test('resolveApiBase prefers an override, then same origin, then localhost', () => {
  const start = html.indexOf("function resolveApiBase()");
  const end = html.indexOf("}", html.indexOf("http://localhost:5000", start)) + 1;
  const source = html.slice(start, end);

  const run = location => {
    const win = { location };
    const ctx = vm.createContext({ window: win });
    vm.runInContext(source + ";this.resolveApiBase=resolveApiBase;", ctx);
    return ctx.resolveApiBase();
  };

  // A hosted page must call its own origin so the API can live beside the UI.
  assert.equal(run({ hostname: "honesthire-app.vercel.app", protocol: "https:" }), "",
    "a hosted page must use same-origin");
  // Local development keeps working exactly as before.
  assert.equal(run({ hostname: "localhost", protocol: "http:" }), "http://localhost:5000");
  assert.equal(run({ hostname: "127.0.0.1", protocol: "http:" }), "http://localhost:5000");
});

test('an explicit HONEST_HIRE_API_BASE override always wins', () => {
  const start = html.indexOf("function resolveApiBase()");
  const end = html.indexOf("}", html.indexOf("http://localhost:5000", start)) + 1;
  const source = html.slice(start, end);

  const run = (location, override) => {
    const win = { location };
    if (override) win.HONEST_HIRE_API_BASE = override;
    const ctx = vm.createContext({ window: win });
    vm.runInContext(source + ";this.resolveApiBase=resolveApiBase;", ctx);
    return ctx.resolveApiBase();
  };

  // A trailing slash is stripped so joining "/api/..." never produces a double slash.
  assert.equal(run({ hostname: "localhost", protocol: "http:" }, "https://api.example.com/"), "https://api.example.com");
  assert.equal(run({ hostname: "localhost", protocol: "http:" }, "https://api.example.com"), "https://api.example.com");
  // The override is honoured even for a hosted page.
  assert.equal(run({ hostname: "honesthire-app.vercel.app", protocol: "https:" }, "https://api.example.com"), "https://api.example.com");
});

test('a network failure reports an actionable message, not a bare Failed to fetch', () => {
  assert.ok(html.includes("__hhFriendlyError"), "a friendly error helper must exist.");
  assert.ok(html.includes("No API is deployed at"), "a hosted page must be told no API exists at the URL.");
  assert.ok(html.includes("Could not reach the backend at"), "local development must be told how to start the backend.");
  // The login and signup handlers must use it.
  assert.ok(html.includes("__hhFriendlyError(error,\"/api/auth/login\")"), "login must surface the friendly message.");
  assert.ok(html.includes("__hhFriendlyError(err,\"/api/auth/register\")"), "signup must surface the friendly message.");
});