// Pure rendering helpers. All values are HTML-escaped (text nodes / safe DOM).

export function setStatus(msg, kind = '') {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'status' + (kind ? ' ' + kind : '');
}

export function renderPatentList(container, patents) {
  container.replaceChildren();
  if (!patents.length) return empty(container);
  for (const p of patents) container.appendChild(patentCard(p));
}

export function renderTrademarkList(container, marks) {
  container.replaceChildren();
  if (!marks.length) return empty(container);
  for (const m of marks) container.appendChild(trademarkCard(m));
}

function empty(container) {
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = 'Nothing here yet.';
  container.appendChild(p);
}

function patentCard(p) {
  const el = document.createElement('div');
  el.className = 'card';

  el.appendChild(titleRow(p.inventionTitle || '(untitled)', p.link));

  const meta = document.createElement('div');
  meta.className = 'card-meta';
  meta.append(
    field('App #', p.applicationNumberText),
    field('Filed', p.filingDate),
    field('Status', p.status)
  );
  if (p.patentNumber) meta.append(field('Patent #', p.patentNumber));
  if (p.type) meta.append(field('Type', p.type));
  el.appendChild(meta);

  // The disambiguation row: assignee + inventors + location.
  const who = document.createElement('div');
  who.className = 'card-who';
  if (p.assignee) who.append(badge('Assignee', p.assignee));
  if (p.inventors) who.append(field('Inventors', p.inventors));
  const loc = [p.inventorCity, p.inventorState, p.inventorCountry].filter(Boolean).join(', ');
  if (loc) who.append(badge('Location', loc));
  if (who.childNodes.length) el.appendChild(who);

  return el;
}

function trademarkCard(t) {
  const el = document.createElement('div');
  el.className = 'card';
  el.appendChild(titleRow(t.markText || '(design mark)', t.link));
  const meta = document.createElement('div');
  meta.className = 'card-meta';
  meta.append(
    field('Serial #', t.serialNumber),
    field('Status', t.status),
    field('Filed', t.filingDate)
  );
  if (t.registrationNumber) meta.append(field('Reg #', t.registrationNumber));
  el.appendChild(meta);
  if (t.owner) {
    const who = document.createElement('div');
    who.className = 'card-who';
    who.append(badge('Owner', t.owner));
    el.appendChild(who);
  }
  return el;
}

function titleRow(text, link) {
  const wrap = document.createElement('div');
  wrap.className = 'card-title';
  if (link) {
    const a = document.createElement('a');
    a.href = link;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = text;
    wrap.appendChild(a);
  } else {
    wrap.textContent = text;
  }
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
  const span = document.createElement('span');
  span.className = 'badge';
  const strong = document.createElement('strong');
  strong.textContent = label + ': ';
  span.append(strong, document.createTextNode(value));
  return span;
}
