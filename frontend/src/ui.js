// Pure rendering helpers. All values are inserted as text/safe DOM (no innerHTML).

import { patentDeadlines, trademarkDeadlines, classify } from './deadlines.js';

export function setStatus(msg, kind = '') {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'status' + (kind ? ' ' + kind : '');
}

/* ---------- patent watchlist ---------- */
export function renderWatchlist(container, patents, handlers) {
  container.replaceChildren();
  if (!patents.length) {
    return container.appendChild(note('No patents tracked yet. Add one by number above, or use “Find your patent”.'));
  }
  for (const p of patents) container.appendChild(watchCard(p, handlers));
}

function watchCard(p, { onRemove, onCheck, onOpen }) {
  const el = document.createElement('div');
  el.className = 'card clickable' + (p.changed ? ' changed' : '');
  // Whole card opens the detail view; inner buttons stop propagation.
  if (onOpen) {
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.onclick = () => onOpen(p);
    el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(p); } };
  }

  const head = document.createElement('div');
  head.className = 'card-head';
  const titleBtn = document.createElement('div');
  titleBtn.className = 'card-title link-look';
  titleBtn.textContent = p.inventionTitle || '(untitled)';
  head.appendChild(titleBtn);
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

  const foot = document.createElement('div');
  foot.className = 'card-foot';
  const chk = document.createElement('span');
  chk.className = 'muted';
  chk.textContent = p.lastChecked ? `Checked ${fmt(p.lastChecked)}` : 'Not checked yet';
  foot.appendChild(chk);
  const right = document.createElement('span');
  const details = onOpen ? linkBtn('Details ↗', () => onOpen(p), 'accent') : null;
  const rc = linkBtn('Re-check', () => onCheck(p));
  const rm = linkBtn('Remove', () => onRemove(p), 'danger');
  for (const b of [details, rc, rm]) if (b) { stop(b); right.appendChild(b); }
  foot.appendChild(right);
  el.appendChild(foot);
  return el;
}

// Stop a button's click from bubbling to the card's open handler.
function stop(btn) {
  const orig = btn.onclick;
  btn.onclick = (e) => { e.stopPropagation(); if (orig) orig(e); };
}

/* ---------- detail view (modal) ---------- */
export function openModal(contentNode) {
  const modal = document.getElementById('modal');
  if (!modal) return;
  const card = modal.querySelector('.modal-card');
  card.replaceChildren(contentNode);
  modal.hidden = false;
  document.body.classList.add('modal-open');
  // Wire dismissal once.
  if (!modal.dataset.wired) {
    modal.dataset.wired = '1';
    modal.querySelector('.modal-backdrop').onclick = closeModal;
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  }
  card.scrollTop = 0;
}
export function closeModal() {
  const modal = document.getElementById('modal');
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove('modal-open');
}

