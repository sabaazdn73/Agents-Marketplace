// StepChecklist.jsx
//
// A real, visible step checklist for any multi-signature on-chain flow in
// this app (hire, buy access, Altana session grant). Purely presentational —
// every row's state comes from the CALLER's real hook state (useHireAgent's
// step/completedSteps/skippedSteps/stepHashes/error, useBuyAccess's
// equivalent, etc.), never simulated/invented progress here.
//
// Four honest states per step, not three — "skipped" is real (the approve
// step in both the hire and buy-access flows is genuinely conditional, and
// showing it stuck on "pending" forever when it will never run would be
// exactly the kind of dishonest UI this project avoids elsewhere):
//   pending  — hollow circle, greyed out, not reached yet
//   active   — spinner, wallet prompt open / tx confirming right now
//   complete — checkmark, done — links to BscScan ONLY if a real hash exists
//   skipped  — dash, this run didn't need this step (e.g. already approved)
//   error    — red X, this exact step is where it failed, real message shown

import React from 'react';
import { CheckCircle2, XCircle, Loader2, Circle, MinusCircle, ExternalLink } from 'lucide-react';

const ICONS = {
  pending: { Icon: Circle, cls: 'text-gray-300 dark:text-gray-700' },
  active: { Icon: Loader2, cls: 'text-indigo-500 animate-spin' },
  complete: { Icon: CheckCircle2, cls: 'text-emerald-500' },
  skipped: { Icon: MinusCircle, cls: 'text-gray-400 dark:text-gray-600' },
  error: { Icon: XCircle, cls: 'text-red-500' },
};

const LABEL_CLS = {
  pending: 'text-gray-400 dark:text-gray-600',
  active: 'text-gray-900 dark:text-white font-semibold',
  complete: 'text-gray-700 dark:text-gray-200',
  skipped: 'text-gray-400 dark:text-gray-600 italic',
  error: 'text-red-600 dark:text-red-400 font-semibold',
};

/**
 * steps: [{ key, label, description, status, hash?, errorMessage? }]
 * Each `status` is one of pending|active|complete|skipped|error, computed
 * by the caller from its own real hook state — this component renders
 * exactly what it's given, nothing more.
 */
export default function StepChecklist({ steps }) {
  if (!steps || steps.length === 0) return null;
  return (
    <div className="space-y-0.5" role="list" aria-label="Transaction steps">
      {steps.map((s, i) => {
        const { Icon, cls } = ICONS[s.status] || ICONS.pending;
        const isLast = i === steps.length - 1;
        return (
          <div key={s.key} className="flex gap-3">
            <div className="flex flex-col items-center">
              <Icon size={18} className={`shrink-0 ${cls}`} />
              {!isLast && <div className="w-px flex-1 min-h-[18px] bg-gray-200 dark:bg-gray-800 my-1" />}
            </div>
            <div className={`pb-4 min-w-0 ${isLast ? 'pb-0' : ''}`}>
              <div className={`text-sm ${LABEL_CLS[s.status]}`}>{s.label}</div>
              {s.status !== 'error' && (
                <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">{s.description}</div>
              )}
              {s.status === 'complete' && s.hash && (
                <a
                  href={`https://bscscan.com/tx/${s.hash}`}
                  target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-indigo-500 hover:text-indigo-600 mt-1"
                >
                  View on BscScan <ExternalLink size={10} />
                </a>
              )}
              {s.status === 'skipped' && s.reason && (
                <div className="text-[11px] text-gray-400 dark:text-gray-600 italic mt-0.5">{s.reason}</div>
              )}
              {s.status === 'error' && s.errorMessage && (
                <div className="text-[11px] text-red-500 dark:text-red-400 mt-1 whitespace-pre-wrap break-words">{s.errorMessage}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
