// chainContracts.js
//
// The single source of truth for which contract lives at which address on
// which chain. Every address lookup in the app must come from here, keyed by
// chain id. Nothing may hold a bare address constant and use it on whatever
// chain the wallet happens to be on.
//
// ─────────────────────────────────────────────────────────────────────────
// READ THIS BEFORE ADDING AN ADDRESS
//
// 0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333 is TWO DIFFERENT CONTRACTS,
// across FOUR chains:
//
//   chain 56    (BNB)        -> AgentAccessMarket   ("Sell Your Agent")
//   chain 1     (Ethereum)   -> AgentBudgetEscrow
//   chain 42161 (Arbitrum)   -> AgentBudgetEscrow
//   chain 4663  (Robinhood)  -> AgentBudgetEscrow
//
// That is not a mistake, and it is not a guarantee either. It is a
// coincidence of CREATE address derivation: the same deployer wallet at the
// same nonce produces the same address on every EVM chain. AgentAccessMarket
// happened to be that wallet's nonce-N deploy on BSC, and AgentBudgetEscrow
// happened to be its nonce-N deploy on the three other chains.
//
// The coincidence getting wider is the reason to be MORE careful, not less.
// Three escrows now share an address with one market, so an address that
// "looks right" is right three times out of four, which is exactly the ratio
// that trains someone to stop checking.
//
// Why this is dangerous rather than merely untidy: both contracts implement
// owner(), feeBps() and MAX_FEE_BPS(). Verified on chain 2026-09-10 — all
// three answer on all three chains, with owner and 250/1000 identical. So a
// defensive "does this address look like our contract?" probe PASSES while
// pointing at the wrong contract, and the mistake only surfaces when a write
// reverts or, worse, silently does something else.
//
// The rule that follows: resolve by chain id, always. Never reuse an address
// across chains because it looks familiar, and never assume a contract
// deployed on one chain exists at the same address on another.
// ─────────────────────────────────────────────────────────────────────────

/**
 * AgentBudgetEscrow, per chain. Budget hiring is available exactly where this
 * has an entry — the map IS the feature flag, so deploying to a new chain and
 * adding a line here is the whole enablement step.
 *
 * BSC        deployed 2026-08 (see docs/budget-escrow-golive.md)
 * Ethereum   deployed 2026-09-11, Etherscan-verified
 * Arbitrum   deployed 2026-09-10, Arbiscan-verified
 * Robinhood  deployed 2026-09-10, Sourcify-verified (exact_match)
 *
 * Ethereum's entry was checked on chain before being added, not assumed from
 * the address matching: 7,396 bytes of code (identical in length to Arbitrum
 * and Robinhood, against BSC's 6,478), feeWallet the project wallet, feeBps
 * 250, MAX_FEE_BPS 1000, and acceptedTokens true for mainnet USDC and USDT.
 * BSC at the same address answers with a different feeWallet, which is the
 * collision described above behaving exactly as warned.
 */
const BUDGET_ESCROW_BY_CHAIN = {
  56: '0x4728f03693DDABbe50E79c7BfFCb930e522D585B',
  1: '0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333',
  42161: '0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333',
  4663: '0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333',
};

/**
 * AgentAccessMarket, per chain. BSC only — it has not been deployed
 * elsewhere. Deliberately NOT given the 42161/4663 entries that share its
 * BSC address, because on those chains that address is the budget escrow.
 */
const AGENT_MARKET_BY_CHAIN = {
  56: '0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333',
};

/**
 * Chains where ERC-8183 escrow hiring works. This is not ours to extend:
 * the AgenticCommerce contract is Altana's and exists on BNB Chain (56) and
 * BNB testnet (97). 97 is absent on purpose — no testnet value may be
 * reachable from a production path.
 */
const ESCROW_HIRE_CHAINS = [56];

/** Display metadata, so the UI can name a chain without its own table. */
export const CHAIN_META = {
  56: { name: 'BNB Chain', nativeSymbol: 'BNB', explorer: 'https://bscscan.com' },
  42161: { name: 'Arbitrum', nativeSymbol: 'ETH', explorer: 'https://arbiscan.io' },
  4663: { name: 'Robinhood Chain', nativeSymbol: 'ETH', explorer: 'https://robinhoodchain.blockscout.com' },
};

const isAddress = (a) => /^0x[a-fA-F0-9]{40}$/.test(a || '');

/**
 * Per-chain env override, e.g. VITE_BUDGET_ESCROW_ADDRESS_42161, for pointing
 * a chain at a fork while testing. Deliberately per chain: the old single
 * VITE_BUDGET_ESCROW_ADDRESS would have overridden every chain at once, which
 * is the same "one address everywhere" assumption this module exists to stop.
 */
function envOverride(prefix, chainId) {
  const v = import.meta.env?.[`${prefix}_${chainId}`];
  return isAddress(v) ? v : null;
}

/** AgentBudgetEscrow address for `chainId`, or '' if not deployed there. */
export function getBudgetEscrowAddress(chainId) {
  if (!chainId) return '';
  return envOverride('VITE_BUDGET_ESCROW_ADDRESS', chainId)
    || BUDGET_ESCROW_BY_CHAIN[chainId] || '';
}

/** AgentAccessMarket address for `chainId`, or '' if not deployed there. */
export function getAgentMarketAddress(chainId) {
  if (!chainId) return '';
  return envOverride('VITE_AGENT_MARKET_ADDRESS', chainId)
    || AGENT_MARKET_BY_CHAIN[chainId] || '';
}

/** Can a budget be opened on this chain? */
export function isBudgetHiringAvailable(chainId) {
  return isAddress(getBudgetEscrowAddress(chainId));
}

/** Can an ERC-8183 escrow hire be settled on this chain? */
export function isEscrowHiringAvailable(chainId) {
  return ESCROW_HIRE_CHAINS.includes(Number(chainId));
}

/** Chain ids where budget hiring works, for "switch to…" affordances. */
export function budgetHiringChainIds() {
  return Object.keys(BUDGET_ESCROW_BY_CHAIN).map(Number);
}

/** Chain ids where escrow hiring works. */
export function escrowHiringChainIds() {
  return [...ESCROW_HIRE_CHAINS];
}

export function chainName(chainId) {
  return CHAIN_META[chainId]?.name || `chain ${chainId}`;
}

export function nativeSymbol(chainId) {
  return CHAIN_META[chainId]?.nativeSymbol || 'ETH';
}

/**
 * What an agent on `chainId` can actually be hired through, and what it
 * cannot. Returned as data rather than rendered text so web and mobile show
 * the same facts. `reason` is written to be shown to a user verbatim.
 */
export function hiringOptionsFor(chainId) {
  const budget = isBudgetHiringAvailable(chainId);
  const escrow = isEscrowHiringAvailable(chainId);
  return {
    chainId,
    chainName: chainName(chainId),
    budget: {
      available: budget,
      address: getBudgetEscrowAddress(chainId),
      reason: budget
        ? `Budget hiring is available on ${chainName(chainId)}.`
        : `AgentBudgetEscrow is not deployed on ${chainName(chainId)}, so a budget cannot be opened here.`,
    },
    escrow: {
      available: escrow,
      reason: escrow
        ? 'Escrow hiring settles through the ERC-8183 AgenticCommerce contract.'
        : 'Escrow hiring uses the ERC-8183 AgenticCommerce contract, which is deployed on BNB Chain only. It is not ours to deploy elsewhere.',
    },
    anyAvailable: budget || escrow,
  };
}
