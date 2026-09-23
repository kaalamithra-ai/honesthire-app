'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const code = fs.readFileSync(path.join(root, 'backend-client.js'), 'utf8');
const portalCode = fs.readFileSync(path.join(root, 'portal-client.js'), 'utf8');
const adminCode = fs.readFileSync(path.join(root, 'admin-client.js'), 'utf8');
class Element {
  constructor() { this.children = []; this.value = ''; this.textContent = ''; this.events = {}; this.listeners = {}; this.attrs = {}; this.disabled = false; this.classes = new Set(['hidden']); this.classList = { add: k => this.classes.add(k), remove: k => this.classes.delete(k), contains: k => this.classes.has(k), toggle: (k, on) => on === undefined ? (this.classes.has(k) ? this.classes.delete(k) : this.classes.add(k)) : (on ? this.classes.add(k) : this.classes.delete(k)) }; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(k, fn) { (this.listeners[k] ||= []).push(fn); this.events[k] = fn; }
  focus() {}
  click() { if (this.onclick) return this.onclick(); if (this.events.click) return this.events.click(); }
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test('client renders, filters, selects pipelines, handles failures and retries', async () => {
  const elements = {}, events = {}, requests = [], timers = [], docListeners = [];
  for (const match of html.matchAll(/id="([^"]+)"/g)) elements[match[1]] = new Element();
  elements['cv-search'].value = ''; elements['cv-req'].value = 'all';
  elements['cv-trust'].value = '0'; elements['cv-tier'].value = 'any'; elements['cv-verification'].value = 'all';
  let mode = 'ok', active, slowQuery = null;
  const created = { _id: 'c', name: 'Real Candidate', role: 'Backend Engineer', trustScore: 88, clearanceTier: 4, location: 'Denver, CO', verifiedSkills: ['Go', 'Postgres'], verificationStatus: 'verified', idDocuments: ['US Passport'], pipeline: { reqCode: 'REQ-9001', currentStep: 2, status: 'in_progress', completionPercentage: 40 } };
  const candidates = [
    { _id: 'a', name: 'Elena Rostova', role: 'Architect', trustScore: 98, clearanceTier: 5, location: 'SF', verifiedSkills: ['Raft'], verificationStatus: 'verified', idDocuments: ['Verified US Passport'], pipeline: { reqCode: 'REQ-4091', currentStep: 4, status: 'in_progress', completionPercentage: 98 } },
    { _id: 'b', name: 'Marcus Chen', role: 'Engineer', trustScore: 94, clearanceTier: 4, location: 'Seattle', verifiedSkills: ['React'], verificationStatus: 'verified', idDocuments: ['Verified State ID'], pipeline: { reqCode: 'REQ-4091', currentStep: 2, status: 'in_progress', completionPercentage: 50 } }
  ];
  let resolveSlow = null;
  const feed = async url => {
    const query = url.split('?')[1] || '';
    const params = new URLSearchParams(query);
    if (mode === 'empty') return { items: [], total: 2, matched: 0, reqCodes: ['REQ-4091'] };
    let items = candidates;
    if (params.get('q')) items = items.filter(c => [c.name, c.role, ...c.verifiedSkills].join(' ').toLowerCase().includes(params.get('q').toLowerCase()));
    return { items, total: candidates.length, matched: items.length, reqCodes: ['REQ-4091'] };
  };
  for (const id of ['live-advance', 'live-offer', 'live-hold', 'live-reject']) {
    elements[id].attrs['data-pipeline-action'] = id.replace('live-', '');
  }
  vm.runInNewContext(code, {
    document: { getElementById: id => { assert.ok(elements[id], 'Missing HTML hook: ' + id); return elements[id]; }, createElement: tag => tag === 'progress' ? new Element() : new Element(), addEventListener: (k, fn) => { docListeners.push({ k, fn }); events[k] = fn; } },
    window: { HonestHire: { setActiveTab: tab => { active = tab; } } }, location: { port: '5000', protocol: 'http:' },
    AbortSignal, URLSearchParams,
    setTimeout: (fn, delay) => { const id = { fn, delay }; timers.push(id); return id; },
    clearTimeout: id => { const index = timers.indexOf(id); if (index >= 0) timers.splice(index, 1); },
    Option: function (text, value) { const el = new Element(); el.textContent = text; el.value = value || ''; return el; },
    fetch: async (url, options = {}) => {
      requests.push((options.method || 'GET') + ' ' + url + (options.body ? ' ' + options.body : ''));
      if (options.method === 'POST' && url.includes('/api/candidates')) return { ok: true, json: async () => created };
      if (mode === 'offline') throw new Error('Offline');
      if (url.includes('/api/pipeline/')) {
        if (!options.method) {
          if (mode === 'missing') return { ok: false, json: async () => ({ error: 'Pipeline not found' }) };
          const found = candidates.find(c => c._id === url.split('/').pop());
          if (found) return { ok: true, json: async () => found.pipeline };
          return { ok: true, json: async () => ({ reqCode: 'REQ-4091', currentStep: 4, completionPercentage: 98, status: 'in_progress' }) };
        }
        const action = JSON.parse(options.body).action;
        if (action === 'offer') return { ok: false, json: async () => ({ error: 'Final offer requires Step 5 and 100% completion.' }) };
        if (action === 'advance') return { ok: true, json: async () => ({ reqCode: 'REQ-4091', currentStep: 5, completionPercentage: 98, status: 'in_progress' }) };
        if (action === 'hold') return { ok: true, json: async () => ({ reqCode: 'REQ-4091', currentStep: 4, completionPercentage: 98, status: 'on_hold' }) };
        return { ok: true, json: async () => ({ reqCode: 'REQ-4091', currentStep: 4, completionPercentage: 98, status: 'rejected' }) };
      }
      if (slowQuery && new URLSearchParams(url.split('?')[1] || '').get('q') === slowQuery) return new Promise(resolve => { resolveSlow = () => resolve({ ok: true, json: feed.bind(null, url) }); });
      return { ok: true, json: feed.bind(null, url) };
    }
  });
  events.DOMContentLoaded(); await settle();
  assert.equal(requests[0].startsWith('GET http://localhost:5000/api/candidates?'), true);
  assert.equal(elements['cv-list'].children.length, 2);
  assert.match(elements['cv-status'].textContent, /Showing 2 of 2 candidates/);
  assert.ok(elements['cv-list'].children[0].children.some(child => child.textContent.includes('Verified US Passport')));
  assert.equal(elements['live-pipeline'].children[4].value, 98);
  assert.equal(elements['live-offer'].disabled, true, 'Offer must be disabled before Step 5.');
  await elements['live-advance'].click();
  assert.ok(requests.some(url => url.includes('PATCH') && url.includes('"action":"advance"')));
  assert.match(elements['live-toast'].textContent, /advanced to Step 5.*Saved to MongoDB/);
  assert.equal(elements['live-toast'].attrs['data-kind'], 'ok');
  await elements['live-offer'].click();
  assert.match(elements['live-toast'].textContent, /Step 5 and 100%/);
  assert.equal(elements['live-toast'].attrs['data-kind'], 'error');
  await elements['live-hold'].click();
  assert.match(elements['live-pipeline-status'].textContent, /on hold/);
  elements['cv-list'].children[1].children.at(-1).onclick(); await settle();
  assert.equal(active, 'pipeline'); assert.ok(requests.some(url => url.includes('GET') && url.endsWith('/api/pipeline/b')));
  elements['cv-search'].value = 'Raft'; elements['cv-search'].events.input();
  const timer = timers.pop(); await timer.fn(); await settle();
  assert.ok(requests.some(url => url.includes('q=Raft')));
  assert.equal(elements['cv-list'].children.length, 1);
  slowQuery = 'Raft'; elements['cv-search'].value = 'Raft'; elements['cv-search'].events.input();
  const slow = timers.pop(); const pending = slow.fn();
  elements['cv-search'].value = ''; elements['cv-search'].events.input();
  const fast = timers.pop(); slowQuery = null; await fast.fn(); await settle();
  resolveSlow(); await pending; await settle();
  assert.equal(elements['cv-list'].children.length, 2, 'Slow responses must not overwrite newer filter results.');
  mode = 'missing'; await elements['live-candidate'].events.change({ target: { value: 'a' } });
  assert.match(elements['live-pipeline-status'].textContent, /Pipeline not found/);
  mode = 'offline'; await elements['live-refresh'].onclick();
  assert.equal(elements['cv-list'].children.length, 0);
  assert.match(elements['cv-status'].textContent, /Offline/);
  mode = 'empty'; await elements['live-refresh'].onclick();
  assert.equal(elements['cv-empty'].classes.has('hidden'), false);
  mode = 'ok'; elements['cv-search'].value = ''; await elements['live-refresh'].onclick();
  assert.equal(elements['cv-list'].children.length, 2);
  assert.equal(elements['live-refresh'].disabled, false);
  elements['cv-add-name'].value = 'Real Candidate';
  elements['cv-add-role'].value = 'Backend Engineer';
  elements['cv-add-location'].value = 'Denver, CO';
  elements['cv-add-trust'].value = '88';
  elements['cv-add-tier'].value = '4';
  elements['cv-add-verify'].value = 'verified';
  elements['cv-add-skills'].value = 'Go, Postgres';
  elements['cv-add-docs'].value = 'US Passport';
  elements['cv-add-req'].value = 'REQ-9001';
  elements['cv-add-step'].value = '2';
  elements['cv-add-pct'].value = '40';
  candidates.push(created);
  elements['cv-add-open'].click();
  assert.equal(elements['cv-add-modal'].classes.has('hidden'), false);
  await elements['cv-add-form'].events.submit({ preventDefault() {} }); await settle();
  assert.ok(requests.some(url => url.startsWith('POST') && url.includes('/api/candidates')));
  assert.ok(requests.some(url => url.includes('GET') && url.endsWith('/api/pipeline/c')));
  assert.equal(elements['cv-add-modal'].classes.has('hidden'), true);
  assert.match(elements['live-toast'].textContent, /added to MongoDB/);
});

test('all inline scripts parse and live panels have no static candidate cards', () => {
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(match[1]);
  assert.ok(html.includes('src="backend-client.js"'));
  assert.ok(!html.includes('data-cv-card'));
});
test('pipeline filters and document uploads hit the API and carry the team token', async () => {
  const elements = {}, events = {}, requests = [], timers = [], docListeners = [];
  for (const match of html.matchAll(/id="([^"]+)"/g)) elements[match[1]] = new Element();
  for (const [id, value] of Object.entries({
    'cv-search': '', 'cv-req': 'all', 'cv-trust': '0', 'cv-tier': 'any', 'cv-verification': 'all',
    'pp-search': '', 'pp-stage': 'any', 'pp-verification': 'all', 'pp-tier': 'any',
    'pp-doc-file': '', 'cv-add-file': '', 'live-candidate': '',
    'cv-add-name': 'Real Candidate', 'cv-add-role': 'Backend Engineer', 'cv-add-location': 'Denver, CO',
    'cv-add-trust': '88', 'cv-add-tier': '4', 'cv-add-verify': 'verified', 'cv-add-kind': 'resume',
    'cv-add-req': 'REQ-9001', 'cv-add-step': '2', 'cv-add-pct': '40'
  })) elements[id].value = value;
  const uploaded = { fileId: 'f1', name: 'resume.pdf', kind: 'resume', contentType: 'application/pdf', size: 5, uploadedBy: 'Ava Recruiter', uploadedAt: '2026-09-21T10:00:00.000Z' };
  const created = { _id: 'c', name: 'Real Candidate', role: 'Backend Engineer', trustScore: 88, clearanceTier: 4, location: 'Denver, CO', verifiedSkills: [], verificationStatus: 'verified', idDocuments: [], documents: [], pipeline: { reqCode: 'REQ-9001', currentStep: 2, completionPercentage: 40, status: 'in_progress' } };
  const candidates = [
    { _id: 'a', name: 'Elena Rostova', role: 'Architect', trustScore: 98, clearanceTier: 5, location: 'SF', verifiedSkills: ['Raft'], verificationStatus: 'verified', idDocuments: [], documents: [uploaded], feedback: [{ text: 'Strong systems depth', author: 'Tara Lin' }], pipeline: { reqCode: 'REQ-4091', currentStep: 4, status: 'in_progress', completionPercentage: 98 } },
    { _id: 'b', name: 'Marcus Chen', role: 'Engineer', trustScore: 94, clearanceTier: 4, location: 'Seattle', verifiedSkills: ['React'], verificationStatus: 'pending', idDocuments: [], documents: [], feedback: [], pipeline: { reqCode: 'REQ-4091', currentStep: 5, status: 'completed', completionPercentage: 100 } }
  ];
  const feed = url => {
    const params = new URLSearchParams(url.split('?')[1] || '');
    let items = candidates;
    if (params.get('q')) items = items.filter(c => (c.name + ' ' + c.role).toLowerCase().includes(params.get('q').toLowerCase()));
    if (params.get('stage') && params.get('stage') !== 'any') items = items.filter(c => String(c.pipeline.currentStep) === params.get('stage'));
    if (params.get('verificationStatus') && params.get('verificationStatus') !== 'all') items = items.filter(c => c.verificationStatus === params.get('verificationStatus'));
    if (params.get('tier') && params.get('tier') !== 'any') items = items.filter(c => c.clearanceTier >= Number(params.get('tier')));
    return { items, total: candidates.length, matched: items.length, reqCodes: ['REQ-4091'] };
  };
  const fetchStub = async (url, options = {}) => {
    requests.push((options.method || 'GET') + ' ' + url + (options.headers && options.headers.Authorization ? ' [auth]' : ''));
    if (url.includes('/documents')) {
      if (options.method === 'POST') return { ok: true, json: async () => ({ document: uploaded, documents: [uploaded] }) };
      if (options.method === 'DELETE') return { ok: true, json: async () => ({ removed: 'f1', documents: [] }) };
      return { ok: true, json: async () => ({ candidateId: 'a', candidateName: 'Elena Rostova', items: [uploaded] }) };
    }
    if (options.method === 'POST' && url.endsWith('/api/candidates')) return { ok: true, json: async () => created };
    if (url.includes('/api/pipeline/')) {
      const found = candidates.find(c => c._id === url.split('/').pop());
      return { ok: true, json: async () => found.pipeline };
    }
    return { ok: true, json: async () => feed(url) };
  };
  vm.runInNewContext(code, {
    document: { getElementById: id => { assert.ok(elements[id], 'Missing HTML hook: ' + id); return elements[id]; }, createElement: () => new Element(), addEventListener: (k, fn) => { docListeners.push({ k, fn }); events[k] = fn; } },
    window: { HonestHire: { setActiveTab() {} }, localStorage: { getItem: key => (key === 'hh-token' ? 'team-token' : null), setItem() {}, removeItem() {} } },
    location: { port: '5000', protocol: 'http:' },
    AbortSignal, URLSearchParams,
    setTimeout: (fn, delay) => { const id = { fn, delay }; timers.push(id); return id; },
    clearTimeout: id => { const index = timers.indexOf(id); if (index >= 0) timers.splice(index, 1); },
    Option: function (text, value) { const el = new Element(); el.textContent = text; el.value = value || ''; return el; },
    fetch: fetchStub
  });
  events.DOMContentLoaded(); await settle();
  assert.equal(elements['cv-list'].children.length, 2);
  assert.equal(elements['pp-documents'].children.length, 1, 'Stored documents must render as rows.');
  assert.equal(elements['pp-doc-count'].textContent, '1 file');
  assert.equal(elements['pp-documents'].children[0].children[1].attrs.href, 'http://localhost:5000/api/documents/f1');
  assert.equal(elements['pp-documents'].children[0].children[2].attrs.href, 'http://localhost:5000/api/documents/f1?download=1');
  assert.match(elements['pp-profile'].children.at(-1).textContent, /last by Tara Lin/, 'The dossier shows who wrote the feedback.');
  // Stage filter: server-side, and it must not rewrite the candidate list on the other tab.
  elements['pp-stage'].value = '4';
  elements['pp-stage'].events.change(); await settle();
  const staged = requests.filter(url => url.includes('/api/candidates?') && url.includes('stage=4'));
  assert.equal(staged.length, 1, 'The stage filter must call the API once: ' + requests.join(' | '));
  assert.ok(staged[0].includes('verificationStatus=all') && staged[0].includes('tier=any'), 'Dropdown filters are always sent.');
  assert.equal(elements['pp-match-count'].textContent, '1 of 2 matching');
  assert.equal(elements['cv-list'].children.length, 2, 'Pipeline filters must not rewrite the candidate list.');
  assert.equal(elements['live-candidate'].children.length, 1, 'The pipeline select follows the filters.');
  assert.equal(elements['live-candidate'].children[0].value, 'a');
  // Search is debounced (250 ms) and combined with the active dropdowns.
  elements['pp-search'].value = 'Elena';
  elements['pp-search'].events.input();
  const debounce = timers.pop();
  assert.equal(debounce.delay, 250, 'Pipeline search must be debounced.');
  await debounce.fn(); await settle();
  assert.ok(requests.some(url => url.includes('q=Elena') && url.includes('stage=4')), 'Search must reuse the active filters.');
  // Verification + clearance filters also reach the API.
  elements['pp-search'].value = '';
  elements['pp-verification'].value = 'verified';
  elements['pp-tier'].value = '5';
  elements['pp-tier'].events.change(); await settle();
  assert.ok(requests.some(url => url.includes('verificationStatus=verified') && url.includes('tier=5')), 'Verification and clearance filters are server-side.');
  // Reset filters through the delegated click handler.
  const resetEvent = { target: { closest: selector => (selector.indexOf('pp-reset') > -1 ? { getAttribute: () => 'pp-reset' } : null) } };
  docListeners.filter(entry => entry.k === 'click').forEach(entry => entry.fn(resetEvent));
  await settle();
  assert.equal(elements['pp-stage'].value, 'any');
  assert.equal(elements['pp-verification'].value, 'all');
  assert.equal(elements['pp-search'].value, '');
  assert.ok(requests.some(url => url.includes('stage=any') && url.includes('verificationStatus=all')), 'Reset refetches the unfiltered feed.');
  // Upload from the candidate profile: raw body + bearer token.
  const profileFile = { name: 'resume.pdf', type: 'application/pdf', size: 5, arrayBuffer: async () => new ArrayBuffer(5) };
  elements['pp-doc-file'].files = [profileFile];
  elements['pp-doc-kind'].value = 'id_verification';
  await elements['pp-doc-upload'].events.click(); await settle();
  const upload = requests.find(url => url.startsWith('POST') && url.includes('/api/candidates/a/documents'));
  assert.ok(upload, 'Upload must POST to the candidate document endpoint: ' + requests.join(' | '));
  assert.ok(upload.includes('kind=id_verification') && upload.includes('name=resume.pdf'), 'Metadata travels in the query string.');
  assert.ok(upload.includes('[auth]'), 'Uploads must carry the team session token.');
  assert.match(elements['live-toast'].textContent, /stored in MongoDB/);
  assert.equal(elements['pp-doc-status'].textContent, 'Files linked to this candidate in MongoDB.');
  // The Add-candidate modal attaches the chosen file to the new record.
  const addFile = { name: 'id-scan.png', type: 'image/png', size: 8, arrayBuffer: async () => new ArrayBuffer(8) };
  elements['cv-add-file'].files = [addFile];
  elements['cv-add-kind'].value = 'id_verification';
  await elements['cv-add-form'].events.submit({ preventDefault() {} }); await settle();
  const addUpload = requests.find(url => url.startsWith('POST') && url.includes('/api/candidates/c/documents'));
  assert.ok(addUpload, 'The Add-candidate modal must attach the file after saving: ' + requests.join(' | '));
  assert.ok(addUpload.includes('kind=id_verification') && addUpload.includes('[auth]'));
  assert.match(elements['live-toast'].textContent, /attached to Real Candidate/);
});
test('navigation exposes role-scoped tabs and a candidate portal panel', async () => {
  for (const id of ['nav-admin', 'nav-portal', 'portal', 'portal-panel', 'portal-status-card', 'portal-stage', 'portal-doc-list', 'portal-doc-file', 'portal-doc-kind', 'portal-doc-upload', 'portal-doc-status', 'portal-doc-message', 'portal-feedback', 'portal-application']) {
    const pattern = new RegExp('id=\\"' + id + '\\"');
    assert.ok(pattern.test(html), 'index.html must contain the role/portal hook: ' + id);
  }
  assert.ok(html.includes('data-tab="portal"') && html.includes('data-tab-panel="portal"'), 'The portal tab and panel must follow the same linking convention as the staff tabs.');
  assert.ok(html.includes('roleVisibility') || (html.includes('role === "candidate"') || html.includes("me.role === 'candidate")) || (html.includes('role==="candidate"') || html.includes("role==='candidate'")), 'The header/nav render() must branch on the signed-in role.');
  assert.ok(html.includes('portal-client.js'), 'index.html must load portal-client.js.');
  for (const token of ['/api/portal/me', '/api/portal/documents', 'kind=id_verification', 'kind=resume', 'Bearer ']) {
    assert.ok(portalCode.includes(token), 'portal-client.js must handle: ' + token);
  }
  // The portal UI renders against staged API data through the same mocked DOM style.
  const elements = {};
  for (const match of html.matchAll(/id="([^"]+)"/g)) elements[match[1]] = new Element();
  vm.runInNewContext(portalCode, {
    window: { HONEST_HIRE_API_BASE: 'http://127.0.0.1:5000', HonestHire: {} },
    document: {
      readyState: 'complete',
      addEventListener() {},
      getElementById: id => { assert.ok(elements[id], 'Missing portal DOM hook: ' + id); return elements[id]; },
      createElement: () => new Element()
    },
    localStorage: { getItem: () => 'test-token', setItem() {}, removeItem() {} },
    AbortSignal: { timeout: () => ({}) },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) })
  });
  assert.ok(elements.portal && elements['portal-doc-upload'], 'The portal panel must load against the documented DOM hooks.');
});

