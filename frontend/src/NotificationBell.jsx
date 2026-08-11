import React, { useState, useEffect, useRef } from 'react';
import { Bell, Check } from 'lucide-react';
import { useNotifications, getTrackedJobs, setJobStatus, addNotification } from './notifications';
import { getJobStatus } from './altana';

// Polls the user's tracked ERC-8183 jobs and raises a notification when a real
// on-chain status changes (FUNDED → SUBMITTED → COMPLETED/REJECTED/EXPIRED).
// The bell owns the polling, so it runs wherever a bell is mounted.
function useJobStatusPolling(intervalMs = 30000) {
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const jobs = getTrackedJobs();
      for (const [jobId, last] of Object.entries(jobs)) {
        try {
          const j = await getJobStatus(jobId);
          if (cancelled) return;
          if (j.statusName && j.statusName !== last) {
            addNotification(`Job #${jobId} → ${j.statusName}`, `Your hired job's status changed to ${j.statusName}.`);
            setJobStatus(jobId, j.statusName);
          }
        } catch { /* transient RPC error — retry next tick */ }
      }
    };
    const id = setInterval(poll, intervalMs);
    poll();
    return () => { cancelled = true; clearInterval(id); };
  }, [intervalMs]);
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// variant: 'dark' (light icon, for the dark web sidebar) | 'light' (default).
export default function NotificationBell({ variant = 'light' }) {
  const { notifications, unread, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useJobStatusPolling();

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors" aria-label="Notifications">
        <Bell size={18} className={variant === 'dark' ? 'text-gray-300' : 'text-gray-600 dark:text-gray-300'} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1E293B] shadow-xl z-50 text-gray-900 dark:text-gray-100">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800 sticky top-0 bg-white dark:bg-[#1E293B]">
            <span className="text-sm font-bold">Notifications</span>
            {notifications.length > 0 && (
              <button onClick={markAllRead} className="text-[11px] text-indigo-500 hover:underline flex items-center gap-1"><Check size={11} /> Mark all read</button>
            )}
          </div>
          {notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-gray-400">No notifications yet.</div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {notifications.map((n) => (
                <div key={n.id} className={`px-4 py-3 ${n.read ? '' : 'bg-indigo-50/60 dark:bg-indigo-500/5'}`}>
                  <div className="text-xs font-semibold flex items-center gap-2">{!n.read && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />}{n.title}</div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{n.body}</div>
                  <div className="text-[10px] text-gray-400 mt-1">{timeAgo(n.ts)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
