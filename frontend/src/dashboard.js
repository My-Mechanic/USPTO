// Dashboard rendering: portfolio stats, upcoming deadlines, recent activity.
// Pure DOM building (no innerHTML), matching ui.js conventions.

import { actionableCount } from './deadlines.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

export function renderDashboard(root, { patents, marks, deadlines, activity }) {
  root.replaceChildren();

  // ---- stat tiles ----
  const granted = patents.filter((p) => p.patentNumber || /granted|patented/i.test(p.status || '')).length;
  const pending = patents.length - granted;
  const registered = marks.filter((m) => m.registrationNumber).length;
  const needAttention = actionableCount(deadlines);

  const stats = el('div', 'stat-grid');
  stats.append(
    statTile(patents.length, 'Patents tracked', 'accent'),
    statTile(granted, 'Granted', 'ok'),
    statTile(pending, 'Pending', ''),
    statTile(marks.length, 'Trademarks', 'accent'),
    statTile(registered, 'Registered', 'ok'),
    statTile(needAttention, 'Deadlines need action', needAttention ? 'warn' : '')
  );
  root.append(sectionCard('Portfolio at a glance', stats));

  // ---- upcoming deadlines ----
  const dlWrap = el('div', 'list');
  const soon = deadlines.slice(0, 8);
  if (!soon.length) {
    dlWrap.append(el('p', 'empty', 'No upcoming deadlines. (Maintenance fees appear once a patent is granted; trademark deadlines once registered.)'));
  } else {
    for (const d of soon) dlWrap.append(deadlineRow(d));
  }
  const dlSection = sectionCard(`Upcoming deadlines`, dlWrap);
  root.append(dlSection);

  // ---- recent activity ----
  const actWrap = el('div', 'list');
  if (!activity.length) {
    actWrap.append(el('p', 'empty', 'No activity yet. Status changes and deadline alerts will be logged here.'));
  } else {
    for (const a of activity.slice(0, 25)) actWrap.append(activityRow(a));
  }
  root.append(sectionCard('Recent activity', actWrap));
}

export function deadlineRow(d) {
  const row = el('div', 'card dl-card ' + (d.urgency?.cls || ''));
  const head = el('div', 'card-head');
  const title = el('div', 'card-title');
  if (d.link) {
    const a = el('a', '', `${d.label}`);
    a.href = d.link; a.target = '_blank'; a.rel = 'noopener noreferrer';
    title.append(a);
  } else title.textContent = d.label;
  head.append(title);
  if (d.urgency?.badge) head.append(el('span', 'pill ' + (d.urgency.cls || ''), d.urgency.badge));
  row.append(head);

  const meta = el('div', 'card-meta');
  meta.append(
    kv(d.kind === 'patent' ? 'Patent' : 'Trademark', d.refTitle),
    kv('ID', d.refId),
    kv('Window', `${d.windowOpen || '?'} → ${d.dueDate}`)
  );
  if (d.graceEnd) meta.append(kv('Grace ends', d.graceEnd));
  row.append(meta);

  if (d.detail) row.append(el('div', 'change-note muted', d.detail));

  const foot = el('div', 'card-foot');
  foot.append(el('span'));
  if (d.payLink) {
    const a = el('a', 'linkbtn accent', 'How to file ↗');
    a.href = d.payLink; a.target = '_blank'; a.rel = 'noopener noreferrer';
    foot.append(a);
  }
  row.append(foot);
  return row;
}

function activityRow(a) {
  const row = el('div', 'act-row');
  const dot = el('span', 'act-dot act-' + (a.kind || 'info'));
  row.append(dot);
  const body = el('div', 'act-body');
  body.append(el('div', 'act-title', a.title || a.message || 'Update'));
  if (a.message && a.title) body.append(el('div', 'act-msg muted', a.message));
  const when = el('div', 'act-when muted', fmt(a.at));
  row.append(body, when);
  return row;
}

function statTile(value, label, tone) {
  const t = el('div', 'stat-tile ' + (tone ? 'tone-' + tone : ''));
  t.append(el('div', 'stat-num', String(value)));
  t.append(el('div', 'stat-label', label));
  return t;
}

function sectionCard(heading, contentNode) {
  const sec = el('section', 'panel');
  sec.append(el('h3', 'panel-h', heading));
  sec.append(contentNode);
  return sec;
}

function kv(label, value) {
  const span = el('span');
  const strong = el('strong'); strong.textContent = label + ': ';
  span.append(strong, document.createTextNode(value || '—'));
  return span;
}

function fmt(iso) {
  try { return new Date(iso).toLocaleString(); } catch { return iso || ''; }
}
