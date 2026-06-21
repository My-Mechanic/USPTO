import { searchApplications, buildPatentQuery } from './api.js';
import { saveRecords, getRecords, clearStore, settings } from './db.js';
import { syncPrivate, bridgeAvailableHere } from './sync.js';
import { searchTrademarks, normalizeTrademark } from './trademarks.js';
import { renderPatentList, renderTrademarkList, setStatus } from './ui.js';

const state = {
  public: [],
  private: [],
  trademarks: [],
  pFilter: { text: '', state: '', country: '', sort: 'filingDate-desc' },
  tFilter: '',
};

const $ = (id) => document.getElementById(id);

async function init() {
  const presetKey = settings.getApiKey() || import.meta.env.VITE_ODP_API_KEY || '';
  if (presetKey && presetKey !== settings.getApiKey()) settings.setApiKey(presetKey);
  $('apiKey').value = presetKey;

  state.public = await getRecords('public');
  state.private = await getRecords('private');
  state.trademarks = await getRecords('trademarks');

  wireTabs();
  wirePatents();
  wireTrademarks();

  if (!bridgeAvailableHere()) {
    $('syncBtn').title = 'Live sync works only when running locally. Here, use Import JSON.';
    $('tSearch').title = 'Trademark search works only when running locally. Here, use Import JSON.';
  }
  refreshPatents();
  refreshTrademarks();
  setStatus('Ready. Build an advanced patent query, or search trademarks.');
}

/* ---------- tabs ---------- */
function wireTabs() {
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
      const tab = btn.dataset.tab;
      $('tab-patents').hidden = tab !== 'patents';
      $('tab-trademarks').hidden = tab !== 'trademarks';
    };
  });
  $('saveKey').onclick = () => {
    settings.setApiKey($('apiKey').value.trim());
    setStatus('API key saved to this browser.', 'ok');
  };
}

/* ---------- patents ---------- */
function wirePatents() {
  $('pSearch').onclick = onSearchPatents;
  $('syncBtn').onclick = onSyncPrivate;
  $('pImport').onchange = (e) => onImport(e, 'private');
  $('pExport').onclick = onExportPatents;
  $('pClear').onclick = onClearPatents;
  $('fText').oninput = (e) => { state.pFilter.text = e.target.value.toLowerCase(); refreshPatents(); };
  $('fState').onchange = (e) => { state.pFilter.state = e.target.value; refreshPatents(); };
  $('fCountry').onchange = (e) => { state.pFilter.country = e.target.value; refreshPatents(); };
  $('fSort').onchange = (e) => { state.pFilter.sort = e.target.value; refreshPatents(); };
  for (const id of ['pFirst', 'pLast', 'pAssignee', 'pTitle']) {
    $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') onSearchPatents(); });
  }
}

async function onSearchPatents() {
  const apiKey = settings.getApiKey() || $('apiKey').value.trim();
  if (apiKey && apiKey !== settings.getApiKey()) settings.setApiKey(apiKey);
  if (!apiKey) return setStatus('Enter your USPTO ODP API key first.', 'error');

  const raw = $('pRaw').value.trim();
  const q =
    raw ||
    buildPatentQuery({
      firstName: $('pFirst').value.trim(),
      lastName: $('pLast').value.trim(),
      assignee: $('pAssignee').value.trim(),
      title: $('pTitle').value.trim(),
      dateFrom: $('pFrom').value,
      dateTo: $('pTo').value,
    });
  if (!q) return setStatus('Fill at least one search field (or a raw query).', 'error');

  setStatus('Searching public patents…');
  try {
    let all = [];
    const limit = 100;
    let total = null;
    for (let page = 0; page < 20; page++) {
      const { patents, count } = await searchApplications({
        apiKey, q, offset: page * limit, limit,
        sort: 'applicationMetaData.filingDate desc',
      });
      if (total == null) total = count;
      all = all.concat(patents);
      if (patents.length < limit || (count != null && all.length >= count)) break;
    }
    await saveRecords('public', all);
    state.public = await getRecords('public');
    const more = total != null && total > all.length ? ` (of ${total} total — refine to narrow)` : '';
    setStatus(`Found ${all.length} public application(s)${more}.`, 'ok');
    refreshPatents();
  } catch (e) {
    setStatus(e.message, 'error');
  }
}

async function onSyncPrivate() {
  setStatus('Starting private sync — a browser window will open for you to log in…');
  try {
    const patents = await syncPrivate({ onStatus: (m) => setStatus(m) });
    await saveRecords('private', patents.map((p) => ({ ...p, source: 'private' })));
    state.private = await getRecords('private');
    setStatus(`Synced ${patents.length} private/pending application(s).`, 'ok');
    refreshPatents();
  } catch (e) {
    setStatus(e.message, 'error');
  }
}

