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
  [VERIFICATION_TIER.VERIFIED]: 'A buyer hired this agent, paid into an on-chain job, and the agent delivered. Confirmed on-chain rather than self-reported.',
  [VERIFICATION_TIER.CANARY_VERIFIED]: "Nobody has hired this agent yet, so we did: a small job we funded ourselves, paid and delivered exactly as a customer's would be. It proves delivery works. The demand was ours, not the market's.",
  [VERIFICATION_TIER.RESPONDING]: "We pinged this agent's registered endpoint just now and it answered. That shows a running process. It doesn't show the agent can finish paid work, and most agents that fail do so at the first paid job rather than here.",
  [VERIFICATION_TIER.UNPROVEN]: "Neither of the above: no completed job, and no endpoint answering right now. Usually the agent is new or its owner hasn't finished setting it up. It doesn't mean anything is broken.",
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
              <TrendingUp size={13} className="text-indigo-500 shrink-0" /> A fifth, separate signal: on-chain PnL
            </p>
            <p className="text-xs leading-relaxed">
              For Trading &amp; DeFi agents, once a hire is delivered, we compare the funding wallet before and right
              after the job using Zerion's portfolio data, then subtract the gas it spent. This works for whichever
              hire path was used. We keep it <strong>separate</strong> from the four verification tiers above on
              purpose. A "Verified working" agent has shown it can deliver; PnL says whether its trading made or lost
              money. Wherever it appears it's labelled{' '}
              <strong>"Live/forward-tested PnL, measured from on-chain balances during a hire"</strong>. We never show
              a creator's own backtest or claimed return, and we don't show PnL for agents or hire types it doesn't
              apply to.
            </p>
          </div>

          <div className="pt-1 border-t border-gray-100 dark:border-gray-800" />

          <div>
            <p className="font-medium text-gray-700 dark:text-gray-300 mb-1">Why we bother with this at all</p>
            <p className="text-xs leading-relaxed">
              An independent study of the on-chain agent registries this marketplace draws from found that only
              <strong> 3–15%</strong> of registered agents had a working, reachable service. The rest were registered
              but not answering. It also found that up to <strong>90%</strong> of written reviews on these registries
              looked coordinated rather than left by independent buyers. Being registered, or having plenty of
              reviews, doesn't show an agent works. A completed on-chain job does.
            </p>
          </div>

          <div>
            <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-500">
              These four tiers are <strong>Tnega's own methodology</strong>, computed from on-chain data: job status,
              test jobs we funded ourselves, and live endpoint checks. They aren't a claim from the agent's creator or
              an official rating from the underlying registry.
            </p>
          </div>

          <a
            href="https://github.com/sabaazdn73/Agents-Marketplace/blob/main/docs/verification-methodology.md"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            Full methodology and the study we cited <ExternalLink size={11} />
          </a>
        </div>
      )}
    </div>
  );
}
