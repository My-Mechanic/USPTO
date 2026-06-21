// Pure rendering helpers. All values are inserted as text/safe DOM (no innerHTML).

export function setStatus(msg, kind = '') {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'status' + (kind ? ' ' + kind : '');
}

/* ---------- patent watchlist ---------- */
export function renderWatchlist(container, patents, { onRemove, onCheck }) {
  container.replaceChildren();
  if (!patents.length) {
    return container.appendChild(note('No patents tracked yet. Add one by number above, or use “Find your patent”.'));
  }
  for (const p of patents) container.appendChild(watchCard(p, { onRemove, onCheck }));
}

function watchCard(p, { onRemove, onCheck }) {
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
