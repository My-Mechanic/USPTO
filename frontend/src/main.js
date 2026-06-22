import { fetchPatent, searchApplications, buildPatentQuery, patentSnapshot } from './api.js';
import { saveRecords, getRecords, deleteRecord, clearAll, settings } from './db.js';
import { syncPrivate, bridgeAvailableHere } from './sync.js';
import { loadTrademarkStatus, tmWatch } from './trademarks.js';
import { renderWatchlist, renderResults, renderTrademarks, setStatus, patentsToCSV, trademarksToCSV, openModal, renderPatentDetail, renderTrademarkDetail } from './ui.js';
import { renderDashboard } from './dashboard.js';
import { allDeadlines } from './deadlines.js';
import { downloadICS } from './ics.js';
import {
  notifyPrefs, notificationsSupported, permissionState, requestPermission,
  fire, getActivity, clearActivity,
} from './notify.js';

const state = {
  patents: [],
  marks: [],
  tmGeneratedAt: '',
  pFilter: { text: '', state: '', country: '', sort: 'filingDate-desc' },
  autoTimer: null,
  lastAutoRefresh: 0,
};
const $ = (id) => document.getElementById(id);

async function init() {
  const presetKey = settings.getApiKey() || import.meta.env.VITE_ODP_API_KEY || '';
  if (presetKey && presetKey !== settings.getApiKey()) settings.setApiKey(presetKey);
  $('apiKey').value = presetKey;

  state.patents = await getRecords();
  wireTabs();
  wirePatents();
  wireTrademarks();
  wireDashboard();
  registerServiceWorker();
  if (!bridgeAvailableHere()) $('syncBtn').title = 'Live private sync works only when running locally.';

  refreshPatents();
  await refreshTrademarks();
  refreshDashboard();
  scheduleAutoCheck();
  wireAutoRefreshTriggers();
  setStatus('Add your patents and trademarks to start monitoring them.');

  // Auto-refresh on load (lets the UI paint first), then keep current.
  setTimeout(() => maybeAutoRefresh('load', { force: true }), 1200);
  notifyDueDeadlines();
}

/* ---------------- tabs + key ---------------- */
function wireTabs() {
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
      $('tab-dashboard').hidden = btn.dataset.tab !== 'dashboard';
      $('tab-patents').hidden = btn.dataset.tab !== 'patents';
      $('tab-trademarks').hidden = btn.dataset.tab !== 'trademarks';
      if (btn.dataset.tab === 'dashboard') refreshDashboard();
    };
  });
  $('saveKey').onclick = () => {
    settings.setApiKey($('apiKey').value.trim());
    setStatus('API key saved to this browser.', 'ok');
  };
}

/* ---------------- patents ---------------- */
function wirePatents() {
  $('addBtn').onclick = onAddByNumber;
  $('addNum').addEventListener('keydown', (e) => { if (e.key === 'Enter') onAddByNumber(); });
  $('checkAll').onclick = () => onCheckAll();
  $('syncBtn').onclick = onSyncPrivate;
  $('pImport').onchange = onImport;
  $('pExport').onclick = onExport;
  $('pClear').onclick = onClearAll;
  $('findBtn').onclick = onFind;
  $('fText').oninput = (e) => { state.pFilter.text = e.target.value.toLowerCase(); refreshPatents(); };
  $('fState').onchange = (e) => { state.pFilter.state = e.target.value; refreshPatents(); };
  $('fCountry').onchange = (e) => { state.pFilter.country = e.target.value; refreshPatents(); };
  $('fSort').onchange = (e) => { state.pFilter.sort = e.target.value; refreshPatents(); };
}

function apiKeyOrWarn() {
  const k = settings.getApiKey() || $('apiKey').value.trim();
  if (k && k !== settings.getApiKey()) settings.setApiKey(k);
  if (!k) { setStatus('Enter your USPTO ODP API key first.', 'error'); return null; }
  return k;
}

