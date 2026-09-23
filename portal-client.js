/* Candidate Portal: own application step, document uploads and interview feedback.
 * Tab: #/portal (nav-portal), panel [data-tab-panel="portal"]. Reads GET
 * /api/portal/me and uploads raw bytes to POST /api/portal/documents?kind=&name=,
 * so candidates never touch the staff feed or any other application. */
(function () {
  'use strict';
  var G = function (id) { return document.getElementById(id); };
  var base = (window.HONEST_HIRE_API_BASE || 'http://localhost:5000').replace(/\/+$/, '');
  var stages = ['Applied / Sourced', 'Initial Screening', 'Technical Assessment', 'Background & Reference Checks', 'Offer & Onboarding'];
  function stored(key) {
    try { return window.localStorage ? window.localStorage.getItem(key) : null; } catch (error) { return null; }
  }
  function authHeaders(extra) {
    var headers = {};
    for (var key in (extra || {})) headers[key] = extra[key];
    var token = stored('hh-token');
    if (token) headers.Authorization = 'Bearer ' + token;
    return headers;
  }
  function toastOk(message) {
    var t = G('portal-doc-message'); if (!t) return;
    t.textContent = message; t.className = 'portal-toast portal-toast-ok';
  }
  function toastBad(message) {
    var t = G('portal-doc-message'); if (!t) return;
    t.textContent = message; t.className = 'portal-toast portal-toast-bad';
  }
  function esc(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  async function call(path, options) {
    var settings = options || {};
    var init = { cache: 'no-store', signal: AbortSignal.timeout(settings.timeout || 10000) };
    if (settings.method) init.method = settings.method;
    if (settings.headers) init.headers = settings.headers;
    if (settings.body !== undefined) init.body = settings.body;
    var response = await fetch(base + path, init);
    var data = null;
    try { data = await response.json(); } catch (error) { data = null; }
    if (!response.ok) throw new Error((data && data.error) || ('Request failed (' + response.status + ').'));
    return data;
  }
  function statusText(pipeline) {
    if (!pipeline) return 'Application received';
    var step = Number(pipeline.currentStep) || 1;
    if (String(pipeline.status) === 'completed') return 'Offer accepted · Final step reached';
    if (String(pipeline.status) === 'rejected') return 'Application closed';
    if (String(pipeline.status) === 'on_hold') return 'On hold · Step ' + step + ' of 5';
    return stages[step - 1] || ('Step ' + step + ' of 5');
  }
  function renderStatus(application, feedback) {
    var name = G('portal-application'); if (name) name.textContent = application.name || 'Application';
    var card = G('portal-status-card'); if (card) card.textContent = statusText(application.pipeline);
    var stage = G('portal-stage'); if (stage) stage.textContent = application.pipeline ? ('Step ' + (Number(application.pipeline.currentStep) || 1) + ' of 5') : 'Step 1 of 5';
    var box = G('portal-feedback');
    if (box) {
      var items = Array.isArray(feedback) ? feedback : (application.feedback || []);
      if (!items.length) {
        box.innerHTML = '<p class="portal-empty">No interview feedback has been shared yet.</p>';
      } else {
        box.innerHTML = items.map(function (entry) {
          var text = entry && entry.text ? entry.text : '';
          var author = entry && entry.author ? (' — ' + entry.author + (entry.role ? ' (' + entry.role + ')' : '')) : '';
          return '<div class="portal-feedback-item"><p>' + esc(text) + '</p><p class="portal-feedback-author">' + esc(author) + '</p></div>';
        }).join('');
        box.scrollTop = box.scrollHeight;
      }
    }
  }
  function renderDocuments(items) {
    var list = G('portal-doc-list'); if (!list) return;
    var docs = Array.isArray(items) ? items : [];
    list.innerHTML = docs.length ? docs.map(function (entry) {
      var id = encodeURIComponent(entry.fileId || '');
      var label = (entry.name || 'document') + ' · ' + (entry.kind === 'id_verification' ? 'ID verification' : entry.kind === 'resume' ? 'Resume / CV' : (entry.kind || 'document'));
      return '<div class="portal-doc-item"><span>' + esc(label) + '</span>' +
        '<a href="' + base + '/api/documents/' + id + '?download=1" target="_blank" rel="noopener">Download</a></div>';
    }).join('') : '<p class="portal-empty">No documents uploaded yet.</p>';
    var status = G('portal-doc-status');
    if (status) status.textContent = docs.length ? docs.length + ' file' + (docs.length === 1 ? '' : 's') + ' on your application.' : 'No documents uploaded yet.';
  }
  async function load() {
    var status = G('portal-doc-status');
    if (status) status.textContent = 'Loading your application…';
    try {
      var data = await call('/api/portal/me', { headers: authHeaders() });
      renderStatus(data.candidate || {}, data.feedback || []);
      renderDocuments((data.candidate && data.candidate.documents) || []);
    } catch (error) {
      if (status) status.textContent = 'Could not load your application: ' + error.message;
      toastBad('Could not load your application: ' + error.message);
    }
  }
  async function upload() {
    var fileInput = G('portal-doc-file'), kindInput = G('portal-doc-kind');
    var file = fileInput && fileInput.files && fileInput.files[0];
    if (!file) { toastBad('Choose a file to upload first.'); return; }
    var kind = kindInput && kindInput.value ? kindInput.value : 'resume';
    if (kind !== 'resume' && kind !== 'id_verification') kind = 'resume'; // kind=resume | kind=id_verification
    var button = G('portal-doc-upload');
    if (button) button.disabled = true;
    try {
      var body = await file.arrayBuffer();
      var saved = await call('/api/portal/documents?kind=' + encodeURIComponent(kind) + '&name=' + encodeURIComponent(file.name || 'document'), {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': file.type || 'application/octet-stream' }),
        body: body
      });
      renderDocuments(saved.documents || []);
      if (fileInput) fileInput.value = '';
      toastOk('Document uploaded to your application.');
    } catch (error) {
      toastBad('Upload failed: ' + error.message);
    } finally {
      if (button) button.disabled = false;
    }
  }
  function wire() {
    var button = G('portal-doc-upload');
    if (button && !button.__portalWired) { button.__portalWired = true; button.addEventListener('click', upload); }
  }
  // The portal sandbox only needs element identity plus event/property hooks,
  // so guard the optional DOM wiring used by real browsers.
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('DOMContentLoaded', function () { wire(); load(); });
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') { wire(); }
  window.HonestHirePortal = { load: load, upload: upload };
})();