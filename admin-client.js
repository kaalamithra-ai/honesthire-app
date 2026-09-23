/* Admin Dashboard client — renders the live /api/admin/metrics snapshot plus the team
 roster into #panel-admin, and /api/admin/audit into #panel-audit. Metrics load when the
 page opens on #/admin, when the admin tab is activated and on the Refresh click, so the
 dashes (—) always give way to real MongoDB counts. Relies on window.HonestHire.setActiveTab
 (set by the inline tab controller in index.html) and the hh-token in localStorage. */
(function () {
  'use strict';
  var base = window.HONEST_HIRE_API_BASE || 'http://localhost:5000';
  function getText(id) { var el = document.getElementById(id); return el ? el.textContent : ''; }
  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text === undefined || text === null ? '' : String(text);
  }
  function escText(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }  function getToken() {
    try { return window.localStorage ? window.localStorage.getItem('hh-token') : null; } catch (e) { return null; }
  }
  function headers() {
    var h = {};
    var t = getToken();
    if (t) h.Authorization = 'Bearer ' + t;
    return h;
  }
  async function call(path) {
    var res = await fetch(base + path, { headers: headers(), cache: 'no-store' });
    if (!res.ok) { var err = await res.json().catch(function () { return {}; }); throw new Error(err.error || ('HTTP ' + res.status)); }
    return res.json();
  }
  function renderTeam(members) {
    var box = document.getElementById('admin-team-list');
    if (!box) return;
    box.innerHTML = '';
    members.forEach(function (member) {
      var div = document.createElement('div');
      div.className = 'flex items-center justify-between px-2.5 py-2 rounded-lg bg-surface-container-low';
      div.innerHTML = '<span class="flex items-center gap-2"><span class="material-symbols-outlined text-[16px] text-secondary">person</span><span class="flex flex-col"><span class="font-label-md text-primary">' + member.name + ' · ' + member.email + '</span><span class="font-label-sm text-on-surface-variant">' + member.role + (member.active === false ? ' (suspended)' : '') + '</span></span></span>' +
        '<span class="font-label-sm text-on-surface-variant">' + (member.sessionCount || 0) + ' active session' + (member.sessionCount !== 1 ? 's' : '') + '</span>';
      box.appendChild(div);
    });
  }
  function renderRequisitions(rows) {
    var box = document.getElementById('admin-req-list');
    if (!box) return;
    box.innerHTML = '';
    rows.forEach(function (row) {
      var div = document.createElement('div');
      div.className = 'flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-surface-container-low';
      div.innerHTML = '<span class="font-label-md text-primary">' + (row.reqCode || '—') + '</span><span class="font-body-sm text-on-surface-variant">' + row.candidates + ' candidate' + (row.candidates !== 1 ? 's' : '') + '</span>';
      box.appendChild(div);
    });
  }
  function pick(value, fallback) {
    return value === undefined || value === null || value === '' ? fallback : value;
  }
  function formatUptime(totalSeconds) {
    var seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    var days = Math.floor(seconds / 86400);
    var hours = Math.floor((seconds % 86400) / 3600);
    var minutes = Math.floor((seconds % 3600) / 60);
    var parts = [];
    if (days) parts.push(days + 'd');
    if (hours || days) parts.push(hours + 'h');
    if (minutes || hours || days) parts.push(minutes + 'm');
    parts.push(seconds % 60 + 's');
    return parts.join(' ');
  }
  // One live /api/admin/metrics snapshot fills every dashboard card, so a dash (—)
  // only survives when the field is genuinely unknown.
  function renderMetrics(data) {
    var candidates = data.candidates || {};
    var pipelines = data.pipelines || {};
    var sessions = data.sessions || {};
    var health = data.health || {};
    var storage = data.storage || {};
    var sc = pipelines.statusCounts || {};
    setText('admin-candidates-total', pick(candidates.total, '—'));
    setText('admin-sessions-active', pick(sessions.active, '—'));
    setText('admin-offer-rate', pick(pipelines.offerAcceptanceRate, '—'));
    setText('admin-avg-days', pipelines.averageDaysToHire === null || pipelines.averageDaysToHire === undefined ? '—' : pipelines.averageDaysToHire);
    setText('admin-health-db', pick(health.database, '—'));
    setText('admin-health-status', health.status === 'ok' ? 'Healthy' : health.status === 'degraded' ? 'Degraded' : pick(health.status, '—'));
    setText('admin-uptime', health.uptime === undefined || health.uptime === null ? (health.uptimeSeconds === undefined ? '—' : formatUptime(health.uptimeSeconds)) : String(health.uptime));
    setText('admin-storage-note', pick(storage.note, '—'));
    setText('admin-status-completed', pick(sc.completed, '—'));
    setText('admin-status-in-progress', pick(sc.in_progress, '—'));
    setText('admin-status-pending', pick(sc.pending, '—'));
    renderRequisitions(data.requisitions || []);
  }
  async function loadAdminDashboard() {
    try {
      var metrics = await call('/api/admin/metrics');
      renderMetrics(metrics);
      var team = await call('/api/admin/team');
      renderTeam(team);
    } catch (error) {
      var toast = document.getElementById('live-toast');
      if (toast) { toast.textContent = 'Admin dashboard: ' + error.message; toast.classList.remove('hidden'); }
    }
  }
  function auditRow(entry) {
    var div = document.createElement('div');
    div.className = 'flex items-start justify-between gap-2 px-2.5 py-2 rounded-lg bg-surface-container-low';
    var who = entry.actor && entry.actor.name ? entry.actor.name : 'Signed-out operator';
    var role = entry.actor && entry.actor.role ? entry.actor.role : 'guest';
    var label = entry.target && entry.target.label ? entry.target.label : '';
    var details = entry.details && Object.keys(entry.details).length ? JSON.stringify(entry.details) : '';
    var when = entry.at ? new Date(entry.at).toLocaleString() : '';
    div.innerHTML = '<span class="flex flex-col min-w-0"><span class="font-label-md text-primary">' + escText(entry.action) + '</span>' +
      '<span class="font-body-sm text-body-sm text-on-surface-variant truncate">' + escText(who) + ' (' + escText(role) + ')' + (label ? ' / ' + escText(label) : '') + '</span></span>' +
      '<span class="flex flex-col items-end flex-shrink-0"><span class="font-label-sm text-label-sm text-on-surface-variant">' + escText(when) + '</span>' +
      (details ? '<span class="font-label-sm text-label-sm text-on-surface-variant truncate">' + escText(details) + '</span>' : '') + '</span>';
    return div;
  }
  function renderAudit(payload, action) {
    var box = document.getElementById('audit-list');
    var items = (payload && payload.items) || [];
    if (box) {
      box.innerHTML = '';
      if (!items.length) {
        var empty = document.createElement('p');
        empty.className = 'font-body-sm text-body-sm text-on-surface-variant';
        empty.textContent = 'No audit entries recorded' + (action ? ' for ' + action : '') + '.';
        box.appendChild(empty);
      } else {
        items.forEach(function (entry) { box.appendChild(auditRow(entry)); });
      }
    }
    setText('audit-summary', items.length + ' most recent action' + (items.length === 1 ? '' : 's') + (action ? ' for ' + action : '') + '.');
  }
  async function loadAuditLog() {
    var filter = document.getElementById('audit-filter');
    var action = filter && filter.value ? filter.value : '';
    try {
      var data = await call('/api/admin/audit?limit=50' + (action ? '&action=' + encodeURIComponent(action) : ''));
      renderAudit(data, action);
    } catch (error) {
      setText('audit-summary', 'Audit log unavailable: ' + error.message);
    }
  }
  // Hook into the tab controller: refresh the dashboard whenever the admin tab opens.
  try {
    if (window.HonestHire) {
      var original = window.HonestHire.setActiveTab;
      window.HonestHire.setActiveTab = function (id, push) {
        if (id === 'admin') loadAdminDashboard();
        if (id === 'audit') loadAuditLog();
        if (original) return original(id, push);
      };
    }
  } catch (e) { /* tab controller not ready — dashboard will load on refresh click */ }
  // Page load: fetch immediately when the browser opened on #/admin, otherwise once
  // the DOM is ready — but only while the admin tab is the active route, so the
  // other tabs keep their lazy loading.
  function adminTabActive() {
    try {
      if (window.HonestHire && typeof window.HonestHire.getActiveTab === 'function') return window.HonestHire.getActiveTab() === 'admin';
    } catch (e) { /* fall through to the hash check */ }
    var hash = typeof window.location === 'object' && window.location ? String(window.location.hash || '') : '';
    return hash.indexOf('#/admin') === 0;
  }
  function loadDashboardIfAdminVisible() { if (adminTabActive()) loadAdminDashboard(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadDashboardIfAdminVisible);
  else loadDashboardIfAdminVisible();
  // Refresh button
  var refreshBtn = document.getElementById('admin-refresh');
  if (refreshBtn) refreshBtn.addEventListener('click', loadAdminDashboard);
  var auditRefresh = document.getElementById('audit-refresh');
  if (auditRefresh) auditRefresh.addEventListener('click', loadAuditLog);
  var auditFilter = document.getElementById('audit-filter');
  if (auditFilter) auditFilter.addEventListener('change', loadAuditLog);
})();