export function renderPatentDetail(p, { onSaveNote, onCheck, onRemove }) {
  const root = document.createElement('div');
  root.appendChild(detailHeader(p.inventionTitle || '(untitled)', p.link, p.link ? 'Open in Google Patents ↗' : '', p.changed));

  root.appendChild(detailSection('Identifiers', [
    ['Application #', p.applicationNumberText],
    ['Patent #', p.patentNumber],
    ['Publication #', p.publicationNumber],
    ['Type', p.type],
    ['Source', p.source === 'private' ? 'Private / pending (local)' : 'Public (ODP)'],
  ]));
  root.appendChild(detailSection('Status & dates', [
    ['Status', p.status],
    ['Status date', p.statusDate],
    ['Filing date', p.filingDate],
    ['Grant date', p.grantDate],
    ['Latest event', p.latestEvent ? `${p.latestEvent}${p.latestEventDate ? ' (' + p.latestEventDate + ')' : ''}` : ''],
  ]));
  const loc = [p.inventorCity, p.inventorState, p.inventorCountry].filter(Boolean).join(', ');
  root.appendChild(detailSection('People', [
    ['Assignee / applicant', p.assignee],
    ['Inventors', p.inventors],
    ['Inventor location', loc],
  ]));

  // Deadlines (full list, all states)
  const dls = patentDeadlines(p).map((d) => ({ ...d, urgency: classify(d) }));
  if (dls.length) root.appendChild(deadlineBlock('Maintenance fees', dls));

  // Notes + tags (always-visible editor)
  if (onSaveNote) root.appendChild(notesEditor(p, onSaveNote));

  // Full prosecution timeline
  root.appendChild(timelineBlock(p.timeline));

  // Footer actions
  const foot = document.createElement('div');
  foot.className = 'modal-foot';
  const chk = document.createElement('span'); chk.className = 'muted small';
  chk.textContent = p.lastChecked ? `Last checked ${fmt(p.lastChecked)}` : 'Not checked yet';
  foot.appendChild(chk);
  const right = document.createElement('span');
  if (onCheck) right.appendChild(btn('Re-check now', () => onCheck(p)));
  if (onRemove) right.appendChild(btn('Remove', () => { onRemove(p); closeModal(); }, 'danger'));
  right.appendChild(btn('Close', closeModal));
  foot.appendChild(right);
  root.appendChild(foot);
  return root;
}

export function renderTrademarkDetail(t) {
  const root = document.createElement('div');
  root.appendChild(detailHeader(t.markText || '(no word mark)', t.link, 'Open in TSDR ↗', false));
  root.appendChild(detailSection('Identifiers', [
    ['Serial #', t.serialNumber],
    ['Registration #', t.registrationNumber],
  ]));
  root.appendChild(detailSection('Status & dates', [
    ['Status', t.status || (t.pending ? 'awaiting first check' : '')],
    ['Status date', t.statusDate],
    ['Filing date', t.filingDate],
    ['Registration date', t.registrationDate],
    ['Owner', t.owner],
  ]));
  const dls = trademarkDeadlines(t).map((d) => ({ ...d, urgency: classify(d) }));
  if (dls.length) root.appendChild(deadlineBlock('Post-registration deadlines', dls));
  else root.appendChild(note('Post-registration deadlines (§8 / §9 / §15) appear once the mark is registered.'));

  const foot = document.createElement('div');
  foot.className = 'modal-foot';
  foot.appendChild(document.createElement('span'));
  foot.appendChild(btn('Close', closeModal));
  root.appendChild(foot);
  return root;
}

function detailHeader(title, link, linkLabel, changed) {
  const head = document.createElement('div');
  head.className = 'modal-head';
  const left = document.createElement('div');
  const h = document.createElement('h2'); h.className = 'modal-title'; h.textContent = title;
  left.appendChild(h);
  if (changed) left.appendChild(pill('Recently updated', 'pill-change'));
  if (link && linkLabel) {
    const a = document.createElement('a'); a.className = 'modal-extlink';
    a.href = link; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = linkLabel;
    left.appendChild(a);
  }
  head.appendChild(left);
  const x = document.createElement('button'); x.className = 'modal-x'; x.setAttribute('aria-label', 'Close'); x.textContent = '✕';
  x.onclick = closeModal;
  head.appendChild(x);
  return head;
}

function detailSection(heading, pairs) {
  const sec = document.createElement('div'); sec.className = 'detail-sec';
  sec.appendChild(elText('h4', 'detail-h', heading));
  const grid = document.createElement('div'); grid.className = 'detail-grid';
  for (const [k, v] of pairs) {
    if (!v) continue;
    const row = document.createElement('div'); row.className = 'detail-kv';
    row.appendChild(elText('span', 'detail-k', k));
    row.appendChild(elText('span', 'detail-v', String(v)));
    grid.appendChild(row);
  }
  if (!grid.childNodes.length) grid.appendChild(elText('span', 'muted small', '—'));
  sec.appendChild(grid);
  return sec;
}