async function onAddByNumber() {
  const apiKey = apiKeyOrWarn();
  if (!apiKey) return;
  const number = $('addNum').value.trim();
  const type = $('addType').value;
  if (!number) return setStatus('Enter an application or patent number.', 'error');
  setStatus(`Fetching ${type} ${number}…`);
  try {
    const p = await fetchPatent({ apiKey, number, type });
    await addPatent(p);
    $('addNum').value = '';
    setStatus(`Added “${p.inventionTitle || p.applicationNumberText}” to My Patents.`, 'ok');
  } catch (e) {
    setStatus(e.message, 'error');
  }
}

// Preserve user-owned fields (notes/tags/addedAt) across re-fetches.
function carryUserFields(fresh, old) {
  return {
    ...fresh,
    addedAt: old ? old.addedAt : new Date().toISOString(),
    note: old ? old.note || '' : '',
    tags: old ? old.tags || [] : [],
  };
}

async function addPatent(p) {
  const existing = state.patents.find((x) => x.applicationNumberText === p.applicationNumberText);
  const rec = {
    ...carryUserFields(p, existing),
    lastChecked: new Date().toISOString(),
    snapshot: patentSnapshot(p),
    changed: existing ? existing.changed : false,
    changeNote: existing ? existing.changeNote || '' : '',
  };
  await saveRecords([rec]);
  state.patents = await getRecords();
  refreshPatents();
  refreshDashboard();
}

async function onCheckAll({ silent = false } = {}) {
  const apiKey = apiKeyOrWarn();
  if (!apiKey) return;
  if (!state.patents.length) return silent ? null : setStatus('Nothing to check yet.', 'error');
  if (!silent) setStatus('Checking your patents for updates…');
  let changed = 0;
  for (const old of state.patents) {
    try {
      const fresh = await fetchPatent({ apiKey, number: old.applicationNumberText, type: 'application' });
      const snap = patentSnapshot(fresh);
      const didChange = old.snapshot && snap !== old.snapshot;
      if (didChange) {
        changed++;
        const note = `Status/event changed: ${fresh.status} — ${fresh.latestEvent || ''}`.trim();
        fire({
          title: `Patent update: ${fresh.inventionTitle || fresh.applicationNumberText}`,
          body: note,
          tag: `patent-${fresh.applicationNumberText}`,
          kind: 'change',
          refId: fresh.applicationNumberText,
          url: fresh.link,
        });
      }
      await saveRecords([{
        ...carryUserFields(fresh, old),
        lastChecked: new Date().toISOString(),
        snapshot: snap,
        changed: didChange || old.changed,
        changeNote: didChange ? `Status/event changed: ${fresh.status} — ${fresh.latestEvent || ''}`.trim() : old.changeNote || '',
      }]);
    } catch (e) {
      // keep going; one failure shouldn't stop the batch
    }
  }
  state.patents = await getRecords();
  refreshPatents();
  refreshDashboard();
  const msg = changed ? `${changed} application(s) have updates — highlighted below.` : 'Checked. No changes since last time.';
  if (!silent || changed) setStatus(msg, 'ok');
  notifyDueDeadlines();
}

async function onSyncPrivate() {
  setStatus('Starting private sync — a browser window will open for you to log in…');
  try {
    const patents = await syncPrivate({ onStatus: (m) => setStatus(m) });
    for (const p of patents) await addPatent({ ...p, source: 'private' });
    setStatus(`Synced ${patents.length} private/pending application(s) into My Patents.`, 'ok');
  } catch (e) {
    setStatus(e.message, 'error');
  }
}

