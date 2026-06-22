// Trademark monitoring (read side).
//
// A scheduled GitHub Action (.github/workflows/monitor-trademarks.yml) reads the
// repo's data/trademark-watchlist.json, calls the official USPTO TSDR API with a
// secret key, and publishes frontend/public/trademark-status.json. This module
// just READS that published file and manages the local watchlist of serials the
// user wants to add (which they commit to the repo file to start monitoring).

const STATUS_URL = `${import.meta.env.BASE_URL}trademark-status.json`;

// Local list of serial numbers the user has added in the UI (to be committed to
// data/trademark-watchlist.json so the Action picks them up).
export const tmWatch = {
  list() {
    try { return JSON.parse(localStorage.getItem('tm_watch') || '[]'); } catch { return []; }
  },
  add(serial) {
    const s = String(serial).replace(/[^0-9]/g, '');
    if (!s) return;
    const l = tmWatch.list();
    if (!l.includes(s)) l.push(s);
    localStorage.setItem('tm_watch', JSON.stringify(l));
  },
  remove(serial) {
    localStorage.setItem('tm_watch', JSON.stringify(tmWatch.list().filter((x) => x !== serial)));
  },
  seed(serials) {
    const l = new Set(tmWatch.list());
    for (const s of serials) if (s) l.add(String(s));
    localStorage.setItem('tm_watch', JSON.stringify([...l]));
  },
};

// Returns { generatedAt, info, marks: [normalized] }. Empty if not generated yet.
// `info` is a neutral status note (e.g. setup pending, USPTO API down) — not an
// alarming "secret missing" error.
export async function loadTrademarkStatus() {
  try {
    const res = await fetch(STATUS_URL, { cache: 'no-store' });
    if (!res.ok) return { marks: [] };
    const d = await res.json();
    const marks = (d.marks || []).map(normalizeTrademark);
    // Keep the local watchlist in sync with what's actually monitored.
    tmWatch.seed(marks.map((m) => m.serialNumber));
    return { generatedAt: d.generatedAt || '', info: d.info || d.error || '', marks };
  } catch {
    return { marks: [] };
  }
}

export function normalizeTrademark(t) {
  const serial = String(t.serialNumber || t.serial || '').replace(/[^0-9]/g, '');
  return {
    serialNumber: serial,
    registrationNumber: t.registrationNumber || '',
    markText: t.markText || t.mark || '(no word mark)',
    owner: t.owner || t.ownerName || '',
    status: t.status || t.statusText || '',
    statusDate: t.statusDate || '',
    filingDate: t.filingDate || '',
    registrationDate: t.registrationDate || '',
    link: serial
      ? `https://tsdr.uspto.gov/#caseNumber=${serial}&caseType=SERIAL_NO&searchType=statusSearch`
      : '',
    source: 'trademark',
  };
}
