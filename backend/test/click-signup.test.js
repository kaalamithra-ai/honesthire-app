'use strict';
// Regression test: the logged-out gate "Sign up" button did nothing. It carries data-auth-mode
// but no data-action, and the auth click handler bailed out with `if(!a)return;` before
// reaching the mode-button branch, so the click was silently dropped.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const root = path.resolve(__dirname, "../..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
// Concatenate every inline script: the auth handler lives in the second one.
const code = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g), m => m[1]).join(String.fromCharCode(10));

test('the gate Sign up button opens the modal in signup mode', () => {
  // The gate CTA is markup-only: data-auth-mode and NO data-action, which is exactly why the
  // handler must test for the mode before the [data-action] lookup returns early.
  assert.ok(html.includes('data-auth-mode="signup"'), 'the gate must expose a Sign up CTA.');
  const gate = /<button[^>]*data-auth-mode="signup"[^>]*>/.exec(html);
  assert.ok(gate, 'the Sign up CTA button must exist in the markup.');
  assert.equal(/data-action=/.test(gate[0]), false, 'the gate CTA must not rely on data-action.');

  // The handler must resolve the mode button BEFORE the [data-action] early return.
  const modeIdx = code.indexOf('var modeBtn=t.closest&&t.closest("[data-auth-mode]")');
  assert.ok(modeIdx > -1, 'the auth click handler must test for [data-auth-mode].');
  const bailIdx = code.indexOf('if(!a)return;', modeIdx);
  assert.ok(bailIdx > modeIdx, 'the mode branch must run before the [data-action] early return.');

  // And it must open the modal when it is not already open (the gate case).
  const branch = code.slice(modeIdx, code.indexOf('return;}', modeIdx));
  assert.ok(branch.includes('openLogin()'), 'the mode branch must open the login modal when closed.');
  assert.ok(branch.includes('setAuthMode('), 'the mode branch must apply the requested mode.');
});

test('the modal mode tabs are clickable without a data-action attribute', () => {
  for (const mode of ['login', 'signup']) {
    const btn = new RegExp('<button[^>]*data-auth-mode="' + mode + '"[^>]*>').exec(html);
    assert.ok(btn, 'the modal must expose a ' + mode + ' tab.');
    assert.equal(/data-action=/.test(btn[0]), false, 'the ' + mode + ' tab must not rely on data-action.');
  }
  // paintAuthMode() swaps the submit label and the modal title with the active mode.
  assert.ok(html.includes('auth-submit-btn'), 'the submit button must be relabelled per mode.');
  assert.ok(html.includes('auth-modal-title'), 'the modal title must follow the active mode.');
});