async function onFind() {
  const apiKey = apiKeyOrWarn();
  if (!apiKey) return;
  const raw = $('pRaw').value.trim();
  const q = raw || buildPatentQuery({
    firstName: $('pFirst').value.trim(), lastName: $('pLast').value.trim(),
    assignee: $('pAssignee').value.trim(), title: $('pTitle').value.trim(),
    dateFrom: $('pFrom').value, dateTo: $('pTo').value,
  });
  if (!q) return setStatus('Fill at least one field to find your patent.', 'error');
  setStatus('Searching…');
  try {
    const { patents, count } = await searchApplications({ apiKey, q, limit: 50, sort: 'applicationMetaData.filingDate desc' });
    const tracked = new Set(state.patents.map((p) => p.applicationNumberText));
    renderResults($('results'), patents, { onAdd: async (p) => { await addPatent(p); onFind(); }, tracked });
    $('resultsWrap').hidden = false;
    setStatus(`${count ?? patents.length} match(es)${count > patents.length ? ` (showing ${patents.length} — refine to narrow)` : ''}. Click “Add” on yours.`, 'ok');
  } catch (e) {
    setStatus(e.message, 'error');
  }
}

async function onImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const items = (Array.isArray(parsed) ? parsed : parsed.patents || []).filter((p) => p && p.applicationNumberText);
    await saveRecords(items);
    state.patents = await getRecords();
    refreshPatents();
    refreshDashboard();
    setStatus(`Imported ${items.length} patent(s).`, 'ok');
  } catch (err) {
    setStatus('Import failed: ' + err.message, 'error');
  }
  e.target.value = '';
}

function onExport() {
  download('my-patents.json', { patents: state.patents });
}

async function onClearAll() {
  if (!confirm('Remove all tracked patents from this browser?')) return;
  await clearAll();
  state.patents = [];
  refreshPatents();
  refreshDashboard();
  setStatus('My Patents cleared.', 'ok');
}

function patentView() {
  const { text, state: st, country, sort } = state.pFilter;
  const out = state.patents.filter((p) => {
    const hay = `${p.applicationNumberText} ${p.inventionTitle} ${p.status} ${p.assignee} ${p.inventors} ${(p.tags || []).join(' ')} ${p.note || ''}`.toLowerCase();
    return (!text || hay.includes(text)) && (!st || p.inventorState === st) && (!country || p.inventorCountry === country);
  });
  const [key, dir] = sort.split('-');
  out.sort((a, b) => {
    const av = a[key] || '', bv = b[key] || '';
    if (av === bv) return 0;
    return dir === 'desc' ? (av < bv ? 1 : -1) : av > bv ? 1 : -1;
  });
  return out;
}

function refreshPatents() {
  populateFacets();
  const view = patentView();
  renderWatchlist($('watchlist'), view, {
    onRemove: removePatent,
    onCheck: (p) => recheckOne(p),
    onOpen: openPatentDetail,
  });
  $('patCount').textContent = view.length;
}

async function removePatent(p) {
  await deleteRecord(p.applicationNumberText);
  state.patents = await getRecords();
  refreshPatents();
  refreshDashboard();
  setStatus('Removed.', 'ok');
}

// Open the in-app detail page (full info + maintenance-fee deadlines + timeline).
function openPatentDetail(p) {
  const fresh = state.patents.find((x) => x.applicationNumberText === p.applicationNumberText) || p;
  openModal(renderPatentDetail(fresh, {
    onCheck: async (q) => { await recheckOne(q); openPatentDetail(q); },
    onRemove: removePatent,
    onSaveNote: async (q, { note, tags }) => {
      await saveRecords([{ ...q, note, tags }]);
      state.patents = await getRecords();
      refreshPatents();
      setStatus('Note saved.', 'ok');
      openPatentDetail(q); // re-render with saved values
    },
  }));
}

function openTrademarkDetail(t) {
  const fresh = state.marks.find((m) => m.serialNumber === t.serialNumber) || t;
  openModal(renderTrademarkDetail(fresh));
}

