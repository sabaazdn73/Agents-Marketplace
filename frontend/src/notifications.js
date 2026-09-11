// In-app notifications, scoped honestly to what the app can actually
// detect: hired-job status changes (from polling getErc8183Job). No push/
// email; recent notifications persist in localStorage so they survive a
// refresh. A window event keeps every mounted bell in sync.
import { useState, useEffect } from 'react';

// Bumped to v2 on 2026-09-10, to drop budget lines written before the token
// symbol and number formatting were fixed -- e.g. "Budget #1: 7.00e-6 BNB
// returned" for a budget denominated in ETH on Robinhood Chain. Those strings
// are frozen at write time, so fixing the code cannot correct what is already
// in somebody's bell.
//
// That bump emptied the notification centre. It did not drop two bad lines,
// it orphaned the whole history: a real bell held eight notifications going
// back three weeks, four of them unread, and every one of them became
// unreachable the moment the key changed. Two entries with a wrong token
// symbol are a smaller problem than a centre that shows nothing at all, and
// somebody who has hired agents for a month reasonably reads "empty" as
// "broken" rather than as "deliberately cleared".
//
// So v1 is migrated forward, once, on first read. The mislabelled entries
// come with it: they are a record of something that really happened, the
// amounts are right, and rewriting the history of what a user was told is
// worse than a stale unit on two lines. New writes are correctly formatted.
const N_KEY = 'aam_notifications_v2';
const LEGACY_N_KEY = 'aam_notifications_v1';
const MIGRATED_FLAG = 'aam_notifications_migrated_v1_to_v2';
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

/** Moves a v1 bell into v2 exactly once, and only when v2 has nothing of its
 *  own, so it can never overwrite newer entries or run twice. The flag is
 *  what makes it idempotent: without it, clearing the bell on purpose would
 *  resurrect the old list on the next read. */
function migrateLegacyOnce() {
  try {
    if (localStorage.getItem(MIGRATED_FLAG)) return;
    localStorage.setItem(MIGRATED_FLAG, '1');
    const legacy = read(LEGACY_N_KEY, null);
    if (!Array.isArray(legacy) || legacy.length === 0) return;
    const current = read(N_KEY, null);
    if (Array.isArray(current) && current.length > 0) return;
    write(N_KEY, legacy.slice(0, MAX));
  } catch { /* storage unavailable; nothing to migrate into */ }
}

export function listNotifications() {
  migrateLegacyOnce();
  return read(N_KEY, []);
}
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
