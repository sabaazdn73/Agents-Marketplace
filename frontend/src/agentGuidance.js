// agentGuidance.js
//
// Real, honest decision-aid data for the agent detail page's "no hire
// history yet" state — built 2026-08-19. Every signal here is data the app
// already has (8004scan fields already fetched, the real Altana Skills
// already built); nothing new is fabricated or fetched.
//
// The category -> skill mapping below is a genuine editorial judgment call,
// not a technical/data link — there's no real connection in the data
// between an agent's keyword-classified category (categorize.py) and our
// own pre-built Skills catalog (they're different systems).
// It's an honest "agents in this category typically do the kind of thing
// this skill also does, so trying the skill gives you a feel for the real
// mechanics" — phrased that way in the UI, never as a claim about what this
// SPECIFIC agent does internally, which we genuinely don't know.
//
// Kept conservative on purpose: only mapped where the conceptual link is
// direct and defensible (Copy Trading -> copy-trade is an exact match;
// Smart Contract Auditing, Gaming, NFT & Generative Art, etc. get no
// stretched analogy, just honestly no match).
export const CATEGORY_TO_SKILLS = {
  'Health Factor Monitoring': [
    { skillId: 'venus-lending', label: 'Venus Lending' },
    { skillId: 'aave-v3-lending', label: 'Aave V3 Lending' },
  ],
  'Yield Optimisation': [
    { skillId: 'venus-lending', label: 'Venus Lending' },
    { skillId: 'aave-v3-lending', label: 'Aave V3 Lending' },
    { skillId: 'lista-staking', label: 'Lista Staking' },
  ],
  'Rebalancing': [
    { skillId: 'pancakeswap-liquidity', label: 'PancakeSwap Liquidity' },
  ],
  'Grid Trading': [
    { skillId: 'pancakeswap-trading', label: 'PancakeSwap Trading' },
  ],
  'Trading Signals': [
    { skillId: 'pancakeswap-trading', label: 'PancakeSwap Trading' },
  ],
  'Copy Trading': [
    { skillId: 'copy-trade', label: 'Copy Trade' },
  ],
  'Payments & Settlement': [
    { skillId: 'x402-api-payments', label: 'x402 API Payments' },
  ],
  'Data Analysis': [
    { skillId: 'dexscreener-token-radar', label: 'Token Radar' },
  ],
  'Research': [
    { skillId: 'dexscreener-token-radar', label: 'Token Radar' },
  ],
};

/** Real signals-in-plain-language for one agent, from data already on the
 * mapped agent object — no new fetch. Each entry is either genuinely true
 * (verified, has a score, has stars) or omitted; never a fabricated "0" or
 * a negative-sounding phrasing for an honestly-neutral absence. */
export function realSignals(agent) {
  const out = [];
  if (agent.totalScore != null) out.push({ label: 'Trust score', value: agent.totalScore.toFixed(1) });
  if (agent.starCount != null && agent.starCount > 0) out.push({ label: 'Stars from other users', value: String(agent.starCount) });
  if (agent.totalFeedbacks != null && agent.totalFeedbacks > 0) out.push({ label: 'On-chain feedback entries', value: String(agent.totalFeedbacks) });
  return out;
}
