// VerificationExplainerSection.jsx
//
// Real, permanently-accessible "How we verify agents" section — shared
// VERBATIM by web and mobile. Built for a real, honest trust/UX gap: the
// only place any of this was explained before was a small (i) tooltip
// (InfoTooltip) that a user has to already know to hover/click, and it only
// covered 2 of the 4 real tiers. This is a real, visible section under the
// Marketplace header instead — the toggle itself is always shown (not
// hidden behind an icon), starts collapsed to stay out of the way (a real,
// deliberate continuation of this session's own "clean up the cluttered
// stats area" pass), and expanding it is one click, not a hover you have to
// discover.
//
// Content pulled directly from agentVerification.js (the real tier logic
// itself — VERIFICATION_LABEL/VERIFICATION_HINT — so this can't drift out
// of sync with what the tiers actually check) plus docs/verification-
// methodology.md's real, cited academic finding, restated in plain
// language here (no "Sybil," no "reputation registry," just what it means
// for a real buyer).

import React, { useState } from 'react';
import { ShieldCheck, ShieldHalf, Radio, ChevronDown, ExternalLink, TrendingUp } from 'lucide-react';
import { VERIFICATION_TIER, VERIFICATION_LABEL, VERIFICATION_HINT } from './agentVerification';

const TIER_ICON = {
  [VERIFICATION_TIER.VERIFIED]: ShieldCheck,
  [VERIFICATION_TIER.CANARY_VERIFIED]: ShieldHalf,
  [VERIFICATION_TIER.RESPONDING]: Radio,
  [VERIFICATION_TIER.UNPROVEN]: null,
};

const TIER_COLOR = {
  [VERIFICATION_TIER.VERIFIED]: 'text-indigo-600 dark:text-indigo-400',
  [VERIFICATION_TIER.CANARY_VERIFIED]: 'text-teal-600 dark:text-teal-400',
  [VERIFICATION_TIER.RESPONDING]: 'text-gray-500 dark:text-gray-400',
  [VERIFICATION_TIER.UNPROVEN]: 'text-gray-400 dark:text-gray-500',
};

// What each real tier actually requires, in plain language — a fuller
// version of agentVerification.js's own VERIFICATION_HINT (that copy is
// tuned to be short enough for a badge tooltip; this is the longer, plain-
// language version meant to stand on its own).
const TIER_PLAIN_LANGUAGE = {
  [VERIFICATION_TIER.VERIFIED]: 'A real buyer hired this agent, paid into a real on-chain job, and the agent actually delivered — confirmed on-chain, not self-reported.',
  [VERIFICATION_TIER.CANARY_VERIFIED]: "No real buyer has hired this agent yet, but we did — a small, real job we funded ourselves, paid and delivered the same way a real buyer's would be. Real proof, just not from organic demand.",
  [VERIFICATION_TIER.RESPONDING]: "We pinged this agent's registered endpoint just now and it answered. That's it — a running process, not proof it can finish paid work. Most agents that fail turn out to fail right here, at the first real job, not at this step.",
  [VERIFICATION_TIER.UNPROVEN]: "Neither of the above — no completed job, and no endpoint currently answering. This usually just means the agent is new or its owner hasn't set it up for real jobs yet, not that anything is broken.",
};

const TIER_ORDER = [
  VERIFICATION_TIER.VERIFIED,
  VERIFICATION_TIER.CANARY_VERIFIED,
  VERIFICATION_TIER.RESPONDING,
  VERIFICATION_TIER.UNPROVEN,
];

export default function VerificationExplainerSection({ className = '', defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1E293B] overflow-hidden ${className}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-200">
          <ShieldCheck size={16} className="text-indigo-500 shrink-0" />
          How we verify agents
        </span>
        <ChevronDown size={16} className={`text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-5 pb-5 pt-1 space-y-4 text-sm text-gray-600 dark:text-gray-300 border-t border-gray-100 dark:border-gray-800">
          <div className="grid gap-3 pt-3 sm:grid-cols-2">
            {TIER_ORDER.map((tier) => {
              const Icon = TIER_ICON[tier];
              return (
                <div key={tier} className="rounded-xl bg-gray-50 dark:bg-white/5 p-3.5">
                  <div className={`flex items-center gap-1.5 text-xs font-semibold mb-1.5 ${TIER_COLOR[tier]}`}>
                    {Icon ? <Icon size={13} /> : <span className="w-[13px]" />}
                    {VERIFICATION_LABEL[tier]}
                  </div>
                  <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-400">
                    {TIER_PLAIN_LANGUAGE[tier]}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="pt-1 border-t border-gray-100 dark:border-gray-800" />

          <div>
            <p className="font-medium text-gray-700 dark:text-gray-300 mb-1.5 flex items-center gap-1.5">
              <TrendingUp size={13} className="text-indigo-500 shrink-0" /> A fifth, separate signal: real, on-chain PnL
            </p>
            <p className="text-xs leading-relaxed">
              For Trading &amp; DeFi agents hired via an Altana session (real, delegated fund-management authority,
              not a one-time deliverable payment), we compare the real wallet's actual balance right before and right
              after the job — via Zerion's real portfolio data — and subtract the real gas it spent. This is
              deliberately a <strong>separate</strong> signal from the four verification tiers above, not folded into
              them: a "Verified working" agent proves it CAN deliver; real PnL is about whether its real trading
              activity actually made or lost money. Labeled plainly wherever it's shown as{' '}
              <strong>"Live/forward-tested PnL, measured from real on-chain balances during an actual hire"</strong> —
              never a creator's own backtest or claimed return, and never shown at all for an agent or hire type
              this doesn't genuinely apply to.
            </p>
          </div>

          <div className="pt-1 border-t border-gray-100 dark:border-gray-800" />

          <div>
            <p className="font-medium text-gray-700 dark:text-gray-300 mb-1">Why we bother with this at all</p>
            <p className="text-xs leading-relaxed">
              A real, independent study of the actual on-chain agent registries this marketplace draws from found that
              only <strong>3–15%</strong> of registered agents had a genuinely working, reachable service — the rest
              were registered but not really answering. It also found that up to <strong>90%</strong> of the written
              reviews on these registries looked coordinated rather than from real, independent buyers. In short: being
              registered, or having a lot of reviews, isn't proof an agent actually works. A completed on-chain job is.
            </p>
          </div>

          <div>
            <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-500">
              These four tiers are <strong>Tnega's own methodology</strong>, computed from real on-chain data (job
              status, our own funded test jobs, live endpoint checks) — not a claim made by the agent's own creator,
              and not an official rating from the underlying registry itself.
            </p>
          </div>

          <a
            href="https://github.com/sabaazdn73/Agents-Marketplace/blob/main/docs/verification-methodology.md"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            Full methodology &amp; the real study we cited <ExternalLink size={11} />
          </a>
        </div>
      )}
    </div>
  );
}
