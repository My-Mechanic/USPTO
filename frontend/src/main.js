import { searchApplications, buildQueryForName } from './api.js';
import { savePatents, getPatents, clearStore, settings } from './db.js';
import { syncPrivate, bridgeAvailableHere } from './sync.js';
import { renderList, setStatus } from './ui.js';

const state = {
  public: [],
  private: [],
  filter: { text: '', status: '', sort: 'filingDate-desc' },
};

const $ = (id) => document.getElementById(id);

async function init() {
  $('apiKey').value = settings.getApiKey();
  state.public = await getPatents('public');
  state.private = await getPatents('private');
  wire();
  if (!bridgeAvailableHere()) {
    $('syncBtn').title =
      'Live sync works only when running locally. Here, use Import JSON.';
  }
  refresh();
  setStatus('Ready. Enter your API key and fetch, or Import JSON.');
}

function wire() {
  $('saveKey').onclick = () => {
    settings.setApiKey($('apiKey').value.trim());
    setStatus('API key saved to this browser.', 'ok');
  };
  $('fetchBtn').onclick = onFetchPublic;
  $('syncBtn').onclick = onSyncPrivate;
  $('importInput').onchange = onImport;
  $('exportBtn').onclick = onExport;
  $('clearBtn').onclick = onClear;
  $('filterText').oninput = (e) => {
    state.filter.text = e.target.value.toLowerCase();
    refresh();
  };
  $('filterStatus').oninput = (e) => {
    state.filter.status = e.target.value.toLowerCase();
    refresh();
  };
  $('sortSel').onchange = (e) => {
    state.filter.sort = e.target.value;
    refresh();
  };
  $('searchName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onFetchPublic();
  });
}

async function onFetchPublic() {
  const apiKey = settings.getApiKey() || $('apiKey').value.trim();
  if (apiKey && apiKey !== settings.getApiKey()) settings.setApiKey(apiKey);
  const raw = $('rawQuery').value.trim();
  const name = $('searchName').value.trim();
  const q = raw || buildQueryForName(name);

  if (!apiKey) return setStatus('Enter your USPTO ODP API key first.', 'error');
  if (!q) return setStatus('Enter a name or a raw query.', 'error');

  setStatus('Fetching public applications from USPTO ODP…');
  try {
    let all = [];
    const limit = 100;
    for (let page = 0; page < 20; page++) {
      const { patents, count } = await searchApplications({
        apiKey,
        q,
        offset: page * limit,
        limit,
        sort: 'applicationMetaData.filingDate desc',
      });
      all = all.concat(patents);
      if (patents.length < limit || (count != null && all.length >= count)) break;
    }
    await savePatents('public', all);
    state.public = await getPatents('public');
    setStatus(`Fetched ${all.length} public application(s).`, 'ok');
    refresh();
  } catch (e) {
    setStatus(e.message, 'error');
  }
}

async function onSyncPrivate() {
  setStatus('Starting private sync — a browser window will open for you to log in…');
  try {
    const patents = await syncPrivate({ onStatus: (m) => setStatus(m) });
    const tagged = patents.map((p) => ({ ...p, source: 'private' }));
    await savePatents('private', tagged);
    state.private = await getPatents('private');
    setStatus(`Synced ${tagged.length} private/pending application(s).`, 'ok');
    refresh();
  } catch (e) {
    setStatus(e.message, 'error');
  }
}

async function onImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const items = Array.isArray(parsed)
      ? parsed
      : parsed.private || parsed.patents || [];
    const tagged = items
      .filter((p) => p && p.applicationNumberText)
      .map((p) => ({ ...p, source: 'private' }));
    await savePatents('private', tagged);
    state.private = await getPatents('private');
    setStatus(`Imported ${tagged.length} application(s).`, 'ok');
    refresh();
  } catch (err) {
    setStatus('Import failed: ' + err.message, 'error');
  }
  e.target.value = '';
}

function onExport() {
  const blob = new Blob(
    [JSON.stringify({ public: state.public, private: state.private }, null, 2)],
    { type: 'application/json' }
  );
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'uspto-patents.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

async function onClear() {
  if (!confirm('Clear all locally stored patents from this browser?')) return;
  await clearStore('public');
  await clearStore('private');
  state.public = [];
  state.private = [];
  setStatus('Local data cleared.', 'ok');
  refresh();
}

function view(list) {
  const { text, status, sort } = state.filter;
  const out = list.filter((p) => {
    const hay = `${p.applicationNumberText} ${p.inventionTitle} ${p.status} ${p.filingDate}`.toLowerCase();
    const okText = !text || hay.includes(text);
    const okStatus = !status || (p.status || '').toLowerCase().includes(status);
    return okText && okStatus;
  });
  const [key, dir] = sort.split('-');
  out.sort((a, b) => {
    const av = a[key] || '';
    const bv = b[key] || '';
    if (av === bv) return 0;
    return dir === 'desc' ? (av < bv ? 1 : -1) : av > bv ? 1 : -1;
  });
  return out;
}

function refresh() {
  renderList($('publicList'), view(state.public));
  renderList($('privateList'), view(state.private));
  $('publicCount').textContent = state.public.length;
  $('privateCount').textContent = state.private.length;
}

init();
