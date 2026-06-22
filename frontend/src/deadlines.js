// Deadline engine — the feature inventors actually need.
//
// Patents and trademarks both lapse if you miss statutory deadlines. This module
// derives the upcoming ones from the data we already track (grant date for
// patents, registration date for trademarks) so the dashboard can warn well
// ahead of time and export them to a calendar.
//
// IMPORTANT: these are *estimates* to help you not miss a window. Always confirm
// exact dates and fee amounts with the USPTO before relying on them. Real dates
// can shift with extensions, petitions, small/micro-entity status, etc.

const DAY = 86400000;
const YEAR_DAYS = 365.2425;

function addYears(iso, years) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  // Calendar-accurate: bump the year, keep month/day.
  const whole = Math.trunc(years);
  const frac = years - whole;
  const r = new Date(d);
  r.setFullYear(r.getFullYear() + whole);
  if (frac) r.setTime(r.getTime() + frac * YEAR_DAYS * DAY);
  return r;
}

const iso = (d) => (d ? d.toISOString().slice(0, 10) : '');

// ---- Patent maintenance fees (utility patents only) ------------------------
// Due at 3.5 / 7.5 / 11.5 years after grant. Window opens 6 months before
// (3 / 7 / 11 yr); a 6-month surcharge grace period follows (4 / 8 / 12 yr).
const MAINT_STAGES = [
  { n: 3.5, label: '1st maintenance fee (3.5-yr)' },
  { n: 7.5, label: '2nd maintenance fee (7.5-yr)' },
  { n: 11.5, label: '3rd maintenance fee (11.5-yr)' },
];

function isUtility(p) {
  const t = `${p.type || ''}`.toLowerCase();
  // Design (15-yr term) and plant patents carry no maintenance fees.
  if (t.includes('design') || t.includes('plant')) return false;
  return true;
}

export function patentDeadlines(p) {
  if (!p || !p.grantDate || !isUtility(p)) return [];
  return MAINT_STAGES.map((s) => {
    const due = addYears(p.grantDate, s.n);
    return {
      kind: 'patent',
      refId: p.applicationNumberText,
      refTitle: p.inventionTitle || p.applicationNumberText,
      label: s.label,
      windowOpen: iso(addYears(p.grantDate, s.n - 0.5)),
      dueDate: iso(due),
      graceEnd: iso(addYears(p.grantDate, s.n + 0.5)),
      detail: 'Pay at USPTO Patent Maintenance Fees. Surcharge applies in the 6-month grace window.',
      payLink: 'https://www.uspto.gov/patents/maintain',
      link: p.link,
    };
  }).filter((d) => d.dueDate);
}

// ---- Trademark post-registration deadlines ---------------------------------
// §8 Declaration of Use: between 5th & 6th year after registration.
// §8 & §9 Combined Renewal: between 9th & 10th year, then every 10 years.
// §15 Incontestability (optional but valuable): eligible after 5 years of use.
export function trademarkDeadlines(t, today = new Date()) {
  if (!t || !t.registrationDate) return [];
  const out = [
    {
      label: '§8 Declaration of Use (5–6 yr)',
      windowOpen: iso(addYears(t.registrationDate, 5)),
      dueDate: iso(addYears(t.registrationDate, 6)),
      graceEnd: iso(addYears(t.registrationDate, 6.5)),
      detail: 'File a §8 Declaration of Continued Use or the registration is cancelled.',
    },
    {
      label: '§15 Incontestability (optional, after 5 yr)',
      windowOpen: iso(addYears(t.registrationDate, 5)),
      dueDate: iso(addYears(t.registrationDate, 6)),
      graceEnd: '',
      detail: 'Optional filing that strengthens your registration once in continuous use for 5 years.',
      optional: true,
    },
  ];
  // Renewals at year 10, 20, 30… — show the next one that hasn't passed.
  for (let yr = 10; yr <= 60; yr += 10) {
    const graceEnd = addYears(t.registrationDate, yr + 0.5);
    if (graceEnd && graceEnd >= today) {
      out.push({
        label: `§8 & §9 Renewal (${yr} yr)`,
        windowOpen: iso(addYears(t.registrationDate, yr - 1)),
        dueDate: iso(addYears(t.registrationDate, yr)),
        graceEnd: iso(graceEnd),
        detail: 'File a combined §8 & §9 renewal to keep the registration alive for another 10 years.',
      });
      break;
    }
  }
  return out.map((d) => ({
    kind: 'trademark',
    refId: t.serialNumber,
    refTitle: t.markText || t.serialNumber,
    payLink: 'https://www.uspto.gov/trademarks/maintain',
    link: t.link,
    ...d,
  }));
}

// Classify how urgent a deadline is relative to today.
// Returns { state, daysToDue, label } where state ∈
//   lapsed | grace | due-soon | open | upcoming | done(optional-passed)
export function classify(d, today = new Date()) {
  const due = d.dueDate ? new Date(d.dueDate) : null;
  const open = d.windowOpen ? new Date(d.windowOpen) : null;
  const grace = d.graceEnd ? new Date(d.graceEnd) : null;
  const daysToDue = due ? Math.ceil((due - today) / DAY) : null;

  if (grace && today > grace) return { state: 'lapsed', daysToDue, badge: 'Window closed', cls: 'dl-lapsed' };
  if (due && today > due && grace) return { state: 'grace', daysToDue, badge: 'In grace period (surcharge)', cls: 'dl-grace' };
  if (due && today > due && !grace) {
    if (d.optional) return { state: 'open', daysToDue, badge: 'Eligible now', cls: 'dl-open' };
    return { state: 'grace', daysToDue, badge: 'Past due', cls: 'dl-grace' };
  }
  if (open && today >= open) {
    const soon = daysToDue != null && daysToDue <= 120;
    return { state: soon ? 'due-soon' : 'open', daysToDue, badge: soon ? `Due in ${daysToDue} days` : 'Filing window open', cls: soon ? 'dl-soon' : 'dl-open' };
  }
  return { state: 'upcoming', daysToDue, badge: daysToDue != null ? `In ${Math.round(daysToDue / 30)} mo` : 'Upcoming', cls: 'dl-upcoming' };
}

// Build the full, sorted deadline list for a portfolio.
// Skips lapsed items older than ~1 year and passed optional filings.
export function allDeadlines(patents, marks, today = new Date()) {
  const list = [];
  for (const p of patents || []) list.push(...patentDeadlines(p));
  for (const t of marks || []) list.push(...trademarkDeadlines(t, today));

  const annotated = list
    .map((d) => ({ ...d, urgency: classify(d, today) }))
    .filter((d) => {
      if (d.urgency.state === 'lapsed') {
        const due = new Date(d.dueDate);
        return !isNaN(due) && (today - due) < 400 * DAY; // keep recently lapsed as a warning
      }
      return true;
    });

  const rank = { lapsed: 0, grace: 1, 'due-soon': 2, open: 3, upcoming: 4, done: 5 };
  annotated.sort((a, b) => {
    const ra = rank[a.urgency.state] ?? 9, rb = rank[b.urgency.state] ?? 9;
    if (ra !== rb) return ra - rb;
    return (a.dueDate || '').localeCompare(b.dueDate || '');
  });
  return annotated;
}

// Count of deadlines needing attention (for the dashboard badge / notifications).
export function actionableCount(deadlines) {
  return deadlines.filter((d) => ['lapsed', 'grace', 'due-soon'].includes(d.urgency.state)).length;
}
