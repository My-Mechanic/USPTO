// Pure rendering helpers. All values are inserted as text/safe DOM (no innerHTML).

import { patentDeadlines, trademarkDeadlines, classify } from './deadlines.js';

export function setStatus(msg, kind = '') {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'status' + (kind ? ' ' + kind : '');
}

/* ---------- patent watchlist ---------- */
export function renderWatchlist(container, patents, { onRemove, onCheck, onSaveNote }) {
  container.replaceChildren();
  if (!patents.length) {
    return container.appendChild(note('No patents tracked yet. Add one by number above, or use “Find your patent”.'));
  }
  for (const p of patents) container.appendChild(watchCard(p, { onRemove, onCheck, onSaveNote }));
}

function watchCard(p, { onRemove, onCheck, onSaveNote }) {
  const el = document.createElement('div');
  el.className = 'card' + (p.changed ? ' changed' : '');

  const head = document.createElement('div');
  head.className = 'card-head';
  head.appendChild(titleRow(p.inventionTitle || '(untitled)', p.link));
  if (p.changed) head.appendChild(pill('Updated', 'pill-change'));
  el.appendChild(head);

  const meta = document.createElement('div');
  meta.className = 'card-meta';
  meta.append(field('App #', p.applicationNumberText), field('Filed', p.filingDate), field('Status', p.status));
  if (p.patentNumber) meta.append(field('Patent #', p.patentNumber));
  el.appendChild(meta);

  const ev = document.createElement('div');
  ev.className = 'card-who';
  if (p.latestEvent) ev.append(badge('Latest', `${p.latestEvent}${p.latestEventDate ? ' (' + p.latestEventDate + ')' : ''}`));
  if (p.assignee) ev.append(field('Assignee', p.assignee));
  if (ev.childNodes.length) el.appendChild(ev);

  // Tags
  if (Array.isArray(p.tags) && p.tags.length) {
    const tg = document.createElement('div'); tg.className = 'tag-row';
    for (const t of p.tags) tg.appendChild(pill(t, 'tag'));
    el.appendChild(tg);
  }

  // Maintenance-fee deadlines (granted utility patents only)
  const dls = patentDeadlines(p).map((d) => ({ ...d, urgency: classify(d) }))
    .filter((d) => ['lapsed', 'grace', 'due-soon', 'open'].includes(d.urgency.state));
  if (dls.length) {
    const dl = document.createElement('div'); dl.className = 'dl-inline';
    for (const d of dls.slice(0, 1)) {
      dl.append(pill(`⏰ ${d.label}: ${d.urgency.badge}`, d.urgency.cls));
    }
    el.appendChild(dl);
  }

  if (p.changeNote) {
    const cn = document.createElement('div');
    cn.className = 'change-note';
    cn.textContent = '↳ ' + p.changeNote;
    el.appendChild(cn);
  }

  // Prosecution timeline (expandable)
  if (Array.isArray(p.timeline) && p.timeline.length) {
    const det = document.createElement('details'); det.className = 'timeline';
    const sum = document.createElement('summary'); sum.textContent = `Prosecution history (${p.timeline.length})`;
    det.appendChild(sum);
    const ul = document.createElement('ul'); ul.className = 'tl-list';
    for (const e of p.timeline) {
      const li = document.createElement('li');
      const d = document.createElement('span'); d.className = 'tl-date'; d.textContent = e.date || '—';
      const t = document.createElement('span'); t.className = 'tl-desc'; t.textContent = e.description || '';
      li.append(d, t); ul.appendChild(li);
    }
    det.appendChild(ul);
    el.appendChild(det);
  }

  // Notes + tags editor (expandable)
  if (onSaveNote) {
    const det = document.createElement('details'); det.className = 'notes';
    const sum = document.createElement('summary');
    sum.textContent = p.note ? '📝 Note & tags' : 'Add note / tags';
    det.appendChild(sum);
    const ta = document.createElement('textarea'); ta.className = 'note-input'; ta.rows = 3;
    ta.placeholder = 'Private note (stays in this browser)…'; ta.value = p.note || '';
    const ti = document.createElement('input'); ti.className = 'tag-input';
    ti.placeholder = 'tags, comma, separated'; ti.value = (p.tags || []).join(', ');
    const save = linkBtn('Save', () => {
      const tags = ti.value.split(',').map((s) => s.trim()).filter(Boolean);
      onSaveNote(p, { note: ta.value.trim(), tags });
    }, 'accent');
    const wrap = document.createElement('div'); wrap.className = 'note-foot';
    wrap.append(save);
    det.append(ta, ti, wrap);
    el.appendChild(det);
  }

  const foot = document.createElement('div');
  foot.className = 'card-foot';
  const chk = document.createElement('span');
  chk.className = 'muted';
  chk.textContent = p.lastChecked ? `Checked ${fmt(p.lastChecked)}` : 'Not checked yet';
  foot.appendChild(chk);
  const right = document.createElement('span');
  right.append(linkBtn('Re-check', () => onCheck(p)), linkBtn('Remove', () => onRemove(p), 'danger'));
  foot.appendChild(right);
  el.appendChild(foot);
  return el;
}

