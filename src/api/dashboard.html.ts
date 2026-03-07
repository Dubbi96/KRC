/** Embedded HTML for the Local Runner Management Dashboard */
export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Katab Runner Console</title>
  <style>
    :root {
      --bg: #0f172a; --card: #1e293b; --card2: #273549;
      --border: #334155; --text: #e2e8f0; --muted: #94a3b8;
      --accent: #3b82f6; --success: #22c55e; --error: #ef4444; --warn: #f59e0b;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: var(--bg); color: var(--text); font-family: -apple-system, system-ui, 'Segoe UI', Roboto, sans-serif; font-size: 13px; line-height: 1.5; }
    .layout { display: flex; height: 100vh; }
    .sidebar { width: 200px; background: var(--card); border-right: 1px solid var(--border); display: flex; flex-direction: column; flex-shrink: 0; }
    .sidebar-header { padding: 16px; border-bottom: 1px solid var(--border); }
    .sidebar-header h1 { font-size: 15px; font-weight: 700; color: #fff; }
    .sidebar-header .sub { font-size: 10px; color: var(--muted); margin-top: 2px; }
    .sidebar-header .status { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; margin-top: 6px; padding: 2px 8px; border-radius: 99px; }
    .sidebar-header .status.on { background: rgba(34,197,94,.15); color: var(--success); }
    .sidebar-header .status.off { background: rgba(239,68,68,.15); color: var(--error); }
    .dot { width: 5px; height: 5px; border-radius: 50%; }
    .dot.on { background: var(--success); animation: pulse-dot 1.2s ease-in-out infinite; }
    .dot.off { background: var(--error); }
    @keyframes pulse-dot { 0%,100%{opacity:1}50%{opacity:.4} }
    .nav { flex: 1; padding: 8px; }
    .nav-item { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 8px; font-size: 12px; cursor: pointer; color: var(--muted); border: none; background: none; width: 100%; text-align: left; transition: all .12s; }
    .nav-item:hover { background: var(--card2); color: #fff; }
    .nav-item.active { background: var(--accent); color: #fff; }
    .nav-item svg { width: 14px; height: 14px; }
    .sidebar-footer { padding: 12px; border-top: 1px solid var(--border); font-size: 10px; color: var(--border); }
    .main { flex: 1; overflow-y: auto; padding: 24px; }
    .page { display: none; animation: fadeIn .2s cubic-bezier(.2,0,0,1); }
    .page.active { display: block; }
    @keyframes fadeIn { 0%{opacity:0;transform:translateY(6px)}100%{opacity:1;transform:translateY(0)} }
    .page-title { font-size: 16px; font-weight: 700; color: #fff; margin-bottom: 16px; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 14px; margin-bottom: 10px; }
    .card h3 { font-size: 11px; color: var(--muted); font-weight: 500; text-transform: uppercase; letter-spacing: .4px; margin-bottom: 8px; }
    .stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 16px; }
    .stat-card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 12px; }
    .stat-card .num { font-size: 22px; font-weight: 700; color: #fff; }
    .stat-card .lbl { font-size: 10px; color: var(--muted); margin-top: 2px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .info-item { font-size: 11px; }
    .info-item .label { color: var(--muted); }
    .info-item .value { color: #fff; font-weight: 500; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th { text-align: left; color: var(--muted); font-weight: 500; padding: 6px 8px; border-bottom: 1px solid var(--border); }
    td { padding: 6px 8px; border-bottom: 1px solid rgba(51,65,85,.4); color: var(--text); }
    tr:hover td { background: rgba(39,53,73,.3); }
    .badge { display: inline-block; padding: 1px 7px; border-radius: 99px; font-size: 10px; font-weight: 600; }
    .badge-online,.badge-running { background: rgba(34,197,94,.15); color: var(--success); }
    .badge-offline,.badge-stopped { background: rgba(107,114,128,.15); color: #6b7280; }
    .badge-busy,.badge-starting { background: rgba(245,158,11,.15); color: var(--warn); }
    .badge-error { background: rgba(239,68,68,.15); color: var(--error); }
    .badge-not_required { background: rgba(107,114,128,.1); color: #4b5563; }
    .badge-queued { background: rgba(245,158,11,.15); color: var(--warn); }
    .badge-completed,.badge-passed { background: rgba(34,197,94,.15); color: var(--success); }
    .badge-failed,.badge-infra_failed { background: rgba(239,68,68,.15); color: var(--error); }
    .badge-cancelled { background: rgba(107,114,128,.15); color: #6b7280; }
    .mono { font-family: 'SF Mono', Menlo, monospace; }
    .queue-tabs { display: flex; gap: 3px; margin-bottom: 8px; }
    .q-tab { padding: 3px 10px; border-radius: 6px; font-size: 10px; font-weight: 600; cursor: pointer; border: none; background: var(--card2); color: var(--muted); transition: all .12s; text-transform: uppercase; }
    .q-tab:hover { color: #fff; }
    .q-tab.active { background: var(--accent); color: #fff; }
    .q-stat-row { display: grid; grid-template-columns: repeat(5,1fr); gap: 6px; margin-bottom: 10px; }
    .q-stat { text-align: center; padding: 8px; background: var(--card2); border-radius: 6px; border: 1px solid var(--border); }
    .q-stat .n { font-size: 16px; font-weight: 700; }
    .q-stat .l { font-size: 9px; color: var(--muted); text-transform: uppercase; }
    .q-stat.waiting .n { color: var(--warn); }
    .q-stat.active .n { color: var(--accent); }
    .q-stat.completed .n { color: var(--success); }
    .q-stat.failed .n { color: var(--error); }
    .q-stat.delayed .n { color: #f97316; }
    .job-status-tabs { display: flex; gap: 3px; margin-bottom: 8px; }
    .js-tab { padding: 3px 10px; border-radius: 6px; font-size: 10px; font-weight: 500; cursor: pointer; border: none; background: transparent; color: var(--muted); transition: all .12s; }
    .js-tab:hover { background: var(--card2); color: #fff; }
    .js-tab.active { background: var(--accent); color: #fff; }
    .btn { padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 500; cursor: pointer; border: none; transition: all .12s; }
    .btn-retry { background: rgba(59,130,246,.15); color: var(--accent); }
    .btn-retry:hover { background: rgba(59,130,246,.3); }
    .btn-remove { background: rgba(239,68,68,.15); color: var(--error); }
    .btn-remove:hover { background: rgba(239,68,68,.3); }
    .log-box { background: var(--card2); border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; max-height: 240px; overflow-y: auto; font-family: 'SF Mono', Menlo, monospace; font-size: 10px; color: var(--muted); }
    .log-box div { padding: 1px 0; }
    .log-t { color: var(--border); margin-right: 4px; }
    .resource-bar { height: 6px; background: var(--card2); border-radius: 3px; overflow: hidden; margin-top: 4px; }
    .resource-bar-fill { height: 100%; border-radius: 3px; transition: width .3s; }
    .empty { padding: 20px; text-align: center; color: var(--muted); font-size: 12px; }
    /* Platform process cards */
    .platform-section { margin-bottom: 16px; }
    .platform-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
    .platform-header h4 { font-size: 13px; font-weight: 600; color: #fff; text-transform: uppercase; }
    .platform-icon { width: 28px; height: 28px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 14px; }
    .platform-icon.web { background: rgba(59,130,246,.15); }
    .platform-icon.ios { background: rgba(34,197,94,.15); }
    .platform-icon.android { background: rgba(245,158,11,.15); }
    .process-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: var(--card2); border-radius: 6px; margin-bottom: 4px; border: 1px solid var(--border); }
    .process-info { display: flex; align-items: center; gap: 8px; }
    .process-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
    .process-dot.running { background: var(--success); animation: pulse-dot 1.2s ease-in-out infinite; }
    .process-dot.starting { background: var(--warn); animation: pulse-dot .6s ease-in-out infinite; }
    .process-dot.stopped { background: #4b5563; }
    .process-dot.error { background: var(--error); }
    .process-dot.not_required { background: #374151; }
    .process-name { font-size: 12px; font-weight: 500; color: var(--text); }
    .process-meta { font-size: 10px; color: var(--muted); }
    .process-error { font-size: 10px; color: var(--error); margin-top: 2px; }
    .ready-badge { font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 99px; }
    .ready-badge.yes { background: rgba(34,197,94,.15); color: var(--success); }
    .ready-badge.no { background: rgba(239,68,68,.15); color: var(--error); }
    /* Session & device controls */
    .form-row { display: flex; gap: 8px; align-items: flex-end; margin-bottom: 12px; }
    .form-group { display: flex; flex-direction: column; gap: 3px; }
    .form-group label { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: .3px; }
    .form-group input, .form-group select { background: var(--card2); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; font-size: 12px; color: #fff; outline: none; }
    .form-group input:focus, .form-group select:focus { border-color: var(--accent); }
    .btn-primary { background: var(--accent); color: #fff; border: none; padding: 6px 14px; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer; transition: all .12s; white-space: nowrap; }
    .btn-primary:hover { filter: brightness(1.15); }
    .btn-primary:disabled { opacity: .5; cursor: not-allowed; }
    .btn-danger { background: rgba(239,68,68,.15); color: var(--error); border: none; padding: 4px 10px; border-radius: 4px; font-size: 10px; font-weight: 500; cursor: pointer; }
    .btn-danger:hover { background: rgba(239,68,68,.3); }
    .btn-success { background: rgba(34,197,94,.15); color: var(--success); border: none; padding: 4px 10px; border-radius: 4px; font-size: 10px; font-weight: 500; cursor: pointer; }
    .btn-success:hover { background: rgba(34,197,94,.3); }
    .session-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(500px, 1fr)); gap: 10px; }
    .session-card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 0; overflow: hidden; }
    .session-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--border); }
    .session-body { display: flex; gap: 0; }
    .session-screen { flex: 1; background: #000; min-height: 200px; display: flex; align-items: center; justify-content: center; position: relative; cursor: crosshair; }
    .session-screen img { width: 100%; height: auto; display: block; }
    .session-screen .placeholder { color: var(--muted); font-size: 11px; }
    .session-controls { width: 180px; padding: 8px; border-left: 1px solid var(--border); display: flex; flex-direction: column; gap: 6px; }
    .ctrl-section label { font-size: 9px; color: var(--muted); text-transform: uppercase; margin-bottom: 2px; display: block; }
    .ctrl-btn { width: 100%; padding: 4px 6px; border-radius: 4px; font-size: 10px; font-weight: 500; cursor: pointer; border: 1px solid var(--border); background: var(--card2); color: var(--text); transition: all .12s; text-align: center; }
    .ctrl-btn:hover { border-color: var(--accent); color: #fff; }
    .ctrl-input { width: 100%; background: var(--card2); border: 1px solid var(--border); border-radius: 4px; padding: 3px 6px; font-size: 10px; color: #fff; outline: none; }
    .ctrl-input:focus { border-color: var(--accent); }
    .rec-indicator { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; font-weight: 700; color: var(--error); animation: pulse-dot 1s ease-in-out infinite; }
    .ctrl-row { display: flex; gap: 4px; }
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
  </style>
</head>
<body>
<div class="layout">
  <div class="sidebar">
    <div class="sidebar-header">
      <h1>Katab Runner</h1>
      <div class="sub" id="tenant-name">-</div>
      <div class="status off" id="conn-status"><span class="dot off" id="conn-dot"></span><span id="conn-text">Connecting</span></div>
    </div>
    <div class="nav">
      <button class="nav-item active" onclick="showPage('overview')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
        Overview
      </button>
      <button class="nav-item" onclick="showPage('platforms')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
        Platforms
      </button>
      <button class="nav-item" onclick="showPage('runners')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        Runners
      </button>
      <button class="nav-item" onclick="showPage('runs')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        Runs
      </button>
      <button class="nav-item" onclick="showPage('queue')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
        Queue
      </button>
      <button class="nav-item" onclick="showPage('devices')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
        Devices
      </button>
      <button class="nav-item" onclick="showPage('logs')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        Logs
      </button>
    </div>
    <div class="sidebar-footer">Auto-refresh 5s</div>
  </div>

  <div class="main">
    <!-- OVERVIEW -->
    <div class="page active" id="page-overview">
      <div class="page-title">Overview</div>
      <div class="stats-row" id="overview-stats"></div>
      <div class="card"><h3>Runner Info</h3><div class="info-grid" id="runner-info"></div></div>
      <div class="card"><h3>System Resources</h3><div id="resources"></div></div>
      <div class="card"><h3>Platform Status (Quick View)</h3><div id="overview-platforms"></div></div>
    </div>

    <!-- PLATFORMS (per-platform process view) -->
    <div class="page" id="page-platforms">
      <div class="page-title">Platform Processes</div>
      <p style="font-size:11px;color:var(--muted);margin-bottom:14px">Each platform requires specific sub-processes. All must be <span class="badge badge-running">running</span> for the platform to accept jobs.</p>
      <div id="platforms-detail"></div>
    </div>

    <!-- RUNNERS -->
    <div class="page" id="page-runners">
      <div class="page-title">Registered Runners</div>
      <div id="runners-list"></div>
    </div>

    <!-- RUNS -->
    <div class="page" id="page-runs">
      <div class="page-title">Recent Runs</div>
      <div id="runs-list"></div>
    </div>

    <!-- QUEUE -->
    <div class="page" id="page-queue">
      <div class="page-title">Queue Management</div>
      <div class="queue-tabs" id="q-platform-tabs"></div>
      <div id="q-stats-area"></div>
      <div class="job-status-tabs" id="q-status-tabs"></div>
      <div id="q-jobs-list"></div>
    </div>

    <!-- DEVICES -->
    <div class="page" id="page-devices">
      <div class="page-title">Devices & Sessions</div>

      <!-- New Web Session Form -->
      <div class="card" style="margin-bottom:14px">
        <h3>New Web Session</h3>
        <div class="form-row">
          <div class="form-group" style="flex:1"><label>URL</label><input id="web-url" type="url" value="https://example.com" placeholder="https://..."></div>
          <div class="form-group" style="width:60px"><label>FPS</label>
            <select id="web-fps"><option value="1">1</option><option value="2" selected>2</option><option value="3">3</option><option value="5">5</option></select>
          </div>
          <button class="btn-primary" id="btn-create-web" onclick="createWebSession()">Start Web Session</button>
        </div>
      </div>

      <!-- Active Sessions (live preview) -->
      <div style="margin-bottom:14px">
        <div class="page-title" style="font-size:14px">Active Sessions</div>
        <div id="sessions-live"></div>
      </div>

      <!-- Detected Devices -->
      <div>
        <div class="page-title" style="font-size:14px">Detected Devices</div>
        <p style="font-size:10px;color:var(--muted);margin:-8px 0 10px 0">Click <b>Connect</b> to register a device for Cloud Dashboard access. Connected devices are reported via heartbeat.</p>
        <div id="devices-list"></div>
      </div>
    </div>

    <!-- LOGS -->
    <div class="page" id="page-logs">
      <div class="page-title">Activity Logs</div>
      <div class="log-box" id="full-log-box" style="max-height:calc(100vh - 120px)"></div>
    </div>
  </div>
</div>

<script>
const RUNNER_TOKEN = '__RUNNER_TOKEN__';
const AUTH_HEADERS = RUNNER_TOKEN ? { 'Authorization': 'Bearer ' + RUNNER_TOKEN } : {};

let currentPage = 'overview';
let qPlatform = '', qStatus = 'waiting';
let platforms = [];

const PAGES = ['overview','platforms','runners','runs','queue','devices','logs'];

function showPage(id) {
  currentPage = id;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  document.querySelectorAll('.nav-item').forEach((n, i) => {
    n.classList.toggle('active', PAGES[i] === id);
  });
  refreshPage();
}

function fmt(iso) { return iso ? new Date(iso).toLocaleString('ko-KR') : '-'; }
function fmtShort(iso) { return iso ? new Date(iso).toLocaleTimeString('ko-KR') : '-'; }
function fmtUptime(s) { const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.floor(s%60); return (h>0?h+'h ':'') + m+'m ' + sec+'s'; }
function badge(status) { return '<span class="badge badge-'+(status||'offline')+'">'+(status||'-')+'</span>'; }
function platformIcon(p) {
  const icons = { web: '🌐', ios: '🍎', android: '🤖' };
  return '<span class="platform-icon '+p+'">'+(icons[p]||'?')+'</span>';
}

async function api(path) {
  const r = await fetch(path, {headers: AUTH_HEADERS});
  if (!r.ok) throw new Error(r.statusText);
  return r.json();
}
async function apiPost(path) { return (await fetch(path, {method:'POST', headers: AUTH_HEADERS})).json(); }
async function apiPostJson(path, body) { return (await fetch(path, {method:'POST',headers:{...AUTH_HEADERS,'Content-Type':'application/json'},body:JSON.stringify(body)})).json(); }
async function apiDel(path) { return (await fetch(path, {method:'DELETE', headers: AUTH_HEADERS})).json(); }

// ========== OVERVIEW ==========
async function refreshOverview() {
  try {
    const [status, cloud, res, plats] = await Promise.all([
      api('/status'),
      api('/cloud/info').catch(()=>null),
      api('/resources'),
      api('/platforms'),
    ]);
    // Connection
    document.getElementById('conn-status').className = 'status on';
    document.getElementById('conn-dot').className = 'dot on';
    document.getElementById('conn-text').textContent = 'Connected';
    if (cloud) document.getElementById('tenant-name').textContent = cloud.tenantName || '-';

    // Stats
    const workers = status.workers || {};
    let totalActive=0, totalDone=0, totalFailed=0;
    Object.values(workers).forEach(w => { totalActive += w.active||0; totalDone += w.completed||0; totalFailed += w.failed||0; });
    platforms = status.runner?.platforms || [];
    if (!qPlatform && platforms.length > 0) qPlatform = platforms[0];

    const readyCount = (plats||[]).filter(p => p.ready).length;
    document.getElementById('overview-stats').innerHTML = [
      {n: platforms.length, l: 'Platforms', c: 'var(--accent)'},
      {n: readyCount + '/' + platforms.length, l: 'Ready', c: readyCount === platforms.length ? 'var(--success)' : 'var(--warn)'},
      {n: totalActive, l: 'Active Jobs', c: 'var(--warn)'},
      {n: totalDone, l: 'Completed', c: 'var(--success)'},
    ].map(s => '<div class="stat-card"><div class="num" style="color:'+s.c+'">'+s.n+'</div><div class="lbl">'+s.l+'</div></div>').join('');

    // Runner info
    document.getElementById('runner-info').innerHTML = [
      ['Runner ID', status.runner?.id || '-'],
      ['Tenant', cloud?.tenantName || status.runner?.tenantId || '-'],
      ['Platforms', (status.runner?.platforms||[]).join(', ')],
      ['Uptime', fmtUptime(status.uptime||0)],
      ['Cloud API', status.runner?.cloudApiUrl || '-'],
      ['Runner Name', cloud?.runnerName || '-'],
    ].map(([l,v]) => '<div class="info-item"><span class="label">'+l+'</span><br><span class="value">'+v+'</span></div>').join('');

    // Resources
    const rsrc = res || {};
    const cpuPct = Math.round((rsrc.cpuUsage||0)*100);
    const memPct = Math.round(((rsrc.memUsed||0)/(rsrc.memTotal||1))*100);
    document.getElementById('resources').innerHTML =
      '<div class="info-grid">' +
        '<div class="info-item"><span class="label">CPU Usage</span><br><span class="value">' + cpuPct + '%</span>' +
          '<div class="resource-bar"><div class="resource-bar-fill" style="width:'+cpuPct+'%;background:'+(cpuPct>80?'var(--error)':cpuPct>50?'var(--warn)':'var(--success)')+'"></div></div></div>' +
        '<div class="info-item"><span class="label">Memory</span><br><span class="value">' + Math.round((rsrc.memUsed||0)/1024/1024) + ' / ' + Math.round((rsrc.memTotal||0)/1024/1024) + ' MB</span>' +
          '<div class="resource-bar"><div class="resource-bar-fill" style="width:'+memPct+'%;background:'+(memPct>80?'var(--error)':memPct>50?'var(--warn)':'var(--success)')+'"></div></div></div>' +
        '<div class="info-item"><span class="label">Node.js</span><br><span class="value">' + (rsrc.nodeVersion||'-') + '</span></div>' +
        '<div class="info-item"><span class="label">Platform</span><br><span class="value">' + (rsrc.osPlatform||'-') + ' ' + (rsrc.osArch||'') + '</span></div>' +
      '</div>';

    // Quick platform view
    renderPlatformQuick(plats || []);
  } catch(e) {
    document.getElementById('conn-status').className = 'status off';
    document.getElementById('conn-dot').className = 'dot off';
    document.getElementById('conn-text').textContent = 'Offline';
  }
}

function renderPlatformQuick(plats) {
  if (!plats.length) {
    document.getElementById('overview-platforms').innerHTML = '<div class="empty">No platforms configured</div>';
    return;
  }
  document.getElementById('overview-platforms').innerHTML = plats.map(p => {
    const allRunning = p.processes.every(pr => pr.status === 'running' || pr.status === 'not_required');
    return '<div class="process-row" style="margin-bottom:6px;cursor:pointer" onclick="showPage(\\'platforms\\')">' +
      '<div class="process-info">' +
        platformIcon(p.platform) +
        '<div>' +
          '<span class="process-name" style="text-transform:uppercase">' + p.platform + '</span>' +
          '<div class="process-meta">' + p.processes.length + ' processes</div>' +
        '</div>' +
      '</div>' +
      '<span class="ready-badge '+(allRunning?'yes':'no')+'">'+(allRunning?'Ready':'Not Ready')+'</span>' +
    '</div>';
  }).join('');
}

// ========== PLATFORMS ==========
async function refreshPlatforms() {
  try {
    const plats = await api('/platforms');
    if (!plats.length) {
      document.getElementById('platforms-detail').innerHTML = '<div class="empty">No platforms configured</div>';
      return;
    }
    document.getElementById('platforms-detail').innerHTML = plats.map(p => {
      const allRunning = p.processes.every(pr => pr.status === 'running' || pr.status === 'not_required');
      let html = '<div class="platform-section">';
      html += '<div class="platform-header">';
      html += '<div style="display:flex;align-items:center;gap:8px">' + platformIcon(p.platform) + '<h4>' + p.platform + '</h4></div>';
      html += '<span class="ready-badge '+(allRunning?'yes':'no')+'">'+(allRunning?'All Running':'Not Ready')+'</span>';
      html += '</div>';

      // Process rows
      p.processes.forEach(proc => {
        html += '<div class="process-row">';
        html += '<div class="process-info">';
        html += '<span class="process-dot ' + proc.status + '"></span>';
        html += '<div>';
        html += '<span class="process-name">' + proc.name + '</span>';
        const meta = [];
        if (proc.pid) meta.push('PID ' + proc.pid);
        if (proc.startedAt) meta.push('Started ' + fmtShort(proc.startedAt));
        if (proc.healthUrl) meta.push(proc.healthUrl);
        if (meta.length) html += '<div class="process-meta">' + meta.join(' &middot; ') + '</div>';
        if (proc.error) html += '<div class="process-error">' + proc.error + '</div>';
        html += '</div>';
        html += '</div>';
        html += badge(proc.status);
        html += '</div>';
      });

      // Requirements hint
      if (p.platform === 'ios') {
        html += '<div style="font-size:10px;color:var(--muted);margin-top:6px;padding-left:4px">Requires: CoreDevice Tunnel (iOS 17+) + Appium Server + XCUITest driver</div>';
      } else if (p.platform === 'android') {
        html += '<div style="font-size:10px;color:var(--muted);margin-top:6px;padding-left:4px">Requires: Appium Server + UiAutomator2 driver</div>';
      } else {
        html += '<div style="font-size:10px;color:var(--muted);margin-top:6px;padding-left:4px">Uses Playwright (Chromium). No external dependencies.</div>';
      }

      html += '</div>';
      return html;
    }).join('');
  } catch(e) {
    document.getElementById('platforms-detail').innerHTML = '<div class="empty">Failed to load: '+e.message+'</div>';
  }
}

// ========== RUNNERS ==========
async function refreshRunners() {
  try {
    const runners = await api('/cloud/runners');
    if (!runners || runners.length === 0) {
      document.getElementById('runners-list').innerHTML = '<div class="empty">No runners in this tenant</div>';
      return;
    }
    let html = '<table><thead><tr><th>Name</th><th>Status</th><th>Last Heartbeat</th><th>Created</th></tr></thead><tbody>';
    runners.forEach(r => {
      html += '<tr><td style="color:#fff;font-weight:500">'+r.name+'</td><td>'+badge(r.status)+'</td><td>'+fmt(r.lastHeartbeatAt)+'</td><td>'+fmt(r.createdAt)+'</td></tr>';
    });
    html += '</tbody></table>';
    document.getElementById('runners-list').innerHTML = '<div class="card">'+html+'</div>';
  } catch(e) {
    document.getElementById('runners-list').innerHTML = '<div class="empty">Failed to load: '+e.message+'</div>';
  }
}

// ========== RUNS ==========
async function refreshRuns() {
  try {
    const data = await api('/cloud/runs');
    const runs = data.runs || data || [];
    if (!runs.length) {
      document.getElementById('runs-list').innerHTML = '<div class="empty">No runs yet</div>';
      return;
    }
    let html = '<table><thead><tr><th>ID</th><th>Mode</th><th>Platform</th><th>Status</th><th>Progress</th><th>Created</th></tr></thead><tbody>';
    runs.forEach(r => {
      html += '<tr>' +
        '<td class="mono" style="color:var(--muted)">'+(r.id||'').slice(0,8)+'</td>' +
        '<td style="text-transform:capitalize">'+(r.mode||'-')+'</td>' +
        '<td style="text-transform:capitalize">'+(r.targetPlatform||r.target_platform||'-')+'</td>' +
        '<td>'+badge(r.status)+'</td>' +
        '<td>'+(r.passedCount||0)+'/'+(r.totalScenarios||r.total_scenarios||0)+'</td>' +
        '<td style="color:var(--muted)">'+fmt(r.createdAt||r.created_at)+'</td></tr>';
    });
    html += '</tbody></table>';
    document.getElementById('runs-list').innerHTML = '<div class="card"><h3>Total: '+(data.total||runs.length)+' runs</h3>'+html+'</div>';
  } catch(e) {
    document.getElementById('runs-list').innerHTML = '<div class="empty">Failed to load: '+e.message+'</div>';
  }
}

// ========== QUEUE ==========
function renderQPlatformTabs() {
  document.getElementById('q-platform-tabs').innerHTML = platforms.map(p =>
    '<button class="q-tab'+(p===qPlatform?' active':'')+'" onclick="setQPlatform(\\''+p+'\\')">'+p+'</button>'
  ).join('');
}
function setQPlatform(p) { qPlatform = p; qStatus = 'waiting'; renderQPlatformTabs(); refreshQueue(); }
function setQStatus(s) { qStatus = s; refreshQueue(); }

async function refreshQueue() {
  if (!qPlatform) { document.getElementById('q-stats-area').innerHTML = '<div class="empty">No platforms</div>'; return; }
  renderQPlatformTabs();
  try {
    const [stats, jobs] = await Promise.all([
      api('/queue/'+qPlatform+'/stats'),
      api('/queue/'+qPlatform+'/jobs?status='+qStatus),
    ]);
    const statNames = ['waiting','active','completed','failed','delayed'];
    document.getElementById('q-stats-area').innerHTML = '<div class="q-stat-row">' +
      statNames.map(s => '<div class="q-stat '+s+'"><div class="n">'+(stats[s]||0)+'</div><div class="l">'+s+'</div></div>').join('') +
    '</div>';
    document.getElementById('q-status-tabs').innerHTML = statNames.map(s =>
      '<button class="js-tab'+(s===qStatus?' active':'')+'" onclick="setQStatus(\\''+s+'\\')">'+s+' ('+(stats[s]||0)+')</button>'
    ).join('');
    if (!jobs || jobs.length === 0) {
      document.getElementById('q-jobs-list').innerHTML = '<div class="empty">No '+qStatus+' jobs</div>';
    } else {
      let html = '<table><thead><tr><th>Job ID</th><th>Scenario</th><th>Attempts</th><th>Time</th><th></th></tr></thead><tbody>';
      jobs.forEach(j => {
        const sid = (j.data?.scenarioId||'').slice(0,8);
        html += '<tr><td class="mono" style="color:var(--muted)">'+(j.id||'').slice(0,12)+'</td><td>'+sid+'</td><td>'+(j.attemptsMade||0)+'</td><td style="color:var(--muted)">'+fmtShort(j.timestamp)+'</td><td>';
        if (qStatus==='failed') html += '<button class="btn btn-retry" onclick="retryJob(\\''+j.id+'\\')">Retry</button> ';
        if (['waiting','failed','delayed'].includes(qStatus)) html += '<button class="btn btn-remove" onclick="removeJob(\\''+j.id+'\\')">Remove</button>';
        html += '</td></tr>';
      });
      html += '</tbody></table>';
      document.getElementById('q-jobs-list').innerHTML = '<div class="card">'+html+'</div>';
    }
  } catch(e) {
    document.getElementById('q-stats-area').innerHTML = '<div class="empty">'+e.message+'</div>';
  }
}
async function retryJob(id) { await apiPost('/queue/'+qPlatform+'/jobs/'+id+'/retry'); refreshQueue(); }
async function removeJob(id) { if (!confirm('Remove?')) return; await apiDel('/queue/'+qPlatform+'/jobs/'+id); refreshQueue(); }

// ========== LOGS ==========
async function refreshLogs() {
  try {
    const logs = await api('/logs');
    const el = document.getElementById('full-log-box');
    el.innerHTML = (logs||[]).map(l => {
      const cls = l.event==='failed'?'color:var(--error)':l.event==='completed'?'color:var(--success)':l.event==='retried'?'color:var(--warn)':l.event==='worker_ready'?'color:var(--success)':'color:var(--accent)';
      return '<div><span class="log-t">'+fmtShort(l.time)+'</span><span style="'+cls+'">['+l.platform+'] '+l.event+' '+(l.jobId||'').slice(0,8)+(l.detail?' - '+l.detail:'')+'</span></div>';
    }).join('') || '<div style="color:var(--muted)">No activity yet</div>';
  } catch(e) {}
}

// ========== DEVICES ==========
let sessionWSMap = {};

async function createWebSession() {
  const url = document.getElementById('web-url').value;
  const fps = parseInt(document.getElementById('web-fps').value) || 2;
  if (!url || url === 'https://') { alert('Enter a URL'); return; }
  document.getElementById('btn-create-web').disabled = true;
  document.getElementById('btn-create-web').textContent = 'Starting...';
  try {
    await apiPostJson('/sessions', { platform: 'web', url, fps });
    refreshDevices();
  } catch(e) { alert('Failed: ' + e.message); }
  document.getElementById('btn-create-web').disabled = false;
  document.getElementById('btn-create-web').textContent = 'Start Web Session';
}

async function connectDevice(deviceId) {
  try {
    await apiPost('/devices/' + deviceId + '/connect');
    refreshDevices();
  } catch(e) { alert('Failed: ' + e.message); }
}

async function disconnectDevice(deviceId) {
  if (!confirm('Disconnect this device from the pool?')) return;
  try {
    await apiPost('/devices/' + deviceId + '/disconnect');
    refreshDevices();
  } catch(e) { alert('Failed: ' + e.message); }
}

async function closeSession(id) {
  if (!confirm('Close session?')) return;
  const ws = sessionWSMap[id];
  if (ws) { ws.close(); delete sessionWSMap[id]; }
  await apiDel('/sessions/' + id);
  refreshDevices();
}

function startRec(id) {
  const ws = sessionWSMap[id];
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({type:'record_start'}));
}

function stopRec(id) {
  const ws = sessionWSMap[id];
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({type:'record_stop'}));
}

function sendSessionAction(id, action) {
  const ws = sessionWSMap[id];
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({type:'action',data:action}));
}

function onScreenClick(id, e, screenW, screenH) {
  const rect = e.target.getBoundingClientRect();
  const x = Math.round((e.clientX - rect.left) / rect.width * screenW);
  const y = Math.round((e.clientY - rect.top) / rect.height * screenH);
  sendSessionAction(id, { type: 'click', x, y });
}

function connectSessionWS(id) {
  if (sessionWSMap[id]) return;
  const ws = new WebSocket('ws://' + location.host + '/sessions/' + id + '/stream');
  sessionWSMap[id] = ws;
  ws.onmessage = function(evt) {
    try {
      const msg = JSON.parse(evt.data);
      if (msg.type === 'frame') {
        const img = document.getElementById('screen-' + id);
        if (img) img.src = 'data:image/jpeg;base64,' + msg.data;
        const ph = document.getElementById('ph-' + id);
        if (ph) ph.style.display = 'none';
      } else if (msg.type === 'status') {
        const el = document.getElementById('status-' + id);
        if (el) el.innerHTML = badge(msg.data);
      } else if (msg.type === 'recorded_events') {
        const el = document.getElementById('events-' + id);
        if (el) {
          el.style.display = 'block';
          el.textContent = JSON.stringify(msg.data, null, 2);
        }
        const recEl = document.getElementById('rec-' + id);
        if (recEl) recEl.style.display = 'none';
      }
    } catch(err) {}
  };
  ws.onclose = function() { delete sessionWSMap[id]; };
}

// Track which sessions are already rendered to avoid DOM rebuilds that cause flickering
let renderedSessionIds = new Set();

async function refreshDevices() {
  try {
    const [devs, sess] = await Promise.all([api('/devices'), api('/sessions')]);

    // Active Sessions with live preview
    const activeSess = (sess||[]).filter(s => s.status !== 'closed' && s.status !== 'error');
    const activeIds = new Set(activeSess.map(s => s.id));

    // Remove sessions that are no longer active
    renderedSessionIds.forEach(id => {
      if (!activeIds.has(id)) {
        const el = document.getElementById('session-card-' + id);
        if (el) el.remove();
        const ws = sessionWSMap[id];
        if (ws) { ws.close(); delete sessionWSMap[id]; }
        renderedSessionIds.delete(id);
      }
    });

    if (activeSess.length === 0) {
      document.getElementById('sessions-live').innerHTML = '<div class="empty">No active sessions. Create one above or connect a device.</div>';
      renderedSessionIds.clear();
    } else {
      // Ensure grid container exists
      let grid = document.getElementById('sessions-grid');
      if (!grid) {
        document.getElementById('sessions-live').innerHTML = '<div class="session-grid" id="sessions-grid"></div>';
        grid = document.getElementById('sessions-grid');
      }

      activeSess.forEach(s => {
        if (renderedSessionIds.has(s.id)) {
          // Session already rendered — just update status badge (no DOM rebuild)
          const statusEl = document.getElementById('status-' + s.id);
          if (statusEl) statusEl.innerHTML = badge(s.status);
          return;
        }

        // New session — render card
        renderedSessionIds.add(s.id);
        const isWeb = s.platform === 'web';
        const sw = isWeb ? (s.screenSize?.width || 1280) : (s.screenSize?.width || 375);
        const sh = isWeb ? (s.screenSize?.height || 720) : (s.screenSize?.height || 812);
        let html = '<div class="session-card" id="session-card-'+s.id+'">';
        // Header
        html += '<div class="session-header">';
        html += '<div style="display:flex;align-items:center;gap:6px">';
        html += '<span style="font-size:14px">'+(isWeb?'🌐':s.platform==='ios'?'🍎':'🤖')+'</span>';
        html += '<span style="color:#fff;font-weight:600;font-size:12px;text-transform:uppercase">'+s.platform+'</span>';
        html += '<span class="mono" style="color:var(--muted);font-size:10px">'+(s.id||'').slice(0,8)+'</span>';
        html += '<span id="status-'+s.id+'">'+badge(s.status)+'</span>';
        html += '<span id="rec-'+s.id+'" class="rec-indicator" style="display:'+(s.recording?'inline-flex':'none')+'">● REC</span>';
        html += '</div>';
        html += '<div style="display:flex;gap:4px">';
        html += '<button class="btn-danger" onclick="closeSession(\\'' + s.id + '\\')">Close</button>';
        html += '</div></div>';
        // Body
        html += '<div class="session-body">';
        // Screen
        html += '<div class="session-screen" onclick="onScreenClick(\\'' + s.id + '\\',event,'+sw+','+sh+')">';
        html += '<span class="placeholder" id="ph-'+s.id+'">Connecting...</span>';
        html += '<img id="screen-'+s.id+'" style="display:block;width:100%;height:auto" alt="">';
        html += '</div>';
        // Controls
        html += '<div class="session-controls">';
        if (isWeb) {
          html += '<div class="ctrl-section"><label>Navigate</label><input class="ctrl-input" id="nav-'+s.id+'" placeholder="URL" onkeydown="if(event.key===\\'Enter\\')sendSessionAction(\\'' + s.id + '\\',{type:\\'navigate\\',url:this.value})"><button class="ctrl-btn" style="margin-top:3px" onclick="sendSessionAction(\\'' + s.id + '\\',{type:\\'navigate\\',url:document.getElementById(\\'nav-'+s.id+'\\').value})">Go</button></div>';
        }
        html += '<div class="ctrl-section"><label>Type Text</label><div class="ctrl-row"><input class="ctrl-input" id="type-'+s.id+'" placeholder="text..." style="flex:1"><button class="ctrl-btn" style="width:30px" onclick="sendSessionAction(\\'' + s.id + '\\',{type:\\'fill\\',value:document.getElementById(\\'type-'+s.id+'\\').value,selector:\\'input:focus,textarea:focus\\'})">⏎</button></div></div>';
        html += '<div class="ctrl-section"><label>Actions</label>';
        html += '<div class="ctrl-row"><button class="ctrl-btn" onclick="sendSessionAction(\\'' + s.id + '\\',{type:\\'back\\'})">← Back</button>';
        if (isWeb) {
          html += '<button class="ctrl-btn" onclick="sendSessionAction(\\'' + s.id + '\\',{type:\\'forward\\'})">Fwd →</button></div>';
          html += '<div class="ctrl-row" style="margin-top:3px"><button class="ctrl-btn" onclick="sendSessionAction(\\'' + s.id + '\\',{type:\\'scroll\\',deltaY:-300})">↑ Scroll</button>';
          html += '<button class="ctrl-btn" onclick="sendSessionAction(\\'' + s.id + '\\',{type:\\'scroll\\',deltaY:300})">Scroll ↓</button></div>';
        } else {
          html += '<button class="ctrl-btn" onclick="sendSessionAction(\\'' + s.id + '\\',{type:\\'home\\'})">Home</button></div>';
        }
        html += '</div>';
        // Recording
        html += '<div class="ctrl-section" style="margin-top:auto;border-top:1px solid var(--border);padding-top:6px"><label>Recording</label>';
        html += '<button class="ctrl-btn" style="background:rgba(239,68,68,.15);color:var(--error)" onclick="startRec(\\'' + s.id + '\\')">● Start Rec</button>';
        html += '<button class="ctrl-btn" style="margin-top:3px" onclick="stopRec(\\'' + s.id + '\\')">■ Stop Rec</button>';
        html += '</div>';
        html += '</div>'; // session-controls
        html += '</div>'; // session-body
        // Events output
        html += '<pre id="events-'+s.id+'" class="log-box" style="display:none;margin:8px;max-height:120px;font-size:9px"></pre>';
        html += '</div>'; // session-card

        grid.insertAdjacentHTML('beforeend', html);
        setTimeout(function() { connectSessionWS(s.id); }, 100);
      });
    }

    // Connected Devices
    if (!devs || devs.length === 0) {
      document.getElementById('devices-list').innerHTML = '<div class="empty">No physical devices connected. Attach iOS/Android via USB.</div>';
    } else {
      let html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px">';
      devs.forEach(d => {
        const icon = d.platform === 'ios' ? '🍎' : d.platform === 'android' ? '🤖' : '🌐';
        const borrowed = d.borrowed;
        const registered = d.registered;
        let actionBtn = '';
        if (borrowed) {
          actionBtn = '<span class="badge badge-busy">Borrowed</span>';
        } else if (registered) {
          actionBtn = '<span class="badge badge-online" style="margin-right:4px">Ready</span>' +
            '<button class="btn-danger" style="font-size:10px;padding:3px 8px" onclick="disconnectDevice(\\'' + d.id + '\\')">Disconnect</button>';
        } else {
          actionBtn = '<button class="btn-primary" style="font-size:10px;padding:3px 10px" onclick="connectDevice(\\'' + d.id + '\\')">Connect</button>';
        }
        html += '<div class="card" style="padding:10px">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">' +
            '<span style="font-size:18px">'+icon+'</span>' +
            '<div style="flex:1"><div style="color:#fff;font-weight:500;font-size:12px">'+(d.name||d.model)+'</div>' +
            '<div style="font-size:10px;color:var(--muted)">'+d.platform.toUpperCase()+' '+(d.version||'')+'</div></div>' +
            actionBtn +
          '</div>' +
          '<div style="font-size:10px;color:var(--muted);font-family:monospace">'+(d.id||'').slice(0,20)+'...</div>' +
          (d.activeSession ? '<div style="font-size:10px;color:var(--warn);margin-top:4px">Session: '+(d.activeSession.id||'').slice(0,8)+' ('+d.activeSession.status+')</div>' : '') +
        '</div>';
      });
      html += '</div>';
      document.getElementById('devices-list').innerHTML = html;
    }
  } catch(e) {
    document.getElementById('devices-list').innerHTML = '<div class="empty">'+e.message+'</div>';
  }
}

async function refreshPage() {
  if (currentPage === 'overview') await refreshOverview();
  else if (currentPage === 'platforms') await refreshPlatforms();
  else if (currentPage === 'runners') await refreshRunners();
  else if (currentPage === 'runs') await refreshRuns();
  else if (currentPage === 'queue') await refreshQueue();
  else if (currentPage === 'devices') await refreshDevices();
  else if (currentPage === 'logs') await refreshLogs();
}

refreshPage();
setInterval(refreshPage, 5000);
</script>
</body>
</html>`;
