/* Live MongoDB candidate feed, pipeline, documents and team sessions (http://localhost:5000).
 * Server-side filters via GET /api/candidates?q=&reqCode=&minTrust=&tier=&verificationStatus=&stage=
 * returning { items, total, matched, reqCodes }. Cards show verificationStatus, idDocuments and uploads.
 * Live actions via PATCH /api/pipeline/:candidateId { action: advance|offer|hold|reject }.
 * Documents (resumes / ID files) are uploaded raw and stored in GridFS:
 * POST /api/candidates/:id/documents?kind=&name=, GET /api/documents/:fileId (inline or ?download=1),
 * DELETE /api/candidates/:id/documents/:fileId. Uploads and feedback need a team session token
 * (localStorage "hh-token", issued by the login form in index.html), so every write is attributable.
 * The pipeline tab owns a separate filter feed (search + stage/verification/clearance) so filtering
 * there never disturbs the candidate list. The #/checks "Accept & Issue Final Offer" (#checks-offer)
 * stays a standalone offer action. Offer is audit-locked to Step 5 + 100% completion.
 * Toasts confirm MongoDB writes. HONEST_HIRE_API_BASE overrides the default base URL. */
(function () {
  'use strict';
  const G = id => document.getElementById(id);
  const base = window.HONEST_HIRE_API_BASE || 'http://localhost:5000';
  const stages = ['Applied / Sourced', 'Initial Screening', 'Technical Assessment', 'Background & Reference Checks', 'Offer & Onboarding'];
  const docKinds = { resume: 'Resume / CV', id_verification: 'ID verification', other: 'Other document' };
  let candidates = [], selected = '', request = 0, feedRequest = 0, total = 0, searchTimer, addOpen = false;
  let pipelineItems = [], pipelineFeed = 0, pipelineTimer, documents = [];
  function node(tag, text, cls) {
    const el = document.createElement(tag);
    el.textContent = text === undefined || text === null ? '' : String(text);
    if (cls) el.className = cls;
    return el;
  }
  // localStorage is unavailable in some sandboxes: read it defensively.
  function stored(key) {
    try { return window.localStorage ? window.localStorage.getItem(key) : null; } catch (error) { return null; }
  }
  function authToken() { return stored('hh-token') || ''; }
  function authHeaders(extra) {
    const headers = Object.assign({}, extra || {});
    const token = authToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    return headers;
  }
  function promptLogin(message) {
    toast(message || 'Log in with your team account to continue.', false);
    try { if (window.HonestHire && window.HonestHire.openLogin) window.HonestHire.openLogin(); } catch (ignored) { /* login UI is best-effort */ }
  }
  async function call(path, options) {
    const settings = options || {};
    // Only send the keys that were provided: a plain GET must stay a bare fetch.
    const init = { cache: 'no-store', signal: AbortSignal.timeout(settings.timeout || 8000) };
    if (settings.method) init.method = settings.method;
    if (settings.headers) init.headers = settings.headers;
    if (settings.body !== undefined) init.body = settings.body;
    const response = await fetch(base + path, init);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) promptLogin(data.error);
      throw new Error(data.error || 'API request failed.');
    }
    return data;
  }
  function get(path) { return call(path); }
  function send(path, body) {
    return call(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  function post(path, body) {
    return call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  // Shared with the interviews controller in index.html so both use the same feed and token.
  function publish() {
    try {
      const api = window.HonestHire = window.HonestHire || {};
      api.liveCandidates = candidates;
      api.pipelineCandidates = pipelineItems;
      api.authToken = authToken;
      api.authHeaders = authHeaders;
      api.promptLogin = promptLogin;
      api.reloadFeed = load;
      // The interviews list in index.html reuses this feed for its stage/verification/tier filters.
      if (typeof api.refreshInterviews === 'function') api.refreshInterviews();
    } catch (ignored) { /* exposing helpers is best-effort */ }
  }
  function attachedSummary(c) {
    const files = (c.documents || []).filter(entry => entry && entry.fileId);
    if (!files.length) return 'None uploaded';
    return files.length + ' file(s): ' + files.map(entry => entry.name).join(', ');
  }
  function render() {
    // Results are filtered by MongoDB, not a cached browser-side list.
    const items = candidates;
    G('cv-list').replaceChildren();
    items.forEach((c, i) => {
      const card = node('article', '', 'cv-card bg-surface-container-lowest rounded-xl shadow-sm p-space-md flex flex-col gap-space-sm');
      card.append(node('h2', '#' + (i + 1) + ' ' + c.name, 'font-headline-sm text-headline-sm text-primary'),
        node('p', c.role), node('p', c.location), node('p', 'Trust Score ' + c.trustScore + '/100 · Tier ' + c.clearanceTier),
        node('p', 'Verified skills: ' + ((c.verifiedSkills || []).join(', ') || 'None listed')),
        node('p', 'Verification: ' + (c.verificationStatus || 'pending').replaceAll('_', ' ')),
        node('p', 'ID documents: ' + ((c.idDocuments || []).join(', ') || 'None listed')),
        node('p', 'Attached files: ' + attachedSummary(c)),
        node('p', c.pipeline ? c.pipeline.reqCode + ' · Step ' + c.pipeline.currentStep + ' of 5' : 'No pipeline assigned'));
      const button = node('button', 'Open Pipeline', 'py-2 px-3 rounded-xl bg-primary-container text-on-primary');
      button.type = 'button';
      button.onclick = () => { window.HonestHire.setActiveTab('pipeline'); loadPipeline(c._id); };
      card.append(button); G('cv-list').append(card);
    });
    G('cv-count-pill').textContent = items.length + ' ranked';
    G('cv-status').textContent = 'Showing ' + items.length + ' of ' + total + ' candidates from MongoDB.';
    G('cv-empty').classList.toggle('hidden', items.length !== 0);
  }
  let toastTimer;
  function toast(message, ok = true) {
    const el = G('live-toast');
    el.textContent = message;
    el.classList.toggle('hidden', false);
    el.setAttribute('data-kind', ok ? 'ok' : 'error');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.toggle('hidden', true), 4000);
  }
  function showAddModal(open) { addOpen = open; G('cv-add-modal').classList.toggle('hidden', !open); }
  function pickedFile(id) {
    const input = G(id);
    if (!input || !input.files || !input.files.length) return null;
    return input.files[0];
  }
  function resetAddForm() {
    ['cv-add-name', 'cv-add-role', 'cv-add-location', 'cv-add-trust', 'cv-add-skills', 'cv-add-docs', 'cv-add-file', 'cv-add-req', 'cv-add-step', 'cv-add-pct']
      .forEach(id => { G(id).value = ''; });
    G('cv-add-tier').value = '3'; G('cv-add-verify').value = 'pending'; G('cv-add-kind').value = 'resume';
    G('cv-add-error').classList.add('hidden'); G('cv-add-error').textContent = '';
  }
  // Files are sent as raw bytes: name/kind travel in the query string, the type in Content-Type.
  async function uploadDocument(candidateId, file, kind) {
    if (!file) throw new Error('Choose a file first.');
    if (!authToken()) { promptLogin('Log in to upload documents.'); throw new Error('Log in to upload documents.'); }
    if (file.size && file.size > 8 * 1024 * 1024) throw new Error('Files must be 8 MB or smaller.');
    const body = typeof file.arrayBuffer === 'function' ? await file.arrayBuffer() : file;
    const path = '/api/candidates/' + encodeURIComponent(candidateId) + '/documents?kind=' + encodeURIComponent(kind)
      + '&name=' + encodeURIComponent(file.name || 'document');
    const response = await fetch(base + path, {
      method: 'POST', headers: authHeaders({ 'Content-Type': file.type || 'application/octet-stream' }),
      body, cache: 'no-store', signal: AbortSignal.timeout(60000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) promptLogin(data.error);
      throw new Error(data.error || 'Upload failed.');
    }
    return data;
  }
  function deleteDocument(candidateId, fileId) {
    return call('/api/candidates/' + encodeURIComponent(candidateId) + '/documents/' + encodeURIComponent(fileId), { method: 'DELETE' });
  }
  async function submitCandidate(event) {
    event.preventDefault();
    const err = G('cv-add-error'), submit = G('cv-add-submit');
    submit.disabled = true;
    err.classList.remove('hidden'); err.textContent = 'Saving…';
    const list = v => (v || '').split(',').map(s => s.trim()).filter(Boolean);
    const req = G('cv-add-req').value.trim();
    const pipeline = {};
    if (req) {
      pipeline.reqCode = req;
      const step = Number(G('cv-add-step').value);
      if (Number.isInteger(step) && step >= 1 && step <= 5) pipeline.currentStep = step;
      const pct = Number(G('cv-add-pct').value);
      if (Number.isInteger(pct) && pct >= 0 && pct <= 100) pipeline.completionPercentage = pct;
    }
    try {
      const data = await post('/api/candidates', {
        name: G('cv-add-name').value.trim(), role: G('cv-add-role').value.trim(),
        trustScore: Number(G('cv-add-trust').value), clearanceTier: Number(G('cv-add-tier').value),
        location: G('cv-add-location').value.trim(), verificationStatus: G('cv-add-verify').value,
        verifiedSkills: list(G('cv-add-skills').value), idDocuments: list(G('cv-add-docs').value),
        ...(Object.keys(pipeline).length ? { pipeline } : {})
      });
      const file = pickedFile('cv-add-file'), kind = G('cv-add-kind').value || 'other';
      resetAddForm(); showAddModal(false);
      // The live feed is the source of truth: re-render from MongoDB so the
      // new candidate appears without a manual refresh, then select it.
      toast(data.name + ' added to MongoDB.');
      await load();
      await loadPipeline(data._id);
      if (file) {
        // The candidate exists already: attach the resume/ID file to that record.
        try {
          await uploadDocument(data._id, file, kind);
          toast(file.name + ' attached to ' + data.name + ' (GridFS).');
        } catch (error) {
          err.classList.remove('hidden');
          err.textContent = 'Candidate saved, but the document upload failed: ' + error.message;
        }
        await loadDocuments(data._id);
        await load();
      }
    } catch (error) {
      err.classList.remove('hidden'); err.textContent = error.message || 'Could not add the candidate.';
    } finally { submit.disabled = false; }
  }
  function setActionsEnabled(enabled) {
    ['live-advance', 'live-offer', 'live-hold', 'live-reject', 'live-pipeline-refresh', 'live-candidate']
      .forEach(id => { const el = G(id); if (el) el.disabled = !enabled; });
  }
  let currentPipeline = null;
  async function runAction(action) {
    if (!selected) { toast('Select a candidate first.', false); return; }
    setActionsEnabled(false);
    G('live-pipeline-status').textContent = 'Updating pipeline…';
    try {
      const p = await send('/api/pipeline/' + encodeURIComponent(selected), { action });
      currentPipeline = p;
      const c = candidates.find(item => item._id === selected);
      if (c) c.pipeline = p;
      render();
      await loadPipeline(selected, p);
      const names = { advance: 'advanced to Step ' + p.currentStep, offer: 'moved to Final Offer', hold: 'placed on hold', reject: 'rejected' };
      toast((c ? c.name : 'Candidate') + ' ' + names[action] + ' · Saved to MongoDB.');
    } catch (error) {
      await loadPipeline(selected);
      toast('Action failed: ' + error.message, false);
    } finally { setActionsEnabled(true); }
  }
  async function loadPipeline(id, preloaded) {
    selected = id; G('live-candidate').value = id;
    const token = ++request, box = G('live-pipeline');
    box.replaceChildren();
    G('live-pipeline-status').textContent = id ? 'Loading pipeline…' : 'No candidates available.';
    if (!id) return;
    try {
      const p = preloaded || await get('/api/pipeline/' + encodeURIComponent(id));
      if (token !== request) return;
      currentPipeline = p;
      // The candidate can come from either feed: the candidate list or the pipeline filters.
      const c = candidates.find(item => item._id === id) || pipelineItems.find(item => item._id === id);
      if (!c) { G('live-pipeline-status').textContent = 'Candidate left the current filter. Clear search to reload.'; return; }
      box.append(node('h2', c.name, 'font-headline-sm text-headline-sm text-primary'), node('p', c.role),
        node('p', c.location + ' · Trust Score ' + c.trustScore + '/100 · Tier ' + c.clearanceTier),
        node('p', p.reqCode + ' · Step ' + p.currentStep + ' of 5 · ' + p.completionPercentage + '% done'));
      const progress = document.createElement('progress');
      progress.max = 100; progress.value = p.completionPercentage;
      progress.setAttribute('aria-label', 'Pipeline completion'); box.append(progress);
      const list = document.createElement('ol');
      stages.forEach((name, i) => {
        const item = node('li', (i + 1) + '. ' + name + (i + 1 === p.currentStep ? ' — Current step' : ''));
        if (i + 1 === p.currentStep) item.setAttribute('aria-current', 'step');
        list.append(item);
      });
      box.append(list);
      const locked = p.status === 'completed' || p.status === 'rejected';
      G('live-advance').disabled = locked || p.currentStep >= 5;
      G('live-offer').disabled = locked || p.currentStep !== 5 || p.completionPercentage !== 100;
      G('live-hold').disabled = locked;
      G('live-reject').disabled = locked;
      G('live-pipeline-status').textContent = 'Status: ' + p.status.replaceAll('_', ' ') + ' · Read from MongoDB';
      renderProfile(c, p);
      await loadDocuments(id);
    } catch (error) {
      if (token === request) G('live-pipeline-status').textContent = 'Unable to load pipeline: ' + error.message + ' Use Refresh to retry.';
    }
  }
  function sizeText(entry) {
    const bytes = Number(entry && entry.size) || 0;
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
  function dateText(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return 'stored in MongoDB';
    return date.toLocaleDateString();
  }
  // Dossier above the tracker: the same MongoDB record the pipeline actions write to.
  function renderProfile(c, p) {
    const box = G('pp-profile');
    box.replaceChildren();
    if (!c) { box.append(node('p', 'Select a candidate to load their profile.', 'font-body-sm text-body-sm text-on-surface-variant')); return; }
    box.append(node('h2', c.name, 'font-headline-sm text-headline-sm text-primary'),
      node('p', c.role, 'font-body-sm text-body-sm text-on-surface-variant'));
    const grid = node('div', '', 'grid grid-cols-2 md:grid-cols-4 gap-2');
    [['Location', c.location], ['Trust score', c.trustScore + '/100'], ['Clearance tier', 'Tier ' + c.clearanceTier],
      ['Verification', (c.verificationStatus || 'pending').replaceAll('_', ' ')]].forEach(cell => {
      const boxed = node('div', '', 'flex flex-col gap-0.5 p-2 rounded-lg bg-surface-container-low');
      boxed.append(node('span', cell[0], 'font-label-sm text-label-sm text-on-surface-variant'),
        node('span', cell[1], 'font-label-md text-label-md text-primary font-semibold'));
      grid.append(boxed);
    });
    box.append(grid);
    box.append(node('p', 'Verified skills: ' + (((c.verifiedSkills || []).join(', ')) || 'None listed'), 'font-body-sm text-body-sm text-on-surface-variant'));
    box.append(node('p', 'ID documents on file: ' + (((c.idDocuments || []).join(', ')) || 'None listed'), 'font-body-sm text-body-sm text-on-surface-variant'));
    if (p) {
      const stage = stages[p.currentStep - 1] || 'Stage ' + p.currentStep;
      box.append(node('p', 'Pipeline: ' + p.reqCode + ' · Step ' + p.currentStep + ' — ' + stage + ' · ' + p.status.replaceAll('_', ' '), 'font-body-sm text-body-sm text-on-surface-variant'));
    }
    const feedback = c.feedback || [];
    const last = feedback.length ? feedback[feedback.length - 1] : null;
    box.append(node('p', 'Interview feedback: ' + feedback.length + (feedback.length === 1 ? ' entry' : ' entries')
      + (last ? ' · last by ' + (last.author || 'Team member') : ' · none yet'), 'font-body-sm text-body-sm text-on-surface-variant'));
  }
  function renderDocuments(items) {
    documents = Array.isArray(items) ? items.filter(entry => entry && typeof entry.fileId === 'string') : [];
    const box = G('pp-documents');
    box.replaceChildren();
    documents.forEach(entry => {
      const row = node('div', '', 'flex flex-wrap items-center gap-2 p-2.5 rounded-lg bg-surface-container-low');
      const meta = node('div', '', 'flex flex-col gap-0.5 flex-1 min-w-0');
      meta.append(node('span', (docKinds[entry.kind] || entry.kind || 'Document') + ' · ' + entry.name, 'font-label-md text-label-md text-primary font-semibold truncate'),
        node('span', sizeText(entry) + ' · ' + entry.contentType + ' · uploaded by ' + (entry.uploadedBy || 'Team member') + ' on ' + dateText(entry.uploadedAt), 'font-body-sm text-body-sm text-on-surface-variant truncate'));
      const view = node('a', 'View', 'px-3 py-1.5 rounded-lg bg-surface-container text-primary font-label-sm text-label-sm');
      view.setAttribute('href', base + '/api/documents/' + entry.fileId);
      view.setAttribute('target', '_blank');
      view.setAttribute('rel', 'noopener');
      const download = node('a', 'Download', 'px-3 py-1.5 rounded-lg bg-surface-container text-primary font-label-sm text-label-sm');
      download.setAttribute('href', base + '/api/documents/' + entry.fileId + '?download=1');
      const remove = node('button', 'Remove', 'px-3 py-1.5 rounded-lg bg-error-container text-on-error-container font-label-sm text-label-sm');
      remove.type = 'button';
      remove.setAttribute('data-action', 'pp-doc-remove');
      remove.setAttribute('data-file-id', entry.fileId);
      row.append(meta, view, download, remove);
      box.append(row);
    });
    G('pp-doc-count').textContent = documents.length + (documents.length === 1 ? ' file' : ' files');
    G('pp-doc-empty').classList.toggle('hidden', documents.length !== 0);
  }
  async function loadDocuments(candidateId) {
    const status = G('pp-doc-status');
    if (!candidateId) { renderDocuments([]); if (status) status.textContent = ''; return; }
    try {
      const data = await get('/api/candidates/' + encodeURIComponent(candidateId) + '/documents');
      if (selected !== candidateId) return;
      renderDocuments(data.items);
      if (status) status.textContent = documents.length ? 'Files linked to this candidate in MongoDB.' : '';
    } catch (error) {
      if (selected !== candidateId) return;
      renderDocuments([]);
      if (status) status.textContent = 'Could not list documents: ' + error.message;
    }
  }
  function refreshCandidateOptions() {
    const select = G('live-candidate');
    const previous = select.value || selected;
    const items = pipelineItems.slice();
    // Keep the candidate opened from a card selectable even when filters exclude it.
    if (selected && !items.some(item => item._id === selected)) {
      const current = candidates.find(item => item._id === selected);
      if (current) items.push(current);
    }
    select.replaceChildren();
    items.forEach(item => {
      const option = new Option(item.name, item._id);
      option.value = item._id;
      select.append(option);
    });
    if (items.some(item => item._id === previous)) select.value = previous;
    else if (items.length) select.value = items[0]._id;
  }
  // Pipeline tab filters: real-time search + stage / verification / clearance dropdowns,
  // server-side and separate from the candidate list so filtering here never rewrites that tab.
  async function loadPipelineFeed() {
    clearTimeout(pipelineTimer);
    const token = ++pipelineFeed;
    G('pp-status').textContent = 'Filtering candidates…';
    const params = new URLSearchParams({
      q: G('pp-search').value.trim(), stage: G('pp-stage').value,
      verificationStatus: G('pp-verification').value, tier: G('pp-tier').value
    });
    try {
      const data = await get('/api/candidates?' + params);
      if (token !== pipelineFeed) return;
      pipelineItems = data.items || [];
      refreshCandidateOptions();
      G('pp-match-count').textContent = pipelineItems.length + ' of ' + (data.total || pipelineItems.length) + ' matching';
      G('pp-status').textContent = 'Showing ' + pipelineItems.length + ' of ' + (data.total || pipelineItems.length) + ' candidates for these filters.';
      G('pp-empty').classList.toggle('hidden', pipelineItems.length !== 0);
      const keep = pipelineItems.some(item => item._id === selected) ? selected : (pipelineItems[0] ? pipelineItems[0]._id : '');
      publish();
      await loadPipeline(keep);
    } catch (error) {
      if (token !== pipelineFeed) return;
      G('pp-status').textContent = 'Unable to filter candidates: ' + error.message;
      G('pp-empty').classList.toggle('hidden', true);
    }
  }
  async function load() {
    clearTimeout(searchTimer);
    const token = ++feedRequest;
    ++request; // Invalidate any pipeline request from the previous feed.
    G('live-refresh').disabled = true;
    G('cv-status').textContent = 'Loading candidates…';
    G('cv-list').replaceChildren();
    G('cv-empty').classList.add('hidden');
    G('live-pipeline').replaceChildren();
    G('live-candidate').disabled = true;
    G('live-pipeline-status').textContent = 'Loading candidates…';
    const params = new URLSearchParams({
      q: G('cv-search').value.trim(), reqCode: G('cv-req').value,
      minTrust: G('cv-trust').value, tier: G('cv-tier').value,
      verificationStatus: G('cv-verification').value
    });
    try {
      const data = await get('/api/candidates?' + params);
      if (token !== feedRequest) return;
      candidates = data.items; total = data.total;
      publish();
      G('live-candidate').replaceChildren();
      candidates.forEach(c => {
        const option = node('option', c.name); option.value = c._id; G('live-candidate').append(option);
      });
      // Global requisition options must not shrink with filtered results.
      const prev = G('cv-req').value;
      const reqs = [...new Set([...(data.reqCodes || []), ...(prev && prev !== 'all' ? [prev] : [])])];
      G('cv-req').replaceChildren(new Option('All requisitions', 'all'), ...reqs.map(r => new Option(r, r)));
      G('cv-req').value = prev || 'all';
      render();
      G('live-candidate').disabled = candidates.length === 0;
      await loadPipeline(candidates.some(c => c._id === selected) ? selected : (candidates[0]?._id || ''));
    } catch (error) {
      if (token !== feedRequest) return;
      candidates = []; ++request;
      G('cv-list').replaceChildren(); G('live-pipeline').replaceChildren(); G('live-candidate').replaceChildren();
      G('cv-count-pill').textContent = 'Unavailable'; G('cv-empty').classList.add('hidden');
      G('cv-status').textContent = 'Unable to load candidates: ' + error.message + ' Start the backend, then Refresh.';
      G('live-pipeline-status').textContent = 'Candidate data unavailable. Use Refresh to retry.';
    } finally { if (token === feedRequest) G('live-refresh').disabled = false; }
  }
  document.addEventListener('DOMContentLoaded', () => {
    G('cv-search').addEventListener('input', () => {
      clearTimeout(searchTimer);
      ++feedRequest; ++request;
      G('cv-status').textContent = 'Searching…';
      searchTimer = setTimeout(load, 250);
    });
    ['cv-req', 'cv-trust', 'cv-tier', 'cv-verification'].forEach(id => G(id).addEventListener('change', load));
    G('live-candidate').addEventListener('change', e => loadPipeline(e.target.value));
    // Pipeline tab: debounced real-time search + instant stage / verification / clearance changes.
    G('pp-search').addEventListener('input', () => {
      clearTimeout(pipelineTimer);
      G('pp-status').textContent = 'Filtering…';
      pipelineTimer = setTimeout(loadPipelineFeed, 250);
    });
    ['pp-stage', 'pp-verification', 'pp-tier'].forEach(id => G(id).addEventListener('change', loadPipelineFeed));
    document.addEventListener('click', e => {
      if (e.target.closest('[data-action="pp-reset"]')) {
        G('pp-search').value = ''; G('pp-stage').value = 'any';
        G('pp-verification').value = 'all'; G('pp-tier').value = 'any';
        loadPipelineFeed();
      }
    });
    // Document upload / removal for the selected candidate (GridFS through the API).
    G('pp-doc-upload').addEventListener('click', async () => {
      const file = pickedFile('pp-doc-file'), status = G('pp-doc-status');
      if (!selected) { status.textContent = 'Select a candidate first.'; return; }
      if (!file) { status.textContent = 'Choose a file to upload.'; return; }
      const kind = G('pp-doc-kind').value || 'other';
      status.textContent = 'Uploading ' + file.name + '…';
      try {
        await uploadDocument(selected, file, kind);
        G('pp-doc-file').value = '';
        await loadDocuments(selected);
        toast(file.name + ' stored in MongoDB (GridFS).');
      } catch (error) {
        status.textContent = 'Upload failed: ' + error.message;
        toast('Upload failed: ' + error.message, false);
      }
    });
    document.addEventListener('click', async e => {
      const button = e.target.closest('[data-action="pp-doc-remove"]');
      if (!button || !selected) return;
      const fileId = button.getAttribute('data-file-id');
      if (!fileId) return;
      G('pp-doc-status').textContent = 'Removing file…';
      try {
        await deleteDocument(selected, fileId);
        await loadDocuments(selected);
        toast('Document removed from MongoDB.');
      } catch (error) {
        G('pp-doc-status').textContent = 'Could not remove the file: ' + error.message;
        toast('Could not remove the file: ' + error.message, false);
      }
    });
    G('live-refresh').onclick = load;
    G('cv-add-open').onclick = () => { resetAddForm(); showAddModal(true); G('cv-add-name').focus(); };
    G('cv-add-form').addEventListener('submit', submitCandidate);
    document.addEventListener('click', e => { if (e.target.closest('[data-action="cv-close-add"]')) showAddModal(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && addOpen) showAddModal(false); });
    G('live-pipeline-refresh').onclick = () => loadPipeline(selected);
    ['live-advance', 'live-offer', 'live-hold', 'live-reject'].forEach(id => {
      const el = G(id);
      if (el) el.addEventListener('click', () => runAction(el.getAttribute('data-pipeline-action') || 'offer'));
    });
    const checksOffer = G('checks-offer');
    if (checksOffer) checksOffer.addEventListener('click', async () => {
      // Standalone #/checks action: stay on this tab while the request runs,
      // PATCH /api/pipeline/:id { action: "offer" }, write success or the
      // 409 audit-gate error into #live-toast, then reveal the pipeline tab
      // so the toast is visible (it lives inside the hidden pipeline panel).
      const goPipeline = () => {
        try {
          if (window.HonestHire && window.HonestHire.setActiveTab) window.HonestHire.setActiveTab('pipeline');
        } catch (ignored) { /* navigation best-effort */ }
      };
      let id = selected;
      if (!id) {
        try {
          const feed = await get('/api/candidates');
          id = feed.items && feed.items[0] ? feed.items[0]._id : '';
        } catch (error) {
          toast('Action failed: ' + error.message, false);
          goPipeline();
          return;
        }
      }
      if (!id) { toast('Select a candidate first.', false); goPipeline(); return; }
      checksOffer.disabled = true;
      toast('Issuing final offer…', true);
      try {
        const p = await send('/api/pipeline/' + encodeURIComponent(id), { action: 'offer' });
        selected = id;
        const c = candidates.find(item => item._id === id);
        if (c) {
          c.pipeline = p;
          render();
        }
        await loadPipeline(id, p);
        toast((c ? c.name : 'Candidate') + ' moved to Final Offer · Saved to MongoDB.', true);
      } catch (error) {
        if (selected) { try { await loadPipeline(selected); } catch (ignored) { /* status refresh best-effort */ } }
        toast('Action failed: ' + error.message, false);
      } finally {
        checksOffer.disabled = false;
        goPipeline();
      }
    });
    document.addEventListener('click', e => {
      if (e.target.closest('[data-action="cv-reset"]')) {
        G('cv-search').value = ''; G('cv-req').value = 'all'; G('cv-trust').value = '0'; G('cv-tier').value = 'any';
        G('cv-verification').value = 'all'; load();
      }
    });
    publish();
    load();
  });
})();
