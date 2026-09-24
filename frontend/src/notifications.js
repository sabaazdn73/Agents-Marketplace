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
const J_KEY = 'aam_tracked_jobs_v1';   // { [jobId]: { status, wallet } } for polling
const MAX = 50;
const EVT = 'aam-notif-changed';

// Every notification here is about a wallet: a hire, a budget, a sale, a
// payment. So each is stored with the wallet that was connected when it was
// raised, and the bell shows only the connected wallet's. Disconnected, it
// shows only what was raised with no wallet connected. Entries written before
// this field existed have no known owner; they are shown while some wallet is
// connected, as they always were, and never while disconnected.
// The bell sets this from the wallet connection (useNotificationWallet).
// A flow that awaits a transaction should capture getActiveWallet() before its
// first await and pass it as `owner`, so a disconnect or a wallet switch
// mid-flow cannot file the result under whoever is connected at the end.
let activeWallet = null;
const LEGACY_OWNER = undefined;

export function setActiveWallet(address) {
  const next = address ? String(address).toLowerCase() : null;
  if (next === activeWallet) return;
  activeWallet = next;
  emit();
}

export function getActiveWallet() { return activeWallet; }

function visibleTo(owner) {
  return (n) => (n.wallet === LEGACY_OWNER ? owner !== null : n.wallet === owner);
}

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

function readAll() {
  migrateLegacyOnce();
  return read(N_KEY, []);
}

export function listNotifications() {
  return readAll().filter(visibleTo(activeWallet));
}
export function unreadCount() { return listNotifications().filter((n) => !n.read).length; }

function ownerOf(owner) {
  return owner ? String(owner).toLowerCase() : null;
}

export function addNotification(title, body, owner = activeWallet) {
  const wallet = ownerOf(owner);
  const all = readAll();
  // De-dupe: ignore an identical message to this wallet's most recent one.
  const last = all.find((n) => n.wallet === wallet);
  if (last && last.title === title && last.body === body) return;
  all.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ts: Date.now(), title, body, read: false, wallet,
  });
  write(N_KEY, all.slice(0, MAX));
  emit();
}

export function markAllRead() {
  const mine = visibleTo(activeWallet);
  write(N_KEY, readAll().map((n) => (mine(n) ? { ...n, read: true } : n)));
  emit();
}
export function clearNotifications() {
  const mine = visibleTo(activeWallet);
  write(N_KEY, readAll().filter((n) => !mine(n)));
  emit();
}

// ── Tracked jobs (for status-change polling) ──
// Stored as { [jobId]: { status, wallet } }. An older entry is a bare status
// string with no known owner, and is polled while some wallet is connected.
// Nothing is polled while disconnected.
function entryOf(v) {
  return v !== null && typeof v === 'object' ? v : { status: v ?? null, wallet: LEGACY_OWNER };
}
// A job keeps the owner it was first tracked under. A later refresh, which
// can land after a disconnect or a wallet switch, updates the status only.
// A legacy entry with no known owner is claimed by the first known wallet.
export function trackJob(jobId, statusName, owner = activeWallet) {
  const jobs = read(J_KEY, {});
  const k = String(jobId);
  const prev = k in jobs ? entryOf(jobs[k]) : null;
  const wallet = prev?.wallet || ownerOf(owner);
  if (!wallet) return; // nobody to file it under, and nothing to poll it for
  jobs[k] = { status: statusName ?? null, wallet };
  write(J_KEY, jobs);
}
/** { [jobId]: lastStatusName } for the connected wallet only. */
export function getTrackedJobs() {
  if (activeWallet === null) return {};
  const mine = visibleTo(activeWallet);
  const out = {};
  for (const [id, v] of Object.entries(read(J_KEY, {}))) {
    const e = entryOf(v);
    if (mine(e)) out[id] = e.status;
  }
  return out;
}
export function setJobStatus(jobId, statusName) {
  const jobs = read(J_KEY, {});
  const e = entryOf(jobs[String(jobId)]);
  jobs[String(jobId)] = { ...e, status: statusName };
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
    // An emit between this component's render and this effect reached no
    // listener; re-read once so the first paint's list is not the stale one.
    h();
    return () => { window.removeEventListener(EVT, h); window.removeEventListener('storage', h); };
  }, []);
  return { notifications: listNotifications(), unread: unreadCount(), markAllRead, clearNotifications };
}
