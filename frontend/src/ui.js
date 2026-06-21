// Pure rendering helpers. All values are HTML-escaped before insertion.

export function setStatus(msg, kind = '') {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'status' + (kind ? ' ' + kind : '');
}

export function renderList(container, patents) {
  container.replaceChildren();
  if (!patents.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'No applications.';
    container.appendChild(p);
    return;
  }
  for (const p of patents) {
    container.appendChild(card(p));
  }
}

function card(p) {
  const el = document.createElement('div');
  el.className = 'card';

  const title = document.createElement('div');
  title.className = 'card-title';
  title.textContent = p.inventionTitle || '(untitled)';

  const meta = document.createElement('div');
  meta.className = 'card-meta';
  meta.append(
    field('App #', p.applicationNumberText),
    field('Filed', p.filingDate),
    field('Status', p.status)
  );
  if (p.patentNumber) meta.append(field('Patent #', p.patentNumber));
  if (p.type) meta.append(field('Type', p.type));

  el.append(title, meta);
  return el;
}

function field(label, value) {
  const span = document.createElement('span');
  const strong = document.createElement('strong');
  strong.textContent = label + ': ';
  span.append(strong, document.createTextNode(value || '—'));
  return span;
}
