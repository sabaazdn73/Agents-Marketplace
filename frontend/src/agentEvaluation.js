// agentEvaluation.js
//
// Real, category-aware evaluation framework — the single, shared source of
// truth both web and mobile read from. See docs/category-evaluation.md for
// the full real investigation this was built from: live protocol probes
// and population census across every category group, not assumptions.
//
// Real, load-bearing finding from that investigation: the right axis is
// NOT category. Every real category group contains both escrow-compatible
// and SaaS/off-chain-incompatible real agents — there's no clean category
// boundary. What actually determines how an agent should be evaluated and
// what its primary call-to-action should be is the already-built, PER-
// AGENT escrow-compatibility signal (core/protocol_compat.py). Category
// group matters for exactly one real, evidence-backed thing: which
// FUND-PERFORMANCE enrichment panels (PnL, Historical On-chain
// Performance, canary testing) are a coherent question at all — real
// investigation found that's true only for Trading & DeFi; every other
// group's hypothesis (e.g. "Security & Trust is naturally a continuous-
// monitoring category") wasn't supported by its own real, current agents
// and so no bespoke method was invented for it.

import { groupForCategory } from './categoryGroups';

export const NATIVE_METHOD = {
  ESCROW_DELIVERY: 'escrow-delivery',
  SAAS_REACHABILITY: 'saas-reachability',
};

export const PRIMARY_CTA = {
  HIRE: 'hire',
  VISIT_WEBSITE: 'visit_website',
};

// Real, evidence-backed scope — see docs/category-evaluation.md's own
// per-group findings before assuming any other group belongs here.
const FUND_PERFORMANCE_GROUP = 'trading-defi';

/**
 * The real, main entry point. `escrowIncompatible` should come from the
 * real, live `useEscrowCompatibility` probe result — pass `null`/
 * `undefined` while it's still loading or unknown, which conservatively
 * defaults to the escrow-delivery lens (never assumes an agent is
 * incompatible without the real, strong protocol signal — matches
 * core/protocol_compat.py's own conservative default).
 */
export function evaluateAgent({ escrowIncompatible, category }) {
  const incompatible = !!escrowIncompatible;
  const group = groupForCategory(category);
  return {
    group,
    nativeMethod: incompatible ? NATIVE_METHOD.SAAS_REACHABILITY : NATIVE_METHOD.ESCROW_DELIVERY,
    primaryCta: incompatible ? PRIMARY_CTA.VISIT_WEBSITE : PRIMARY_CTA.HIRE,
    // Real, evidence-based (see docs/category-evaluation.md) — only
    // Trading & DeFi showed a genuine real need for these panels. Doesn't
    // depend on escrowIncompatible: core/onchain_pnl.py's own "Historical
    // on-chain performance" signal is deliberately independent of whether
    // an agent can be hired through Tnega's escrow at all.
    showFundPerformancePanels: group === FUND_PERFORMANCE_GROUP,
  };
}
