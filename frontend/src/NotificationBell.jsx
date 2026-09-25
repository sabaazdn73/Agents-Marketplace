import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Check } from 'lucide-react';
import { useConnectedWallet } from './wallet/useConnectedWallet';
import {
  useNotifications, getTrackedJobs, setJobStatus, addNotification,
  setActiveWallet, getActiveWallet,
} from './notifications';
import { getJobStatus } from './altana';
import { STATUS_DISPLAY_LABEL } from './JobStatusPanel';

// Polls the user's tracked ERC-8183 jobs and raises a notification when a real
// on-chain status changes (FUNDED → SUBMITTED → COMPLETED/REJECTED/EXPIRED).
// The bell owns the polling, so it runs wherever a bell is mounted.
// Polls only the connected wallet's jobs, and nothing while disconnected. A
// poll that outlives a wallet change stops rather than file its result under
// the wallet that is connected now.
function useJobStatusPolling(wallet, intervalMs = 30000) {
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const jobs = getTrackedJobs();
      for (const [jobId, last] of Object.entries(jobs)) {
        try {
          const j = await getJobStatus(jobId);
          if (cancelled || getActiveWallet() !== wallet) return;
          if (j.statusName && j.statusName !== last) {
            const plain = STATUS_DISPLAY_LABEL[j.statusName] || j.statusName;
            addNotification(`Job #${jobId}: ${plain}`, `One of your hires just changed status to "${plain}".`);
            setJobStatus(jobId, j.statusName);
          }
        } catch { /* transient RPC error, retry next tick */ }
      }
    };
    if (!wallet) return undefined;
    const id = setInterval(poll, intervalMs);
    poll();
    return () => { cancelled = true; clearInterval(id); };
  }, [wallet, intervalMs]);
}

// The same connected address the header shows, from the one shared source
// (wallet/useConnectedWallet.js). Published to the notification store, which
// scopes everything it shows and records to that wallet.
function useNotificationWallet() {
  const { address } = useConnectedWallet();
  const wallet = (address || '').toLowerCase() || null;
  // Layout effect, so the list is re-scoped before the next paint rather than
  // showing the previous wallet's notifications for a frame.
  useLayoutEffect(() => { setActiveWallet(wallet); }, [wallet]);
  return wallet;
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Colours come from the theme roles, so one bell serves both themes and both apps.
export default function NotificationBell() {
  const wallet = useNotificationWallet();
  const { notifications, unread, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const btnRef = useRef(null);
  // Viewport coordinates for the panel. It is rendered through a portal
 // rather than as a child of the bell, so it needs coordinates
  // instead of `absolute right-0`.
  const [pos, setPos] = useState(null);
  useJobStatusPolling(wallet);

  useEffect(() => {
    // The panel lives outside `ref` now (it is portalled to <body>), so a
    // click inside it must not count as an outside click.
    const onDoc = (e) => {
      if (ref.current?.contains(e.target)) return;
      if (e.target?.closest?.('[data-notification-panel]')) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  // Anchor the panel to the bell in viewport space, then clamp it so it
  // can never run off either edge. The panel is 320px wide and the web
  // sidebar it sits in is also 320px, so a right-aligned panel used to
  // start at a negative x and get clipped away entirely.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      const W = Math.min(320, window.innerWidth - 16);
      let left = r.right - W;                       // prefer right-aligned
      left = Math.max(8, Math.min(left, window.innerWidth - W - 8));
      setPos({ top: r.bottom + 8, left, width: W });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button ref={btnRef} onClick={() => setOpen((o) => !o)} className="relative w-8 h-8 flex items-center justify-center rounded-md text-muted hover:text-fg hover:bg-inset transition-colors" aria-label="Notifications">
        <Bell size={16} aria-hidden="true" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {/* Portalled to <body> deliberately. In the web app this bell sits
          inside a sticky `overflow-y-auto` sidebar, and an absolutely
          positioned child of that container is clipped by it. Combined
          with `right-0` on a 320px panel inside a 320px sidebar, the panel
          was positioned off the left edge and then clipped, so opening it
          showed nothing at all. A portal escapes the clip; the clamped
          coordinates above keep it on screen. */}
      {open && pos && createPortal(
        <div
          data-notification-panel
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}
          className="max-h-96 overflow-y-auto rounded-md border border-line bg-surface shadow-xl z-[100] text-fg"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-line sticky top-0 bg-surface">
            <span className="text-sm font-bold">Notifications</span>
            {notifications.length > 0 && (
              <button onClick={markAllRead} className="text-[11px] text-indigo-500 hover:underline flex items-center gap-1"><Check size={11} /> Mark all read</button>
            )}
          </div>
          {notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted">No notifications yet.</div>
          ) : (
            <div className="divide-y divide-line">
              {notifications.map((n) => (
                <div key={n.id} className={`px-4 py-3 ${n.read ? '' : 'bg-indigo-50/60 dark:bg-indigo-500/5'}`}>
                  <div className="text-xs font-semibold flex items-center gap-2">{!n.read && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />}{n.title}</div>
                  <div className="text-[11px] text-muted mt-0.5">{n.body}</div>
                  <div className="text-[10px] text-muted mt-1">{timeAgo(n.ts)}</div>
                </div>
              ))}
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