/* ---------- search results (find-to-add) ---------- */
export function renderResults(container, patents, { onAdd, tracked }) {
  container.replaceChildren();
  if (!patents.length) return container.appendChild(note('No results.'));
  for (const p of patents) {
    const el = document.createElement('div');
    el.className = 'card';
    el.appendChild(titleRow(p.inventionTitle || '(untitled)', p.link));
    const meta = document.createElement('div');
    meta.className = 'card-meta';
    meta.append(field('App #', p.applicationNumberText), field('Filed', p.filingDate), field('Status', p.status));
    el.appendChild(meta);
    const who = document.createElement('div');
    who.className = 'card-who';
    if (p.assignee) who.append(badge('Assignee', p.assignee));
    const loc = [p.inventorCity, p.inventorState, p.inventorCountry].filter(Boolean).join(', ');
    if (p.inventors) who.append(field('Inventors', p.inventors));
    if (loc) who.append(badge('Location', loc));
    el.appendChild(who);
    const foot = document.createElement('div');
    foot.className = 'card-foot';
    foot.appendChild(document.createElement('span'));
    if (tracked.has(p.applicationNumberText)) {
      const s = document.createElement('span'); s.className = 'muted'; s.textContent = '✓ Tracked';
      foot.appendChild(s);
    } else {
      foot.appendChild(linkBtn('+ Add to My Patents', () => onAdd(p), 'accent'));
    }
    el.appendChild(foot);
    container.appendChild(el);
  }
}

/* ---------- trademarks ---------- */
export function renderTrademarks(container, marks, { onRemove }) {
  container.replaceChildren();
  if (!marks.length) {
    return container.appendChild(note('No trademarks yet. Add a serial number above, commit the watchlist, and the daily Action will fill in status.'));
  }
  for (const t of marks) {
    const el = document.createElement('div');
    el.className = 'card';
    el.appendChild(titleRow(t.markText || '(no word mark)', t.link));
    const meta = document.createElement('div');
    meta.className = 'card-meta';
    meta.append(field('Serial #', t.serialNumber), field('Status', t.status || (t.pending ? 'awaiting first check' : '—')), field('Filed', t.filingDate));
    if (t.registrationNumber) meta.append(field('Reg #', t.registrationNumber));
    el.appendChild(meta);
    if (t.owner) {
      const who = document.createElement('div'); who.className = 'card-who';
      who.append(badge('Owner', t.owner));
      el.appendChild(who);
    }
    // Post-registration deadlines (§8 / §9 / §15)
    const dls = trademarkDeadlines(t).map((d) => ({ ...d, urgency: classify(d) }))
      .filter((d) => ['lapsed', 'grace', 'due-soon', 'open'].includes(d.urgency.state));
    if (dls.length) {
      const dl = document.createElement('div'); dl.className = 'dl-inline';
      for (const d of dls.slice(0, 2)) dl.append(pill(`⏰ ${d.label}: ${d.urgency.badge}`, d.urgency.cls));
      el.appendChild(dl);
    }
    const foot = document.createElement('div'); foot.className = 'card-foot';
    foot.appendChild(document.createElement('span'));
    foot.appendChild(linkBtn('Remove', () => onRemove(t), 'danger'));
    el.appendChild(foot);
    container.appendChild(el);
  }
}

/* ---------- small builders ---------- */
function titleRow(text, link) {
  const wrap = document.createElement('div');
  wrap.className = 'card-title';
  if (link) {
    const a = document.createElement('a');
    a.href = link; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = text;
    wrap.appendChild(a);
  } else wrap.textContent = text;
  return wrap;
}
function field(label, value) {
  const span = document.createElement('span');
  const strong = document.createElement('strong');
  strong.textContent = label + ': ';
  span.append(strong, document.createTextNode(value || '—'));
  return span;
}
function badge(label, value) {
  const span = document.createElement('span'); span.className = 'badge';
  const strong = document.createElement('strong'); strong.textContent = label + ': ';
  span.append(strong, document.createTextNode(value));
  return span;
}
function pill(text, cls) {
  const s = document.createElement('span'); s.className = 'pill ' + (cls || ''); s.textContent = text; return s;
}
function linkBtn(text, onClick, cls = '') {
  const b = document.createElement('button'); b.className = 'linkbtn ' + cls; b.textContent = text; b.onclick = onClick; return b;
}
function note(text) {
  const p = document.createElement('p'); p.className = 'empty'; p.textContent = text; return p;
}
function fmt(iso) {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

/* ---------- CSV export ---------- */
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function patentsToCSV(patents) {
  const cols = ['applicationNumberText', 'inventionTitle', 'status', 'statusDate', 'filingDate', 'patentNumber', 'grantDate', 'type', 'assignee', 'inventors', 'latestEvent', 'latestEventDate', 'note', 'tags'];
  const head = cols.join(',');
  const rows = patents.map((p) => cols.map((c) => csvCell(Array.isArray(p[c]) ? p[c].join('; ') : p[c])).join(','));
  return [head, ...rows].join('\n');
}
export function trademarksToCSV(marks) {
  const cols = ['serialNumber', 'markText', 'status', 'statusDate', 'filingDate', 'registrationNumber', 'registrationDate', 'owner'];
  const head = cols.join(',');
  const rows = marks.map((t) => cols.map((c) => csvCell(t[c])).join(','));
  return [head, ...rows].join('\n');
}