test('login screen offers a 3-way role selector that auto-fills demo accounts and redirects by role', () => {
  for (const hook of ['id="auth-role-tabs"', 'data-role-tab="admin"', 'data-role-tab="employee"', 'data-role-tab="candidate"', 'id="auth-role-hint"', 'id="auth-role-admin"', 'id="auth-role-employee"', 'id="auth-role-candidate"']) {
    assert.ok(html.includes(hook), 'index.html must expose the role selector hook: ' + hook);
  }
  for (const demo of ['admin@honesthire.app', 'recruiter@honesthire.app', 'hire1234', 'candidate@honesthire.app', 'candidate1234']) {
    assert.ok(html.includes(demo), 'the login screen must surface the demo credential: ' + demo);
  }
  // Admin credentials are never auto-filled or shipped to the browser.
  assert.equal(html.includes('admin1234'), false, 'The admin demo password must not be auto-filled.');
  assert.equal(html.includes('SHAMANTH@KAALAMITHRA'), false, 'The admin password must never ship in the client bundle.');
  for (const impl of ['var ROLE_TABS=', 'function selectRole', 'function paintRoleTabs', 'function roleTabFor', '"data-role-tab"']) {
    assert.ok(html.includes(impl), 'the inline auth script must implement: ' + impl);
  }
  // Each role maps to its dedicated landing view.
  assert.ok(/admin:\{[^}]*tab:"admin"/.test(html), 'Admin must land on the admin dashboard.');
  assert.ok(/employee:\{[^}]*tab:"candidates"/.test(html), 'Employee must land on the candidates feed.');
  assert.ok(/candidate:\{[^}]*tab:"portal"/.test(html), 'Candidate must land on the candidate portal.');
  assert.ok(html.includes('setActiveTab(picked&&picked.tab'), 'Login must redirect through the app tab router.');
  assert.ok(html.includes('t.closest("[data-role-tab]")'), 'Role tabs must react to clicks.');
  assert.ok(html.includes('selectRole("employee")'), 'The login form must default to a demo account.');
  assert.ok(html.includes('That is a "+signedRole+" account'), 'A role-tab/account mismatch must be refused.');
  // The modal keeps only the role tabs plus the email/password fields: the long
  // team-account list and its per-name fill buttons are gone (compact, no scrolling).
  assert.equal(html.includes('id="auth-team"'), false, 'The team-account list must be removed from the login modal.');
  assert.equal(html.includes('fillTeam'), false, 'fillTeam() must be gone with the list.');
  assert.equal(html.includes('auth-use-account'), false, 'The per-name fill buttons must be gone.');
  assert.equal(html.includes('/api/auth/team'), false, 'The modal must no longer fetch the team list.');
});
test('admin navigation adds an audit log tab and role-scoped nav labels', () => {
  for (const hook of ['id="nav-audit"', 'data-tab="audit"', 'id="panel-audit"', 'data-tab-panel="audit"', 'id="audit-list"', 'id="audit-summary"', 'id="audit-filter"', 'id="audit-refresh"', 'Audit Logs']) {
    assert.ok(html.includes(hook), 'index.html must expose the audit log hook: ' + hook);
  }
  assert.ok(html.includes('audit:{title:"Audit Logs"}'), 'TAB_META must register the audit tab.');
  assert.ok(html.includes('"admin","audit"'), 'Only the admin role may see the audit tab.');
  assert.ok(html.includes('roleLabels'), 'The nav must use role-scoped labels.');
  assert.ok(html.includes('All Candidates') && html.includes('Candidates Feed'), 'Admin sees "All Candidates"; employees see "Candidates Feed".');
  for (const token of ['/api/admin/audit', 'loadAuditLog', 'renderAudit', 'audit-list', 'escText']) {
    assert.ok(adminCode.includes(token), 'admin-client.js must handle: ' + token);
  }
  // Live metrics: the dashboard must pull /api/admin/metrics and fill every card.
  for (const token of ['/api/admin/metrics', 'loadAdminDashboard', 'renderMetrics', 'formatUptime', 'admin-refresh', 'admin-candidates-total', 'admin-sessions-active']) {
    assert.ok(adminCode.includes(token), 'admin-client.js must handle: ' + token);
  }
  for (const hook of ['id="admin-candidates-total"', 'id="admin-sessions-active"', 'id="admin-offer-rate"', 'id="admin-avg-days"', 'id="admin-health-db"', 'id="admin-health-status"', 'id="admin-uptime"', 'id="admin-storage-note"', 'id="admin-status-completed"', 'id="admin-status-in-progress"', 'id="admin-status-pending"', 'checks_updated']) {
    assert.ok(html.includes(hook), 'index.html must expose the live metrics hook: ' + hook);
  }
});
test('admin sign-in is gated by a server-side security passcode', () => {
  for (const hook of ['id="auth-admin-key-field"', 'id="auth-admin-key"', 'autocomplete="one-time-code"', 'Enter admin security key']) {
    assert.ok(html.includes(hook), 'the login modal must expose the admin security key field: ' + hook);
  }
  assert.ok(html.includes('id="auth-admin-key-field" class="hidden'), 'the admin key field must ship hidden until the Admin tab is selected.');
  assert.ok(html.includes('admin:{label:"Admin",email:"admin@honesthire.app",password:"",secret:true'), 'The admin role tab must not carry an auto-filled password.');
  assert.ok(html.includes('Invalid Admin Credentials or Passcode'), 'The exact admin error message must be surfaced.');
  assert.ok(html.includes('Enter the admin security key.'), 'An empty passcode must prompt without calling the API.');
  assert.ok(html.includes('payload.adminKey=adminKey'), 'submit() must send the passcode for the admin tab.');
  assert.ok(html.includes('adminKeyInput.focus()'), 'A failed admin attempt must refocus the passcode field.');
  assert.equal(html.includes('ADMIN-SECRET'), false, 'The passcode must never ship in the client bundle.');
});