async function recheckOne(p) {
  const apiKey = apiKeyOrWarn();
  if (!apiKey) return;
  setStatus(`Re-checking ${p.applicationNumberText}…`);
  try {
    const fresh = await fetchPatent({ apiKey, number: p.applicationNumberText, type: 'application' });
    const snap = patentSnapshot(fresh);
    const didChange = p.snapshot && snap !== p.snapshot;
    if (didChange) {
      fire({
        title: `Patent update: ${fresh.inventionTitle || fresh.applicationNumberText}`,
        body: `Status/event changed: ${fresh.status} — ${fresh.latestEvent || ''}`.trim(),
        tag: `patent-${fresh.applicationNumberText}`, kind: 'change', refId: fresh.applicationNumberText, url: fresh.link,
      });
    }
    await saveRecords([{ ...carryUserFields(fresh, p), lastChecked: new Date().toISOString(), snapshot: snap, changed: didChange || p.changed, changeNote: didChange ? `Status/event changed: ${fresh.status} — ${fresh.latestEvent || ''}`.trim() : p.changeNote || '' }]);
    state.patents = await getRecords();
    refreshPatents();
    refreshDashboard();
    setStatus(didChange ? 'Update found — highlighted.' : 'No change.', 'ok');
  } catch (e) { setStatus(e.message, 'error'); }
}

function populateFacets() {
  fillSelect($('fState'), state.pFilter.state, distinct(state.patents.map((p) => p.inventorState)), 'All states');
  fillSelect($('fCountry'), state.pFilter.country, distinct(state.patents.map((p) => p.inventorCountry)), 'All countries');
}
function distinct(a) { return [...new Set(a.filter(Boolean))].sort(); }
function fillSelect(sel, current, values, allLabel) {
  sel.replaceChildren();
  const o0 = document.createElement('option'); o0.value = ''; o0.textContent = allLabel; sel.appendChild(o0);
  for (const v of values) { const o = document.createElement('option'); o.value = v; o.textContent = v; if (v === current) o.selected = true; sel.appendChild(o); }
}

/* ---------------- trademarks ---------------- */
function wireTrademarks() {
  $('tmAddBtn').onclick = onTmAdd;
  $('tmSerial').addEventListener('keydown', (e) => { if (e.key === 'Enter') onTmAdd(); });
  $('tmDownload').onclick = onTmDownload;
  $('tmRefresh').onclick = refreshTrademarks;
  $('tmFilter').oninput = () => renderTM();
}

async function refreshTrademarks() {
  const prevBySerial = new Map(state.marks.map((m) => [m.serialNumber, m]));
  const { generatedAt, info, marks } = await loadTrademarkStatus();
  // Detect changes vs what we last saw (the published JSON already reflects the
  // server-side monitor; this surfaces a desktop toast on first sight of a change).
  if (state.tmGeneratedAt && generatedAt && generatedAt !== state.tmGeneratedAt) {
    for (const m of marks) {
      const prev = prevBySerial.get(m.serialNumber);
      if (prev && prev.status && m.status && prev.status !== m.status) {
        fire({
          title: `Trademark update: ${m.markText || m.serialNumber}`,
          body: `Status changed to “${m.status}”.`,
          tag: `tm-${m.serialNumber}`, kind: 'change', refId: m.serialNumber, url: m.link,
        });
      }
    }
  }
  state.marks = marks;
  state.tmGeneratedAt = generatedAt;
  const parts = [];
  if (generatedAt) parts.push(`Last checked by the monitor: ${new Date(generatedAt).toLocaleString()}`);
  else parts.push('Not monitored yet — add serials and commit the watchlist.');
  if (info) parts.push(info);
  $('tmGenerated').textContent = parts.join(' · ');
  renderTM();
  refreshDashboard();
}

function onTmAdd() {
  const serial = $('tmSerial').value.replace(/[^0-9]/g, '');
  if (!serial) return setStatus('Enter a trademark serial number (digits).', 'error');
  tmWatch.add(serial);
  $('tmSerial').value = '';
  setStatus(`Added serial ${serial} to your watchlist. Click “Download watchlist.json” and commit it to start monitoring.`, 'ok');
  renderTM();
}

