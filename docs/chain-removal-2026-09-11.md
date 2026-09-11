# Narrowing to six chains, 2026-09-11

The marketplace showed five named chain tabs plus a grouped Multi-Chain tab
holding four more. It now shows six named tabs and nothing else. Two chains
were deleted from the store, one is retained but hidden, and one was promoted
out of the group and given its own tab.

## What changed

| Chain | Before | After |
|---|---|---|
| BNB Chain (56) | tab | tab, unchanged |
| Ethereum (1) | tab | tab, unchanged |
| Solana (101) | tab, coming soon | tab, coming soon, unchanged |
| Arbitrum (42161) | tab | tab, unchanged |
| Robinhood Chain (4663) | tab | tab, unchanged |
| Monad (143) | inside Multi-Chain, browse only | its own tab, analysed |
| Base (8453) | inside Multi-Chain | retained in the store, no tab |
| Celo (42220) | inside Multi-Chain | deleted, 9,681 documents |
| Billions Network (45056) | inside Multi-Chain | deleted, 25,966 documents |

The Multi-Chain view was removed. With Celo and Billions deleted, Monad
promoted and Base hidden, it held nothing.

## The deletion

35,647 documents, 38.5 MB of metered storage.

Measured rather than projected: Mongo went from 474.8 MB used and 37.2 MB
free (92.7% of the 512 MB free-tier cap) to **440.8 MB used and 71.2 MB free
(86.1%)**. The projection had said 75.7 MB free; the 4.5 MB difference is
index pages that do not return to the free pool on delete.

Neither chain had a single row in `known_agents`, so the BNB Chain serving
path was never touched. The metric is `dataSize + indexSize`, not
`storageSize`; using the wrong one caused a write outage here before.

## Base is retained but not surfaced, and why

Base is not deleted. Its 60,644 agents are the largest non-BNB catalogue in
the store, and 8004scan access is now limited, so re-ingesting it later would
be difficult or impossible. Deleting it would be a one-way door.

It keeps both of its pipelines:

- **Ingest**: 8453 stays in `TARGET_CHAIN_IDS` in `full_registry_ingest.py`
- **Analysis**: 8453 stays in `ANALYSIS_CHAIN_IDS` in
  `full_registry_analysis.py`

That is deliberate. A retained catalogue that stops being analysed goes
stale, and the entire point of keeping it is that it stays usable if it is
ever surfaced again.

It appears in no view: no tab of its own, not inside another tab, and not
counted in any user-facing total.

### A chain in the store and in no view is a new state

Nothing in this codebase had held that combination before, so every count a
visitor can see was checked rather than assumed. The result is that no
user-facing number derives from "all stored chains":

- `count_view` filters on the view's own `chain_ids`
- `category_facets` filters on the view's own `chain_ids`
- `fetch_page`'s `total` filters on the view's own query
- the marketplace header stats (Agents Listed, On-chain Feedback, Verified
  Agents) come from the BNB Chain serving store, not the registry
- the Ecosystem page reads `/api/agents`, which is the BNB Chain serving
  store
- no view total is summed anywhere in the frontend, and no user-facing copy
  hardcodes a cross-chain total

The one place that does count the whole store is
`compute_full_registry_stats`, which serves the pipeline status endpoint.
That is an operations view of what is ingested, where Base belongs and where
excluding it would be the bug.

So a chain absent from `VIEWS` is absent from every visitor-facing total,
automatically, with no second list to keep in sync.
`RETAINED_HIDDEN_CHAIN_IDS` in `core/chain_views.py` records the state
explicitly so it is discoverable rather than implied by an absence.

## Monad, verified before promotion

Monad was browse-only and outside the analysis scope. Promoting it meant
giving it what every analysed chain has, and the same three checks every
chain before it had to pass, run against Monad rather than assumed from the
pattern:

| Check | Result |
|---|---|
| `eth_chainId` | 143 |
| ERC-8004 registry at `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | 130 bytes, identical to every other chain carrying it |
| `tokenURI` on stored agents | resolved 10 of 10, returning real metadata hosts (`api.monadmogs.xyz`, `dashboard.dev.fun`, `agent-arcade-steel.vercel.app`) |
| Failover | `monad.drpc.org` returns chain id 143 and the same 130-byte registry. Ankr and Alchemy's demo endpoint do not answer |

So 143 joined `ANALYSIS_CHAIN_IDS`. Its 10,168 agents carry no
`service_status` yet because the pass has not reached them; the re-queue
logic picks up agents with no status, so they fill in over the following
cycles.

Monad is **not** in the deletion scope. `DELETE_CHAIN_IDS` remains `[56]`.

## The sixteen places a chain is named

This is the list that matters next time. A chain removed from the store but
still named elsewhere is worse than not removing it, and these are the
places that had to change.

**Backend, nine:**

1. `core/chain_views.py`, `CHAIN_NAMES` (display names)
2. `core/chain_views.py`, `VIEWS` (the tab list and each view's `chain_ids`)
3. `core/full_registry_ingest.py`, `ADDITIONAL_CHAINS` (per-chain ingest
   scans, which would otherwise re-ingest the rows just deleted)
4. `core/full_registry_analysis.py`, `ANALYSIS_CHAIN_IDS`
5. `core/rpc.py`, the primary RPC map
6. `core/rpc.py`, `_CHAIN_PUBLIC_BACKUP` (failovers)
7. `core/chain_capabilities.py`, five separate structures:
   `_EVM_EXPLORER_SUPPORTED`, `NATIVE_RPC_CHAINS`, the Zerion slug map,
   `_QUALITY_CHAINS`, `_BINANCE_TIERS`, and the display-name map
8. `core/agent_evaluation.py`, the native-token symbol map
9. `server.py`, the pipeline-status docstrings quoting per-chain counts

**Frontend, four:**

10. `chainViews/ChainViewTabs.jsx`, the view-to-component map and
    `SHORT_LABELS`
11. `chainViews/ChainViewShared.jsx`, `EXPLORER_BASE`
12. `chainViews/chainMarks.jsx`, `LOGOS`, `FALLBACK_COLOR` and the cluster
    logo list
13. the view component itself (`MultiChainView.jsx` deleted,
    `MonadView.jsx` added)

**Docs and copy, three:**

14. `docs/architecture.md` and `docs/limitations.md`, which list the chains
    by name
15. `docs/full-registry-analysis.md`, per-chain ingest counts
16. user-facing copy that names chains: `frontend/index.html` meta
    descriptions, `PAGE_META` in `frontend/src/App.jsx`, and the hero
    subtitle in `frontend/src/LandingPage.jsx`

## Restoring any of this

The deleted data came from 8004scan, whose access is now limited: the
list endpoint ignores `chainId` filters, offsets past 10,000 return HTTP 422
permanently, and deep pages time out. Re-ingesting Celo or Billions Network
from the original source should not be assumed possible.

If either is ever wanted again, the routes are the ERC-8004 registry
directly (the same `0x8004A169…` address, read over that chain's own RPC) or
Trust8004 at trust8004.xyz, which indexes 31 chains and has a free catalogue
tier. Both are slower than the original ingest and neither reproduces
8004scan's scores, categories or image URLs.

This is the reason Base was kept rather than deleted alongside them.
