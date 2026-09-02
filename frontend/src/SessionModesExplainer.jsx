// SessionModesExplainer.jsx
//
// A numbered step-by-step walkthrough of "how paying an agent actually
// works", paired with an original illustration, replacing an old single
// dense paragraph.
//
// Simplified 2026-09-03: this used to explain two hire modes side by side
// (Always Ask, direct wagmi signing; Autonomous, an Altana spend-cap
// session). Autonomous was removed from the product — a full scan of the
// complete ERC-8183 job index found zero jobs of any status ever
// completed through that path, in this project's entire real history (see
// docs/limitations.md). This now describes the one real, working path.
//
// One shared, responsive component for both web and mobile (same pattern
// as StepChecklist/GetULink) — no separate mobile rewrite needed, since
// this is normal flex/grid layout, not a fixed-coordinate diagram; it
// naturally stacks under `md:` on a narrow screen and the mobile app's
// viewport never reaches that breakpoint anyway.
import React from 'react';
import { Wallet, MessageSquare, Cpu, ShieldCheck, Link2 } from 'lucide-react';
import AgentIllustration from './AgentIllustration';

const STEPS = [
  { icon: Wallet, title: 'Connect', body: 'Connect your own wallet, or set up a passkey wallet with Face ID or a fingerprint — no seed phrase to write down.' },
  { icon: MessageSquare, title: 'Describe what you want', body: 'Tell the agent the job, or just hit "Hire" — it already knows what it does.' },
  { icon: Cpu, title: 'The agent prepares the action', body: 'It works out the exact steps and the real price before anything gets signed.' },
  { icon: ShieldCheck, title: 'You approve it', body: "Every step is shown to you first, and you sign it yourself, in your own wallet." },
  { icon: Link2, title: 'Settles on-chain', body: 'Payment sits in escrow and only reaches the agent once the work is confirmed — never before.' },
];

export default function SessionModesExplainer() {
  return (
    <div className="bg-white dark:bg-[#1E293B] rounded-3xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
      <div className="px-6 sm:px-8 py-5 bg-gray-50/50 dark:bg-gray-800/30 border-b border-gray-200 dark:border-gray-800">
        <h3 className="font-bold text-lg">How paying an agent actually works</h3>
      </div>

      <div className="p-6 sm:p-8 flex flex-col md:flex-row gap-8">
        <div className="md:w-56 shrink-0 flex flex-col items-center text-center">
          <AgentIllustration className="w-28 h-28 sm:w-36 sm:h-36" />
          <div className="mt-5 w-full p-3 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 text-left flex items-start gap-2">
            <ShieldCheck size={15} className="text-indigo-500 shrink-0 mt-0.5" />
            <div>
              <div className="text-xs font-bold">Always Ask</div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug">Every payment needs your OK, right then.</div>
            </div>
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
