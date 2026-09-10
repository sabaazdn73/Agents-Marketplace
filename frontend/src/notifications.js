// In-app notifications, scoped honestly to what the app can actually
// detect: hired-job status changes (from polling getErc8183Job). No push/
// email; recent notifications persist in localStorage so they survive a
// refresh. A window event keeps every mounted bell in sync.
import { useState, useEffect } from 'react';

// Bumped to v2 on 2026-09-10. The stored notifications from v1 include
// budget lines written before the token symbol and number formatting were
// fixed, e.g. "Budget #1: 7.00e-6 BNB returned" for a budget denominated in
// ETH on Robinhood Chain. Those strings are frozen at write time, so fixing
// the code does not correct what is already in a user's bell. Bumping the key
// drops them rather than leaving wrong figures on screen indefinitely.
const N_KEY = 'aam_notifications_v2';
const J_KEY = 'aam_tracked_jobs_v1';   // { [jobId]: lastStatusName } for polling
const MAX = 50;
const EVT = 'aam-notif-changed';

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function write(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* quota/SSR */ }
}
function emit() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVT));
}

export function listNotifications() { return read(N_KEY, []); }
export function unreadCount() { return listNotifications().filter((n) => !n.read).length; }

export function addNotification(title, body) {
  const all = listNotifications();
  // De-dupe: ignore an identical message to the most recent one.
  if (all[0] && all[0].title === title && all[0].body === body) return;
  all.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ts: Date.now(), title, body, read: false,
  });
  write(N_KEY, all.slice(0, MAX));
  emit();
}

export function markAllRead() {
  write(N_KEY, listNotifications().map((n) => ({ ...n, read: true })));
  emit();
}
export function clearNotifications() { write(N_KEY, []); emit(); }

// ── Tracked jobs (for status-change polling) ──
export function trackJob(jobId, statusName) {
  const jobs = read(J_KEY, {});
  jobs[String(jobId)] = statusName ?? null;
  write(J_KEY, jobs);
}
export function getTrackedJobs() { return read(J_KEY, {}); }
export function setJobStatus(jobId, statusName) {
  const jobs = read(J_KEY, {});
  jobs[String(jobId)] = statusName;
  write(J_KEY, jobs);
}

/** Subscribe a component to the notification store (re-renders on change,
 * including cross-tab via the storage event). */
export function useNotifications() {
  const [, force] = useState(0);
  useEffect(() => {
    const h = () => force((x) => x + 1);
    window.addEventListener(EVT, h);
    window.addEventListener('storage', h);
    return () => { window.removeEventListener(EVT, h); window.removeEventListener('storage', h); };
  }, []);
  return { notifications: listNotifications(), unread: unreadCount(), markAllRead, clearNotifications };
}
