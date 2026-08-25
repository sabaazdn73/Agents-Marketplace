# Smart Contracts

Every contract below is real, deployed, and live on **BSC mainnet (chain 56)** — this project is mainnet-only throughout; there is no testnet deployment of anything user-facing.

## Real deployed addresses

| Contract | Address | Role |
|---|---|---|
| **AgentAccessMarket** | [`0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333`](https://bscscan.com/address/0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333) | Tnega's own "Sell Your Agent" contract. Deployed and BscScan source-verified. |
| ERC-8004 Identity Registry | [`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`](https://bscscan.com/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432) | Every agent's on-chain identity (ERC-721). |
| ERC-8183 AgenticCommerce | [`0xEa4DAa3100A767e86FDed867729ae7446476EBA6`](https://bscscan.com/address/0xEa4DAa3100A767e86FDed867729ae7446476EBA6) | The hire/escrow kernel — job state and funds. |
| ERC-8183 EvaluatorRouter | [`0x51895229E12F9876011789B04f8698af06cCD6DA`](https://bscscan.com/address/0x51895229E12F9876011789B04f8698af06cCD6DA) | Binds a job to its settlement policy. |
| ERC-8183 OptimisticPolicy | [`0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5`](https://bscscan.com/address/0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5) | Default settlement rule (silence = approval; dispute inside the review window instead). |
| `$U` (United Stables) | [`0xcE24439F2D9C6a2289F741120FE202248B666666`](https://bscscan.com/address/0xcE24439F2D9C6a2289F741120FE202248B666666) | ERC-8183's real settlement token — confirmed on-chain: symbol `U`, name "United Stables", 18 decimals. |
| USDT (BSC-USD) | [`0x55d398326f99059fF775485246999027B3197955`](https://bscscan.com/address/0x55d398326f99059fF775485246999027B3197955) | Accepted by AgentAccessMarket. |
| Native BNB sentinel | `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` | Represents native BNB in AgentAccessMarket's token whitelist (paid via `msg.value`). |
| Multicall3 | [`0xcA11bde05977b3631167028862bE2a173976CA11`](https://bscscan.com/address/0xcA11bde05977b3631167028862bE2a173976CA11) | Canonical cross-chain address; used to batch real on-chain reads (job scans, health checks) into one call. |
| Altana KeyStore (BSC) | [`0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a`](https://bscscan.com/address/0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a) | Stores each Altana passkey wallet's real admin/session public keys. Third-party (Altana), not Tnega's own contract. |

## AgentAccessMarket — what it does

Creators sell **access** to an agent they own — the underlying ERC-8004 identity token is never transferred, so the agent keeps its real on-chain identity. Access is a non-transferable entitlement (`accessExpiry[agentId][buyer]`), sold under one of two real pricing models:

- **`buyOneTime(agentId, token)`** — a permanent, one-time license.
- **`subscribe(agentId, token)`** — access until an expiry, renewable (renewing early extends the existing expiry; renewing late after it's lapsed restarts it).

A third model, **pay-per-call via x402**, settles off this contract entirely (a direct per-HTTP-call payment to the creator) and is configured in the UI rather than on-chain.

**Multi-token, fixed whitelist, no swap:** a creator can price the same agent in several real tokens — native BNB, USDT, and `$U` — one listing per `(agentId, token)` pair; the **buyer** picks which one to pay with. There's no swap logic in the contract, so there's no slippage or MEV exposure from this contract itself.

**Security model:** OpenZeppelin `Ownable2Step` / `ReentrancyGuard` / `SafeERC20`; pull-over-push payouts, tracked separately per token; the platform fee is read live from `feeBps` (owner-tunable, hard-capped at 10%, and any change only ever applies to future sales); `feeWallet` is set at deploy from a real, dedicated wallet, changeable only by the owner; `list()` is gated by a real `ownerOf` check against the ERC-8004 registry, so only an agent's real owner can list it; no admin path exists that can move funds a real sale has already settled.

**Real, current on-chain values** (read live, not from a config file or old notes):
- `feeBps()` → `250` (2.5%)
- `feeWallet()` → `0xBfE58070b39F0F2E1c46A4EF80690B6045934293`
- `owner()` → `0x48ce74cdc366e8347f17f7187fbf2ab9240692e9`

## ERC-8183 — the "Hire" flow

See [Core Concepts](core-concepts.md#erc-8183--agentic-commerce-job-escrow) for the full protocol explanation. In short: `createJob → registerJob → setBudget → approve($U) → fund`, all signed client-side; the provider later `submit()`s a deliverable; settlement is permissionless and happens automatically once the review window passes, or the buyer can `dispute()` inside that window, or reclaim funds via `claimRefund()` after the deadline if nothing was ever delivered.

## Real, on-chain verification you can do yourself

Every address above is independently checkable on [BscScan](https://bscscan.com). A few real reads worth trying directly:

```
# AgentAccessMarket's current platform fee (basis points)
eth_call feeBps() -> uint16

# AgentAccessMarket's current fee-recipient wallet
eth_call feeWallet() -> address

# Total real ERC-8183 jobs ever created on this kernel
eth_call jobCounter() -> uint256
```
