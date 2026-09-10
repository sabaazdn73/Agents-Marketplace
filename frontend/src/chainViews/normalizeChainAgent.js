// normalizeChainAgent.js
//
// Maps a chain-view agent (snake_case, straight out of full_agent_registry)
// onto the shape the marketplace card components expect (camelCase, the shape
// the BSC aggregate produces).
//
// This exists so a hireable chain can use the SAME card as BNB Chain rather
// than a second, thinner design that drifts. The two data paths genuinely
// differ in casing, and one adapter in one place is better than every
// component learning both spellings.
//
// The important part is what it deliberately does NOT map.
//
// Every field below is stored identically on every chain, verified across
// 400-agent samples on 56, 42161 and 4663: star_count, total_score,
// total_feedbacks, average_score, image_url and category are all present with
// the same meaning everywhere, and none is computed by a BSC-specific method.
// Carrying them across is reporting stored registry data.
//
// The BSC card also shows a verification tier, an ERC-8183 hire record and a
// DefiLlama funds figure. Those are NOT mapped, because:
//
//   verification tier   The tiers are built on ERC-8183 evidence: a paid job
//                       delivered, or a canary job this marketplace funded.
//                       Neither can exist off BNB Chain, so a tier would be
//                       an assertion about evidence that cannot be gathered.
//   hire record         hireCount and winRate come from the ERC-8183 job
//                       index, which is BNB Chain only.
//   funds               tvlUsd comes from the DefiLlama enrichment that runs
//                       over known_agents, the BSC serving collection. The
//                       signal is available on these chains, but the per-agent
//                       value has not been computed, so the card shows the
//                       same neutral dash BSC shows for an agent without one.
//
// The card renders those slots as absent-with-a-reason rather than blank, so
// a thinner card reads as honest rather than broken.

/** Chain-view agent -> marketplace card shape. */
export function normalizeChainAgent(a) {
  if (!a) return a;
  return {
    ...a,
    id: a.id,
    name: a.name,
    category: a.category,
    // The card's description slot. BSC calls this `strategy`, which is what
    // its own aggregate names the field.
    strategy: a.description,
    imageUrl: a.image_url || null,
    ownerAddress: a.owner_address || null,
    chainId: a.chain_id,
    network: a.chain_name,
    tokenId: a.token_id,
    totalScore: typeof a.total_score === 'number' ? a.total_score : null,
    starCount: typeof a.star_count === 'number' ? a.star_count : null,
    totalFeedbacks: typeof a.total_feedbacks === 'number' ? a.total_feedbacks : null,
    averageScore: typeof a.average_score === 'number' ? a.average_score : null,
    // Health is only carried when the backend marked this agent's chain as
    // genuinely analysed. An unanalysed agent has no health fields at all,
    // so there is nothing here to render even by accident.
    serviceStatus: a.status_verified ? a.service_status : null,
    serviceCheckedAt: a.status_verified ? a.service_checked_at : null,
    x402Supported: !!a.x402_supported,
  };
}

export function normalizeChainAgents(list = []) {
  return list.map(normalizeChainAgent);
}
