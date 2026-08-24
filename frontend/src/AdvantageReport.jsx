// AdvantageReport.jsx
//
// The real TermiX Advantage Report: 3 real tasks, each run both with and
// without an agent, real time/cost/quality. Shared verbatim by web and
// mobile. Built 2026-08-19 from real, captured test data — not live-fetched
// (these are fixed, one-time real runs, same as this project's other
// "verified this session" findings), so the numbers below are exactly what
// was actually measured, with honest gaps left as TODOs rather than filled
// with placeholder-looking fake data.
//
// Real, deliberate scoping: this replaced nothing — it's new content added
// above the existing real Practice-Layer stats (general testing activity
// across all users), which is a genuinely different, still-real, still-
// useful report that stays as its own section below.

import React from 'react';
import { CheckCircle2, Clock, AlertTriangle, ExternalLink, ShieldAlert, Coins, GraduationCap } from 'lucide-react';

const ACCENT = '#4F46E5';

function TaskCard({ icon: Icon, title, statusLabel, statusColor, children }) {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden bg-white dark:bg-[#1E293B]">
      <div className="px-6 py-4 bg-gray-50/50 dark:bg-gray-800/30 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Icon size={16} style={{ color: ACCENT }} />
          <h3 className="font-bold text-sm">{title}</h3>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full" style={{ background: `${statusColor}22`, color: statusColor }}>{statusLabel}</span>
      </div>
      <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">{children}</div>
    </div>
  );
}

function Side({ label, children }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-2">{label}</div>
      <div className="space-y-1.5 text-sm text-gray-700 dark:text-gray-300">{children}</div>
    </div>
  );
}

const Row = ({ label, value, hint }) => (
  <div className="flex justify-between gap-3 text-xs">
    <span className="text-gray-500" title={hint}>{label}</span>
    <span className="font-mono font-semibold text-right">{value}</span>
  </div>
);

export default function AdvantageReport() {
  return (
    <div className="space-y-6">
      <div className="p-4 rounded-xl border border-indigo-100 dark:border-indigo-500/20 bg-indigo-50/60 dark:bg-indigo-500/5 text-xs text-indigo-700 dark:text-indigo-300 leading-relaxed">
        3 tasks, each run with an agent and by hand. Items still pending are marked as such, not estimated.
      </div>

      {/* Task 1 — COMPLETE */}
      <TaskCard icon={ShieldAlert} title="Task 1 — Security/trading risk check" statusLabel="Complete" statusColor="#10B981">
        <Side label="With an agent (Practice Mode's Token Radar skill)">
          <Row label="Target" value="犇犇/WBNB" />
          <Row label="Time taken" value="0.216s" />
          <Row label="Cost" value="$0 (just looked something up)" />
          <Row label="Result" value="Flagged: trading volume 98× its available liquidity" />
          <a href="https://dexscreener.com/bsc/0x103f0e8cac08d41afe09a4445587054f80f05fec" target="_blank" rel="noreferrer" className="text-[11px] text-indigo-500 hover:underline inline-flex items-center gap-1 mt-1">View this token <ExternalLink size={10} /></a>
        </Side>
        <Side label="Without an agent (done by hand, timed)">
          <Row label="Time taken" value="2m 00s" />
          <Row label="Cost" value="$0 (manual)" />
          <p className="text-[11px] text-gray-400 leading-relaxed">Manual steps: check the same token on DexScreener — liquidity, age, and volume-vs-liquidity, by hand.</p>
        </Side>
      </TaskCard>

      {/* Task 2 — BLOCKED, honestly */}
      <TaskCard icon={Coins} title="Task 2 — DeFi execution (Venus Lending supply)" statusLabel="Blocked" statusColor="#F59E0B">
        <Side label="With an agent (Practice Mode's Venus skill)">
          <div className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5 mb-1"><AlertTriangle size={12} /> Blocked — intermittent outside data provider</div>
          <p className="text-[11px] text-gray-400 leading-relaxed">Has succeeded twice but not reliably enough yet to record final numbers.</p>
        </Side>
        <Side label="Without an agent">
          <div className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5"><Clock size={12} /> Timing pending</div>
          <p className="text-[11px] text-gray-400 leading-relaxed">Manual steps: supply USDT to Venus directly via app.venus.io (connect wallet → approve → supply → confirm).</p>
        </Side>
      </TaskCard>

      {/* Task 3 — COMPLETE, real mainnet delivery captured 2026-08-19 */}
      <TaskCard icon={GraduationCap} title="Task 3 — Knowledge/content (ERC-8004/8183 explainer agent)" statusLabel="Complete" statusColor="#10B981">
        <Side label="With an agent (self-hosted, on the real network)">
          <Row label="Build time" value="~50s (scaffold → AI)" />
          <Row label="Price quoted" value="0.1 $U" hint="$U is a type of digital dollar — 1 $U is worth about $1." />
          <Row label="Delivery time" value="~60s (notified → delivered)" />
          <Row label="Job number" value="#56620" />
          <p className="text-[11px] text-gray-400 leading-relaxed mt-1">
            Paid job on BSC mainnet — not a test network. The delivered content's fingerprint matches the on-chain record.
          </p>
          <a href="https://bscscan.com/tx/0xe82346efb104b80afaaff9ba4584c2bcf26ad2d3888e01cf03128459f6d16de7" target="_blank" rel="noreferrer" className="text-[11px] text-indigo-500 hover:underline inline-flex items-center gap-1 mt-1">View the delivery record <ExternalLink size={10} /></a>
          <div className="mt-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-800 text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed max-h-40 overflow-y-auto">
            "ERC-8004 is the agent's official ID card&nbsp;&mdash; like a driver's license: anyone can look it up and confirm who's really behind it before trusting it. ERC-8183 is job escrow&nbsp;&mdash; like buying a house through a title company: payment sits in a neutral locked box until the work is delivered, so neither side can get cheated. Together: ERC-8004 tells you *who* you're hiring, ERC-8183 makes sure the *payment* is safe while they work."
          </div>
          <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed mt-1.5 flex items-start gap-1"><AlertTriangle size={11} className="shrink-0 mt-0.5" /> Shown above is an excerpt — the full output also includes draft notes ahead of the final write-up.</p>
          <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed mt-1.5 flex items-start gap-1"><AlertTriangle size={11} className="shrink-0 mt-0.5" /> The full raw file is no longer available (lost in a hosting update). The on-chain delivery record above is unaffected.</p>
        </Side>
        <Side label="Without an agent (done by hand, timed)">
          <Row label="Time taken" value="3m 40s" />
          <Row label="Cost" value="$0 (manual)" />
          <p className="text-[11px] text-gray-400 leading-relaxed">Manual steps: write the same beginner explanation from scratch, timed start to finish.</p>
          <div className="mt-2 p-3 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-800 text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed max-h-40 overflow-y-auto">
            "ERC-8004 is a standard on Ethereum-compatible chains (like BNB Smart Chain) that gives each AI agent a permanent, on-chain identity, like a passport that anyone can look up. ERC-8183 is a separate standard that handles hiring and paying that agent. You create a job, lock a fixed budget for it, and the agent only gets paid once it delivers. If it never delivers, you get your money back automatically. For example: you could hire an agent to monitor liquidity across several PancakeSwap pools and pick the best one (the agent's AI does that analysis). You lock a budget for the job, the agent does the work, and once it delivers a result, the payment is released to it."
          </div>
          <p className="text-[11px] text-gray-400 leading-relaxed mt-1.5">One factual correction made afterward; the 3m 40s timing is unchanged.</p>
        </Side>
      </TaskCard>
    </div>
  );
}
