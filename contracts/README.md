# AgentAccessMarket — "Sell Your Agent" contract

On-chain settlement for creators selling **access** to an ERC-8004 agent **they own**.
Two pricing models live on-chain here; a third settles off-contract.

| Model | Where | How |
|-------|-------|-----|
| 1. One-time license | this contract | `buyOneTime` → permanent access |
| 2. Time subscription | this contract | `subscribe` → access until an expiry, renewable |
| 3. Pay-per-call (x402) | off-contract | the creator's endpoint becomes an x402 paid resource; settles straight to their wallet |

Access is a **non-transferable entitlement** recorded as `accessExpiry[agentId][buyer]`
(a `uint64` timestamp; `type(uint64).max` = permanent). The ERC-8004 identity token is
**never moved**, so the agent keeps its on-chain identity. We use a plain mapping rather
than an ERC-1155 license token on purpose: access should not be resold or transferred out
of the creator's control, and a mapping answers the only question asked ("does this buyer
have access, until when?") more cheaply and is non-transferable by construction.

## Multi-token (fixed whitelist, no swap)
Payments settle in one of a **fixed, owner-controlled whitelist** of tokens — **native BNB**
(the `NATIVE` sentinel, paid via `msg.value`), plus whitelisted ERC-20s (**real USDT** and
**$U**). There is **no swap logic**, so we take on zero slippage/MEV risk. A creator can price
the *same* agent in several tokens (one `Offer` per `(agentId, token)`), and the **buyer picks**
which token to pay with via `buyOneTime(agentId, token)` / `subscribe(agentId, token)`. The
whitelist is set at deploy from a constructor `address[]` and tunable via `setAcceptedToken`
(owner-only, go-forward). Payouts and fee accrual are tracked per token.

## Security
- **OpenZeppelin**: `Ownable2Step` (single admin, fat-finger-safe transfer), `ReentrancyGuard`
  (every token-moving fn), `SafeERC20` (non-standard tokens).
- **Pull-over-push**: creators and the platform *withdraw* balances; purchases never push
  tokens onward in the same tx. Balances are zeroed before transfer (checks-effects-interactions).
- **Fee**: `feeBps` set by owner, hard-capped at `MAX_FEE_BPS` (10%), applied to **future**
  purchases only. `feeWallet` comes from the `PLATFORM_FEE_WALLET` env var at deploy — never
  hardcoded. No admin function can move a buyer's or creator's already-settled funds.
- **Scope**: `list()` requires `agentRegistry.ownerOf(agentId) == msg.sender`, so only an
  agent's genuine ERC-8004 owner can monetize it.
- Payment split is computed on the **actually-received** amount (balance-delta), so a
  fee-on-transfer token can't desync the books.

## Test & deploy
Requires Foundry. Dependencies are git-ignored; reinstall:
```
forge install OpenZeppelin/openzeppelin-contracts@v5.1.0
forge install foundry-rs/forge-std
```
Run the fork tests (real BSC state — real USDT + real ERC-8004 registry):
```
forge test --fork-url https://bsc-dataseed.binance.org -vv
```
Real deploy + real purchase on a local Anvil fork (Foundry's own test tooling, unrelated to any product feature):
```
BSC_RPC=https://bsc-dataseed.binance.org bash script/fork_demo.sh
```
Deploy (fee wallet + accepted ERC-20s from env; native BNB added automatically):
```
PLATFORM_FEE_WALLET=0x.. ACCEPTED_ERC20S=<USDT>,<liveU> \
  forge script script/Deploy.s.sol --rpc-url <url> --account <cast-wallet> --broadcast
```
`$U` should be read live from the Altana SDK by the deploy wrapper, not hardcoded.

## Status
Verified on the Anvil fork of live BSC — **12 passing tests** (a full purchase + fee-split per
token: USDT, $U, native BNB; buyer-choice among multiple offers; whitelist enforcement; native
value guards) + a scripted multi-token deploy/purchase (correct 2.5% split). **Not deployed to
mainnet.** Before mainnet: an independent audit, and set the frontend's
`VITE_AGENT_MARKET_ADDRESS` to the deployed address.
