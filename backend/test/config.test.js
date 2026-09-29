'use strict';
// The API base URL is read once on the server and injected into the static page by GET /config.js.
// process.env is unavailable in the browser, so the runtime injection is the correct pattern for
// a frontend with no build step.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const root = path.resolve(__dirname, "../..");

const load = (env) => {
  const saved = {};
  for (const key of ["NEXT_PUBLIC_API_URL", "REACT_APP_API_URL"]) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  delete require.cache[require.resolve("../src/config")];
  const value = require("../src/config");
  for (const key of Object.keys(saved)) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  delete require.cache[require.resolve("../src/config")];
  return value;
};

test('API_BASE_URL falls back to the local API when no environment variable is set', () => {
  const { API_BASE_URL, apiBaseUrl } = load({});
  assert.equal(API_BASE_URL, "http://127.0.0.1:5000");
  assert.equal(apiBaseUrl, "http://127.0.0.1:5000");
});

test('NEXT_PUBLIC_API_URL and REACT_APP_API_URL override the default', () => {
  assert.equal(load({ NEXT_PUBLIC_API_URL: "https://api.example.com" }).API_BASE_URL, "https://api.example.com");
  assert.equal(load({ REACT_APP_API_URL: "https://legacy.example.com" }).API_BASE_URL, "https://legacy.example.com");
  // NEXT_PUBLIC_ wins when both are present.
  const both = load({ NEXT_PUBLIC_API_URL: "https://a.example.com", REACT_APP_API_URL: "https://b.example.com" });
  assert.equal(both.API_BASE_URL, "https://a.example.com");
});

test('a trailing slash is stripped so /api/... never doubles up', () => {
  assert.equal(load({ NEXT_PUBLIC_API_URL: "https://api.example.com/" }).apiBaseUrl, "https://api.example.com");
});

test('the page loads /config.js before it resolves the API base', () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.ok(html.includes('<script src="/config.js"></script>'), "index.html must load the injected config.");
  // It must come before the inline script that calls resolveApiBase().
  const configAt = html.indexOf('<script src="/config.js"></script>');
  const resolverAt = html.indexOf("function resolveApiBase()");
  assert.ok(configAt > -1 && configAt < resolverAt, "/config.js must be requested before the base is resolved.");
});

test('the server exposes the resolved base as a global assignment', () => {
  const app = fs.readFileSync(path.join(root, "backend/src/app.js"), "utf8");
  assert.ok(app.includes("app.get('/config.js'"), "the server must serve /config.js.");
  assert.ok(app.includes("window.HONEST_HIRE_API_BASE = "), "it must assign the base to the window global.");
  assert.ok(app.includes("apiBaseUrl"), "it must use the resolved value from config.js.");
});

test('.env.example documents the API base URL', () => {
  const example = fs.readFileSync(path.join(root, "backend/.env.example"), "utf8");
  assert.ok(example.includes("NEXT_PUBLIC_API_URL="), ".env.example must document NEXT_PUBLIC_API_URL.");
  assert.ok(example.includes("http://127.0.0.1:5000"), ".env.example must show the local default.");
  // The committed example must not carry a real admin passcode.
  assert.equal(example.includes("8884014055"), false, ".env.example must not ship the old hardcoded passcode.");
});