function deadlineBlock(heading, dls) {
  const sec = document.createElement('div'); sec.className = 'detail-sec';
  sec.appendChild(elText('h4', 'detail-h', heading));
  const list = document.createElement('div'); list.className = 'list';
  for (const d of dls) {
    const row = document.createElement('div'); row.className = 'dl-row';
    const top = document.createElement('div'); top.className = 'dl-row-top';
    top.appendChild(elText('span', 'dl-label', d.label));
    top.appendChild(pill(d.urgency.badge, d.urgency.cls));
    row.appendChild(top);
    row.appendChild(elText('div', 'muted small', `Window ${d.windowOpen || '?'} → due ${d.dueDate}${d.graceEnd ? ` (grace to ${d.graceEnd})` : ''}`));
    if (d.detail) row.appendChild(elText('div', 'muted small', d.detail));
    list.appendChild(row);
  }
  sec.appendChild(list);
  return sec;
}

function notesEditor(p, onSaveNote) {
  const sec = document.createElement('div'); sec.className = 'detail-sec';
  sec.appendChild(elText('h4', 'detail-h', 'Notes & tags (private to this browser)'));
  const ta = document.createElement('textarea'); ta.className = 'note-input'; ta.rows = 3;
  ta.placeholder = 'Add a private note…'; ta.value = p.note || '';
  const ti = document.createElement('input'); ti.className = 'tag-input';
  ti.placeholder = 'tags, comma, separated'; ti.value = (p.tags || []).join(', ');
  const wrap = document.createElement('div'); wrap.className = 'note-foot';
  wrap.appendChild(btn('Save note', () => {
    const tags = ti.value.split(',').map((s) => s.trim()).filter(Boolean);
    onSaveNote(p, { note: ta.value.trim(), tags });
  }, 'primary'));
  sec.append(ta, ti, wrap);
  return sec;
}

function timelineBlock(timeline) {
  const sec = document.createElement('div'); sec.className = 'detail-sec';
  const items = Array.isArray(timeline) ? timeline : [];
  sec.appendChild(elText('h4', 'detail-h', `Prosecution history${items.length ? ` (${items.length})` : ''}`));
  if (!items.length) {
    sec.appendChild(elText('p', 'muted small', 'No recorded events. Re-check to pull the latest prosecution history.'));
    return sec;
  }
  const ul = document.createElement('ul'); ul.className = 'tl-list full';
  for (const e of items) {
    const li = document.createElement('li');
    li.appendChild(elText('span', 'tl-date', e.date || '—'));
    li.appendChild(elText('span', 'tl-desc', e.description || ''));
    ul.appendChild(li);
  }
  sec.appendChild(ul);
  return sec;
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
export function renderTrademarks(container, marks, { onRemove, onOpen }) {
  container.replaceChildren();
  if (!marks.length) {
    return container.appendChild(note('No trademarks yet. Add a serial number above, commit the watchlist, and the daily Action will fill in status.'));
  }
  for (const t of marks) {
    const el = document.createElement('div');
    el.className = 'card' + (onOpen ? ' clickable' : '');
    if (onOpen) {
      el.tabIndex = 0; el.setAttribute('role', 'button');
      el.onclick = () => onOpen(t);
      el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(t); } };
    }
    const titleEl = document.createElement('div');
    titleEl.className = 'card-title' + (onOpen ? ' link-look' : '');
    titleEl.textContent = t.markText || '(no word mark)';
    el.appendChild(titleEl);
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
    const right = document.createElement('span');
    if (onOpen) { const d = linkBtn('Details ↗', () => onOpen(t), 'accent'); stop(d); right.appendChild(d); }
    const rm = linkBtn('Remove', () => onRemove(t), 'danger'); stop(rm); right.appendChild(rm);
    foot.appendChild(right);
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
function btn(text, onClick, cls = '') {
  const b = document.createElement('button'); b.className = 'btn small ' + cls; b.textContent = text; b.onclick = onClick; return b;
}
function elText(tag, cls, text) {
  const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n;
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