function onTmDownload() {
  download('trademark-watchlist.json', tmWatch.list());
  setStatus('Commit this file to data/trademark-watchlist.json in your repo (or send it to me).', 'ok');
}

function renderTM() {
  const filter = $('tmFilter').value.toLowerCase();
  const bySerial = new Map(state.marks.map((m) => [m.serialNumber, m]));
  const rows = tmWatch.list().map((s) => bySerial.get(s) || { serialNumber: s, markText: '(pending)', pending: true, link: `https://tsdr.uspto.gov/#caseNumber=${s}&caseType=SERIAL_NO&searchType=statusSearch` });
  for (const m of state.marks) if (!tmWatch.list().includes(m.serialNumber)) rows.push(m);
  const view = rows.filter((t) => !filter || `${t.markText} ${t.serialNumber} ${t.status} ${t.owner}`.toLowerCase().includes(filter));
  renderTrademarks($('tmList'), view, {
    onRemove: (t) => { tmWatch.remove(t.serialNumber); renderTM(); setStatus(`Removed ${t.serialNumber} locally. Re-download & commit the watchlist to stop monitoring it.`, 'ok'); },
    onOpen: openTrademarkDetail,
  });
  $('tmCount').textContent = view.length;
}

/* ---------------- dashboard + notifications ---------------- */
function wireDashboard() {
  const prefs = notifyPrefs.get();
  $('notifEnabled').checked = prefs.enabled;
  $('autoCheck').checked = prefs.autoCheck;
  $('intervalHours').value = prefs.intervalHours;
  $('deadlineDays').value = prefs.deadlineDays;
  updatePermLabel();

  $('notifEnabled').onchange = async (e) => {
    if (e.target.checked) {
      const perm = await requestPermission();
      if (perm !== 'granted') {
        e.target.checked = false;
        setStatus(perm === 'unsupported' ? 'This browser does not support notifications.' : 'Notification permission denied — enable it in your browser settings.', 'error');
      } else {
        notifyPrefs.set({ enabled: true });
        fire({ title: 'Notifications on', body: 'You’ll be alerted to status changes and deadlines.', tag: 'test', kind: 'info' });
        setStatus('Desktop notifications enabled.', 'ok');
      }
    } else {
      notifyPrefs.set({ enabled: false });
    }
    updatePermLabel();
  };
  $('autoCheck').onchange = (e) => { notifyPrefs.set({ autoCheck: e.target.checked }); scheduleAutoCheck(); };
  $('intervalHours').onchange = (e) => { notifyPrefs.set({ intervalHours: clampNum(e.target.value, 1, 168, 12) }); scheduleAutoCheck(); };
  $('deadlineDays').onchange = (e) => { notifyPrefs.set({ deadlineDays: clampNum(e.target.value, 7, 365, 120) }); };

  $('exportIcs').onclick = () => {
    const dl = allDeadlines(state.patents, state.marks);
    if (!dl.length) return setStatus('No deadlines to export yet (need granted patents or registered trademarks).', 'error');
    downloadICS(dl);
    setStatus(`Exported ${dl.length} deadline(s) to uspto-deadlines.ics — import it into your calendar.`, 'ok');
  };
  $('exportPatentsCsv').onclick = () => { downloadText('my-patents.csv', patentsToCSV(state.patents), 'text/csv'); setStatus('Patents exported to CSV.', 'ok'); };
  $('exportTmCsv').onclick = () => { downloadText('my-trademarks.csv', trademarksToCSV(state.marks), 'text/csv'); setStatus('Trademarks exported to CSV.', 'ok'); };
  $('exportPatentWatch').onclick = () => {
    const list = state.patents.map((p) => p.applicationNumberText).filter(Boolean);
    if (!list.length) return setStatus('Add patents first, then export the watchlist.', 'error');
    download('patent-watchlist.json', list);
    setStatus('Commit this to data/patent-watchlist.json and set the ODP_API_KEY secret to enable patent email alerts.', 'ok');
  };
  $('clearActivity').onclick = () => { clearActivity(); refreshDashboard(); setStatus('Activity log cleared.', 'ok'); };
}

