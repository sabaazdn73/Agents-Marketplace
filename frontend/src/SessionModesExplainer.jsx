// SessionModesExplainer.jsx
//
// Real visual redesign of the "how does paying an agent actually work"
// explanation — a numbered step-by-step walkthrough paired with an
// original illustration, replacing the old single dense paragraph. Names
// the two real hire modes plainly (inspired by MoonPay's PayBox naming:
// short, everyday words instead of "spending-limit session" vs "direct
// approval"):
//   - Always Ask   — every payment needs your OK, right then (the direct-
//     pay / wagmi hire path).
//   - Autonomous   — the agent can act on its own, inside limits you
//     already set (the Altana spend-cap session path — AltanaSessionPanel).
// Naming/copy only — the real mechanism behind each (spend cap, expiry,
// on-chain contract allow-list, revocable session) is unchanged; see
// AltanaSessionPanel.jsx and altana.js for that.
//
// One shared, responsive component for both web and mobile (same pattern
// as StepChecklist/GetULink/AltanaSessionPanel) — no separate mobile
// rewrite needed, since this is normal flex/grid layout, not a
// fixed-coordinate diagram; it naturally stacks under `md:` on a narrow
// screen and the mobile app's viewport never reaches that breakpoint
// anyway.
import React from 'react';
import { ShieldCheck, Sparkles, Wallet, MessageSquare, Cpu, Link2 } from 'lucide-react';
import AgentIllustration from './AgentIllustration';

const MODES = [
  { name: 'Always Ask', tagline: 'Every payment needs your OK, right then.', icon: ShieldCheck },
  { name: 'Autonomous', tagline: 'The agent can act on its own, inside limits you set.', icon: Sparkles },
];

const STEPS = [
  { icon: Wallet, title: 'Connect', body: 'Set up a passkey wallet with Face ID or a fingerprint — no seed phrase to write down.' },
  { icon: MessageSquare, title: 'Describe what you want', body: 'Tell the agent the job, or just hit "Hire" — it already knows what it does.' },
  { icon: Cpu, title: 'The agent prepares the action', body: 'It works out the exact steps and the real price before anything gets signed.' },
  { icon: ShieldCheck, title: 'Always Ask reviews it, or Autonomous acts within your limits', body: 'Always Ask puts it in front of you to approve. Autonomous lets it go ahead on its own — but only inside the spend cap and expiry you already set.' },
  { icon: Link2, title: 'Settles on-chain', body: 'Payment sits in escrow and only reaches the agent once the work is confirmed — never before.' },
];

export default function SessionModesExplainer() {
  return (
    <div className="bg-white dark:bg-[#1E293B] rounded-3xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
      <div className="px-6 sm:px-8 py-5 bg-gray-50/50 dark:bg-gray-800/30 border-b border-gray-200 dark:border-gray-800">
        <h3 className="font-bold text-lg">Always Ask, or Autonomous — how paying an agent actually works</h3>
      </div>

      <div className="p-6 sm:p-8 flex flex-col md:flex-row gap-8">
        <div className="md:w-56 shrink-0 flex flex-col items-center text-center">
          <AgentIllustration className="w-28 h-28 sm:w-36 sm:h-36" />

          <div className="mt-5 w-full space-y-2">
            {MODES.map((m) => (
              <div key={m.name} className="flex items-start gap-2 text-left p-3 rounded-xl bg-indigo-50 dark:bg-indigo-500/10">
                <m.icon size={15} className="text-indigo-500 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-bold">{m.name}</div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug">{m.tagline}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <ol className="flex-1 space-y-5">
          {STEPS.map((s, i) => (
            <li key={i} className="flex gap-4">
              <div className="w-8 h-8 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</div>
              <div>
                <div className="font-bold text-sm mb-1 flex items-center gap-1.5"><s.icon size={14} className="text-indigo-500" /> {s.title}</div>
                <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