async function onImport(e, store) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const keyField = store === 'trademarks' ? 'serialNumber' : 'applicationNumberText';
    let items = Array.isArray(parsed) ? parsed : parsed[store] || parsed.patents || parsed.trademarks || [];
    if (store === 'trademarks') items = items.map(normalizeTrademark);
    items = items.filter((r) => r && r[keyField]);
    await saveRecords(store, items);
    if (store === 'trademarks') { state.trademarks = await getRecords('trademarks'); refreshTrademarks(); }
    else { state.private = await getRecords('private'); refreshPatents(); }
    setStatus(`Imported ${items.length} record(s).`, 'ok');
  } catch (err) {
    setStatus('Import failed: ' + err.message, 'error');
  }
  e.target.value = '';
}

function download(name, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
function onExportPatents() { download('uspto-patents.json', { public: state.public, private: state.private }); }

async function onClearPatents() {
  if (!confirm('Clear all stored patents from this browser?')) return;
  await clearStore('public'); await clearStore('private');
  state.public = []; state.private = [];
  setStatus('Patents cleared.', 'ok'); refreshPatents();
}

function patentView(list) {
  const { text, state: st, country, sort } = state.pFilter;
  const out = list.filter((p) => {
    const hay = `${p.applicationNumberText} ${p.inventionTitle} ${p.status} ${p.assignee} ${p.inventors} ${p.filingDate}`.toLowerCase();
    return (!text || hay.includes(text)) &&
      (!st || p.inventorState === st) &&
      (!country || p.inventorCountry === country);
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
  renderPatentList($('publicList'), patentView(state.public));
  renderPatentList($('privateList'), patentView(state.private));
  $('publicCount').textContent = patentView(state.public).length;
  $('privateCount').textContent = patentView(state.private).length;
}

function populateFacets() {
  const all = [...state.public, ...state.private];
  fillSelect($('fState'), state.pFilter.state, distinct(all.map((p) => p.inventorState)), 'All states');
  fillSelect($('fCountry'), state.pFilter.country, distinct(all.map((p) => p.inventorCountry)), 'All countries');
}
function distinct(arr) { return [...new Set(arr.filter(Boolean))].sort(); }
function fillSelect(sel, current, values, allLabel) {
  const prev = current;
  sel.replaceChildren();
  const o0 = document.createElement('option'); o0.value = ''; o0.textContent = allLabel; sel.appendChild(o0);
  for (const v of values) {
    const o = document.createElement('option'); o.value = v; o.textContent = v;
    if (v === prev) o.selected = true;
    sel.appendChild(o);
  }
}

/* ---------- trademarks ---------- */
function wireTrademarks() {
  $('tSearch').onclick = onSearchTrademarks;
  $('tImport').onchange = (e) => onImport(e, 'trademarks');
  $('tExport').onclick = () => download('uspto-trademarks.json', { trademarks: state.trademarks });
  $('tClear').onclick = onClearTrademarks;
  $('tFilter').oninput = (e) => { state.tFilter = e.target.value.toLowerCase(); refreshTrademarks(); };
  $('tOwner').addEventListener('keydown', (e) => { if (e.key === 'Enter') onSearchTrademarks(); });
}

async function onSearchTrademarks() {
  const owner = $('tOwner').value.trim();
  if (!owner) return setStatus('Enter an owner / company name.', 'error');
  setStatus('Searching trademarks…');
  try {
    const raw = await searchTrademarks({ owner, onStatus: (m) => setStatus(m) });
    const marks = raw.map(normalizeTrademark).filter((t) => t.serialNumber);
    await saveRecords('trademarks', marks);
    state.trademarks = await getRecords('trademarks');
    setStatus(`Found ${marks.length} trademark(s).`, 'ok');
    refreshTrademarks();
  } catch (e) {
    setStatus(e.message, 'error');
  }
}

async function onClearTrademarks() {
  if (!confirm('Clear all stored trademarks from this browser?')) return;
  await clearStore('trademarks');
  state.trademarks = [];
  setStatus('Trademarks cleared.', 'ok'); refreshTrademarks();
}

function trademarkView() {
  const t = state.tFilter;
  return state.trademarks.filter((m) => {
    const hay = `${m.markText} ${m.serialNumber} ${m.registrationNumber} ${m.status} ${m.owner}`.toLowerCase();
    return !t || hay.includes(t);
  });
}
function refreshTrademarks() {
  const view = trademarkView();
  renderTrademarkList($('tmList'), view);
  $('tmCount').textContent = view.length;
}

init();