function updatePermLabel() {
  const el = $('permState');
  if (!el) return;
  const s = permissionState();
  el.textContent = !notificationsSupported() ? 'Notifications unsupported in this browser'
    : s === 'granted' ? '● Permission granted' : s === 'denied' ? '● Blocked in browser settings' : '○ Permission not requested';
}

function refreshDashboard() {
  const deadlines = allDeadlines(state.patents, state.marks);
  renderDashboard($('dashboard'), { patents: state.patents, marks: state.marks, deadlines, activity: getActivity() });
}

function scheduleAutoCheck() {
  if (state.autoTimer) clearInterval(state.autoTimer);
  const prefs = notifyPrefs.get();
  if (!prefs.autoCheck) return;
  const ms = Math.max(1, prefs.intervalHours) * 3600 * 1000;
  state.autoTimer = setInterval(() => maybeAutoRefresh('interval', { force: true }), ms);
}

// Re-check when the user returns to the tab/window, so data is current "whenever"
// they look — throttled so we never hammer the rate-limited ODP API.
function wireAutoRefreshTriggers() {
  document.addEventListener('visibilitychange', () => { if (!document.hidden) maybeAutoRefresh('visible'); });
  window.addEventListener('focus', () => maybeAutoRefresh('focus'));
  window.addEventListener('online', () => maybeAutoRefresh('online', { force: true }));
}

const MIN_AUTO_GAP_MS = 5 * 60 * 1000; // don't auto-refresh more than once / 5 min

async function maybeAutoRefresh(reason, { force = false } = {}) {
  const prefs = notifyPrefs.get();
  if (!prefs.autoCheck) return;
  const now = Date.now();
  if (!force && state.lastAutoRefresh && now - state.lastAutoRefresh < MIN_AUTO_GAP_MS) return;
  state.lastAutoRefresh = now;
  // Trademarks: cheap same-origin fetch of the published status — always safe.
  await refreshTrademarks();
  // Patents: live ODP calls — only when we have something to check and a key.
  if (state.patents.length && settings.getApiKey()) await onCheckAll({ silent: true });
  notifyDueDeadlines();
}

// Toast (and log) deadlines entering the warning window, at most once per day each.
function notifyDueDeadlines() {
  const prefs = notifyPrefs.get();
  const warnDays = prefs.deadlineDays || 120;
  const today = new Date();
  const seenKey = 'uspto_dl_seen';
  let seen = {};
  try { seen = JSON.parse(localStorage.getItem(seenKey) || '{}'); } catch {}
  const todayStr = today.toISOString().slice(0, 10);
  const dls = allDeadlines(state.patents, state.marks, today);
  for (const d of dls) {
    if (!['due-soon', 'grace', 'lapsed'].includes(d.urgency.state)) continue;
    if (d.urgency.daysToDue != null && d.urgency.daysToDue > warnDays) continue;
    const key = `${d.kind}-${d.refId}-${d.label}`;
    if (seen[key] === todayStr) continue;
    seen[key] = todayStr;
    fire({
      title: `Deadline: ${d.label}`,
      body: `${d.refTitle} — ${d.urgency.badge}. Due ${d.dueDate}.`,
      tag: key, kind: 'deadline', refId: d.refId, url: d.payLink,
    });
  }
  localStorage.setItem(seenKey, JSON.stringify(seen));
  refreshDashboard();
}

function clampNum(v, min, max, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/* ---------------- PWA ---------------- */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const base = import.meta.env.BASE_URL || '/';
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {});
  });
}

/* ---------------- shared ---------------- */
function download(name, obj) {
  downloadText(name, JSON.stringify(obj, null, 2), 'application/json');
}
function downloadText(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  URL.revokeObjectURL(a.href);
}

init();
