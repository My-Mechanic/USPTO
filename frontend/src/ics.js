// iCalendar (.ics) export for portfolio deadlines.
//
// Produces a standards-compliant VCALENDAR with one all-day VEVENT per deadline
// (an alarm 30 days out), so inventors can subscribe in Google/Apple/Outlook
// Calendar and never miss a maintenance fee or renewal window.

function pad(n) { return String(n).padStart(2, '0'); }

// All-day events use DATE values (YYYYMMDD).
function toDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

function stamp() {
  const d = new Date();
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

// Escape per RFC 5545 and fold long lines at 75 octets.
function esc(s) {
  return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
function fold(line) {
  if (line.length <= 75) return line;
  const out = [];
  let i = 0;
  while (i < line.length) { out.push((i ? ' ' : '') + line.slice(i, i + (i ? 74 : 75))); i += i ? 74 : 75; }
  return out.join('\r\n');
}

function uid(d) {
  return `${d.kind}-${d.refId}-${(d.label || '').replace(/[^a-z0-9]/gi, '')}-${d.dueDate}@uspto-portfolio`;
}

export function buildICS(deadlines) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//My USPTO Portfolio//Deadlines//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:USPTO Portfolio Deadlines',
  ];
  const now = stamp();
  for (const d of deadlines) {
    const start = toDate(d.windowOpen || d.dueDate);
    const due = toDate(d.dueDate);
    if (!due) continue;
    // End date is exclusive for all-day events → day after the due date.
    const endD = new Date(d.dueDate); endD.setUTCDate(endD.getUTCDate() + 1);
    const end = toDate(endD.toISOString());
    const kindLabel = d.kind === 'patent' ? 'Patent' : 'Trademark';
    lines.push(
      'BEGIN:VEVENT',
      `UID:${esc(uid(d))}`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${start || due}`,
      `DTEND;VALUE=DATE:${end}`,
      fold(`SUMMARY:${esc(`${d.label} — ${d.refTitle}`)}`),
      fold(`DESCRIPTION:${esc(`${kindLabel} ${d.refId}. ${d.detail || ''}\nFiling window: ${d.windowOpen || '?'} → due ${d.dueDate}${d.graceEnd ? ` (grace to ${d.graceEnd})` : ''}.\nManage: ${d.payLink || ''}\nEstimate — verify exact dates/fees with the USPTO.`)}`),
      d.link ? fold(`URL:${esc(d.link)}`) : '',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      fold(`DESCRIPTION:${esc(`${d.label} for ${d.refTitle} is approaching`)}`),
      'TRIGGER:-P30D',
      'END:VALARM',
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.filter(Boolean).join('\r\n');
}

export function downloadICS(deadlines, filename = 'uspto-deadlines.ics') {
  const blob = new Blob([buildICS(deadlines)], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
