import { fetchPatent, searchApplications, buildPatentQuery, patentSnapshot } from './api.js';
import { saveRecords, getRecords, deleteRecord, clearAll, settings } from './db.js';
import { syncPrivate, bridgeAvailableHere } from './sync.js';
import { loadTrademarkStatus, tmWatch } from './trademarks.js';
import { renderWatchlist, renderResults, renderTrademarks, setStatus } from './ui.js';

const state = {
  patents: [],
  marks: [],
  tmGeneratedAt: '',
  pFilter: { text: '', state: '', country: '', sort: 'filingDate-desc' },
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
  if (!bridgeAvailableHere()) $('syncBtn').title = 'Live private sync works only when running locally.';

  refreshPatents();
  await refreshTrademarks();
  setStatus('Add your patents and trademarks to start monitoring them.');
}

/* ---------------- tabs + key ---------------- */
function wireTabs() {
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
      $('tab-patents').hidden = btn.dataset.tab !== 'patents';
      $('tab-trademarks').hidden = btn.dataset.tab !== 'trademarks';
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
  $('checkAll').onclick = onCheckAll;
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

async function addPatent(p) {
  const existing = state.patents.find((x) => x.applicationNumberText === p.applicationNumberText);
  const rec = {
    ...p,
    addedAt: existing ? existing.addedAt : new Date().toISOString(),
    lastChecked: new Date().toISOString(),
    snapshot: patentSnapshot(p),
    changed: false,
    changeNote: '',
  };
  await saveRecords([rec]);
  state.patents = await getRecords();
  refreshPatents();
}

async function onCheckAll() {
  const apiKey = apiKeyOrWarn();
  if (!apiKey) return;
  if (!state.patents.length) return setStatus('Nothing to check yet.', 'error');
  setStatus('Checking your patents for updates…');
  let changed = 0;
  for (const old of state.patents) {
    try {
      const fresh = await fetchPatent({ apiKey, number: old.applicationNumberText, type: 'application' });
      const snap = patentSnapshot(fresh);
      const didChange = old.snapshot && snap !== old.snapshot;
      if (didChange) changed++;
      await saveRecords([{
        ...fresh,
        addedAt: old.addedAt,
        lastChecked: new Date().toISOString(),
        snapshot: snap,
        changed: didChange || old.changed,
        changeNote: didChange
          ? `Status/event changed: ${fresh.status} — ${fresh.latestEvent || ''}`.trim()
          : old.changeNote || '',
      }]);
    } catch (e) {
      // keep going; one failure shouldn't stop the batch
    }
  }
  state.patents = await getRecords();
  refreshPatents();
  setStatus(changed ? `${changed} application(s) have updates — highlighted below.` : 'Checked. No changes since last time.', 'ok');
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
  setStatus('My Patents cleared.', 'ok');
}

function patentView() {
  const { text, state: st, country, sort } = state.pFilter;
  const out = state.patents.filter((p) => {
    const hay = `${p.applicationNumberText} ${p.inventionTitle} ${p.status} ${p.assignee} ${p.inventors}`.toLowerCase();
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
    onRemove: async (p) => { await deleteRecord(p.applicationNumberText); state.patents = await getRecords(); refreshPatents(); setStatus('Removed.', 'ok'); },
    onCheck: async (p) => { await recheckOne(p); },
  });
  $('patCount').textContent = view.length;
}

async function recheckOne(p) {
  const apiKey = apiKeyOrWarn();
  if (!apiKey) return;
  setStatus(`Re-checking ${p.applicationNumberText}…`);
  try {
    const fresh = await fetchPatent({ apiKey, number: p.applicationNumberText, type: 'application' });
    const snap = patentSnapshot(fresh);
    const didChange = p.snapshot && snap !== p.snapshot;
    await saveRecords([{ ...fresh, addedAt: p.addedAt, lastChecked: new Date().toISOString(), snapshot: snap, changed: didChange || p.changed, changeNote: didChange ? `Status/event changed: ${fresh.status} — ${fresh.latestEvent || ''}`.trim() : p.changeNote || '' }]);
    state.patents = await getRecords();
    refreshPatents();
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
  const { generatedAt, error, marks } = await loadTrademarkStatus();
  state.marks = marks;
  state.tmGeneratedAt = generatedAt;
  $('tmGenerated').textContent = error
    ? `⚠ ${error}`
    : generatedAt ? `Last checked by the monitor: ${new Date(generatedAt).toLocaleString()}` : 'Not monitored yet — add serials, commit the watchlist, run the Action.';
  renderTM();
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
  // Merge monitored marks with watchlist serials that have no status yet.
  const filter = $('tmFilter').value.toLowerCase();
  const bySerial = new Map(state.marks.map((m) => [m.serialNumber, m]));
  const rows = tmWatch.list().map((s) => bySerial.get(s) || { serialNumber: s, markText: '(pending)', pending: true, link: `https://tsdr.uspto.gov/#caseNumber=${s}&caseType=SERIAL_NO&searchType=statusSearch` });
  for (const m of state.marks) if (!tmWatch.list().includes(m.serialNumber)) rows.push(m);
  const view = rows.filter((t) => !filter || `${t.markText} ${t.serialNumber} ${t.status} ${t.owner}`.toLowerCase().includes(filter));
  renderTrademarks($('tmList'), view, {
    onRemove: (t) => { tmWatch.remove(t.serialNumber); renderTM(); setStatus(`Removed ${t.serialNumber} locally. Re-download & commit the watchlist to stop monitoring it.`, 'ok'); },
  });
  $('tmCount').textContent = view.length;
}

/* ---------------- shared ---------------- */
function download(name, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  URL.revokeObjectURL(a.href);
}

init();
