// Notifications + activity log (client side).
//
// Static site, so "notifications" come in two flavours:
//   • Browser/desktop Notifications fired when an open tab auto-checks and finds
//     a status change or an approaching deadline. Zero setup.
//   • A persistent activity log (localStorage) recording every change we ever
//     detected, so you see history even if you missed the toast.
// (Background email on trademark — and optionally patent — changes is handled
//  server-side by the GitHub Actions; see scripts/ and .github/workflows/.)

const LOG_KEY = 'uspto_activity';
const PREF_KEY = 'uspto_notify_prefs';
const LOG_CAP = 300;

export const notifyPrefs = {
  get() {
    try {
      return { enabled: false, autoCheck: true, intervalHours: 12, deadlineDays: 120, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') };
    } catch {
      return { enabled: false, autoCheck: true, intervalHours: 12, deadlineDays: 120 };
    }
  },
  set(patch) {
    const next = { ...notifyPrefs.get(), ...patch };
    localStorage.setItem(PREF_KEY, JSON.stringify(next));
    return next;
  },
};

export function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function permissionState() {
  return notificationsSupported() ? Notification.permission : 'unsupported';
}

export async function requestPermission() {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

// Fire a desktop notification (best-effort) and always record to the log.
export function fire({ title, body, tag, kind = 'info', refId = '', url = '' }) {
  logActivity({ kind, refId, title, message: body });
  const prefs = notifyPrefs.get();
  if (!prefs.enabled || permissionState() !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag, icon: iconDataUri(), badge: iconDataUri() });
    if (url) n.onclick = () => { window.focus(); if (url.startsWith('http')) window.open(url, '_blank'); };
  } catch {
    /* some browsers require a service worker for Notification ctor; log already kept */
  }
}

// ---- activity log ----------------------------------------------------------
export function logActivity(entry) {
  const log = getActivity();
  log.unshift({ at: new Date().toISOString(), ...entry });
  if (log.length > LOG_CAP) log.length = LOG_CAP;
  localStorage.setItem(LOG_KEY, JSON.stringify(log));
}

export function getActivity() {
  try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch { return []; }
}

export function clearActivity() {
  localStorage.removeItem(LOG_KEY);
}

// A tiny inline SVG so notifications carry an icon without an asset request.
function iconDataUri() {
  const svg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='64' height='64' rx='12' fill='%234f8cff'/><text x='32' y='44' font-size='34' text-anchor='middle' fill='white' font-family='sans-serif'>™</text></svg>";
  return 'data:image/svg+xml,' + svg;
}
