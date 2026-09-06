# AgentBudgetEscrow — mainnet go-live

Straight to BSC mainnet, testnet deliberately skipped. This page is the
smoke test that carries the risk that skipping it would otherwise leave.

**Do the whole checklist before any real money goes in.** The whole point is
to find a problem on a one-cent budget rather than a real one.

---

## Before you deploy

Set these, and read them back before pressing enter — a wrong `feeWallet` or
a wrong `feeBps` is baked in at construction and cannot be fixed by
redeploying the frontend:

```bash
export PLATFORM_FEE_WALLET=0x...      # where platform fees are withdrawn to
export ACCEPTED_ERC20S=0x55d398326f99059fF775485246999027B3197955   # USDT on BSC
export FEE_BPS=250                    # 2.5% — optional, this is the default
export BSCSCAN_API_KEY=...            # for --verify
```

Native BNB is added automatically as the `NATIVE` sentinel — do **not** put it
in `ACCEPTED_ERC20S`.

## Deploy

```bash
cd contracts
forge script script/DeployBudgetEscrow.s.sol \
  --rpc-url https://bsc-dataseed.binance.org \
  --account <your-cast-wallet> \
  --broadcast --verify \
  --etherscan-api-key $BSCSCAN_API_KEY --chain 56
```

Record the deployed address. Everything below uses `$ESC`.

```bash
export ESC=0x...
export RPC=https://bsc-dataseed.binance.org
```

---

## 1. Verify the constructor actually took what you meant

Cheapest possible check, and it catches the worst class of error — wrong fee
recipient, wrong fee, a token you did not intend to accept. All read-only.

```bash
cast call $ESC "owner()(address)"            --rpc-url $RPC
cast call $ESC "feeWallet()(address)"        --rpc-url $RPC
cast call $ESC "feeBps()(uint16)"            --rpc-url $RPC   # expect 250
cast call $ESC "paused()(bool)"              --rpc-url $RPC   # expect false
cast call $ESC "budgetCounter()(uint256)"    --rpc-url $RPC   # expect 0

# NATIVE accepted, your USDT accepted, something random NOT accepted
cast call $ESC "acceptedTokens(address)(bool)" 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE --rpc-url $RPC  # true
cast call $ESC "acceptedTokens(address)(bool)" 0x55d398326f99059fF775485246999027B3197955 --rpc-url $RPC  # true
cast call $ESC "acceptedTokens(address)(bool)" 0x000000000000000000000000000000000000dEaD --rpc-url $RPC  # MUST be false
```

**Stop if any line disagrees.** A wrong value here means redeploy, not patch.

## 2. The one-cent flow: open → draw → revoke

Use native BNB (no approve step) and an amount you would not mind losing
entirely. `0.0002 BNB` is roughly a cent and is plenty.

You need a second address to act as the agent. **It cannot be the same
address as the client** — the contract rejects that on purpose.

```bash
export AGENT=0x...                       # second wallet you control
export DEADLINE=$(( $(date +%s) + 86400 ))   # 24h from now
```

**Open** — 0.0002 BNB, max 0.0001 per draw, no cooldown:

```bash
cast send $ESC \
  "openBudget(address,address,uint256,uint256,uint64,uint64)" \
  $AGENT 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE \
  200000000000000 100000000000000 $DEADLINE 0 \
  --value 200000000000000 \
  --account <client-wallet> --rpc-url $RPC
```

Then confirm the stored budget is what you asked for:

```bash
cast call $ESC "getBudget(uint256)" 1 --rpc-url $RPC
cast call $ESC "drawableNow(uint256)(uint256)" 1 --rpc-url $RPC   # expect 100000000000000
```

`drawableNow` should be the **per-draw max**, not the total — that proves
`maxPerDraw` is actually being enforced rather than stored and ignored.

**Draw** as the agent:

```bash
cast send $ESC "draw(uint256,uint256,bytes32)" \
  1 100000000000000 $(cast format-bytes32-string smoke) \
  --account <agent-wallet> --rpc-url $RPC
```

Check three things:
- the agent's BNB went **up by the draw minus 2.5%** (fee), not the full amount
- `getBudget(1)` shows `spent = 100000000000000`
- a `Drawn` event was emitted — this is the one the live spend view depends on:

```bash
cast logs --address $ESC "Drawn(uint256,address,uint256,uint256,uint256,uint256,bytes32)" \
  --from-block latest --rpc-url $RPC
```

**Try to exceed the per-draw cap — this MUST fail:**

```bash
cast send $ESC "draw(uint256,uint256,bytes32)" 1 100000000000001 $(cast format-bytes32-string over) \
  --account <agent-wallet> --rpc-url $RPC
# expect revert ExceedsMaxPerDraw
```

**Try to draw from the client's address — this MUST fail:**

```bash
cast send $ESC "draw(uint256,uint256,bytes32)" 1 1 $(cast format-bytes32-string nope) \
  --account <client-wallet> --rpc-url $RPC
# expect revert NotAgent
```

**Revoke** as the client, while the budget is still open and not expired:

```bash
cast send $ESC "reclaim(uint256)" 1 --account <client-wallet> --rpc-url $RPC
```

- the client should get back **exactly the undrawn remainder** (0.0001 BNB)
- the `BudgetReclaimed` event should carry `early = true` — that is the flag
  distinguishing a mid-job revoke from a deadline expiry
- a further `draw` must now fail with `NotOpen`

## 3. Prove the pause is one-directional

This is the safety net that replaces the testnet round, so verify it works
rather than trusting it.

```bash
cast send $ESC "pause()" --account <owner-wallet> --rpc-url $RPC
cast call $ESC "paused()(bool)" --rpc-url $RPC   # true
```

While paused:
- `openBudget` must **fail**
- `draw` must **fail**
- **`reclaim` must still SUCCEED** — open a second tiny budget before pausing
  and confirm the client can still exit. If this does not work, unpause
  immediately and do not use the contract.

```bash
cast send $ESC "unpause()" --account <owner-wallet> --rpc-url $RPC
```

## 4. Only then, point anything real at it

- Put the address in the frontend config.
- Start with a low `maxPerDraw` and a short `deadline` on the first real
  budget. Both can be set generously later; neither can be changed on a
  budget that already exists.

---

## If something is wrong after real money is in

1. `pause()` — stops new budgets and new draws immediately. It can **never**
   block a client from reclaiming, so pausing is always safe to do first and
   reason about second.
2. Tell clients to `reclaim()`. That path is not gated by the pause and
   returns their entire unspent remainder.
3. Fix, redeploy, repoint the frontend. The contract is deliberately not
   upgradeable, so there is no proxy to patch — a new deployment is the
   intended path and existing budgets stay fully exitable on the old one.

## What skipping testnet actually costs

Being explicit, since it was a deliberate decision:

- **Covered already.** Contract logic — 33 tests including reentrancy on
  draw (malicious token AND malicious native agent), reentrancy on reclaim,
  fee-on-transfer, cap overflow, per-draw ceiling, cooldown, deadline
  boundaries, and a solvency fuzz. These run against a real BSC mainnet
  fork, which is closer to mainnet than testnet is.
- **Covered by the checklist above.** Deployment mechanics, constructor
  arguments, verification, real wallet signing, real gas, event emission.
- **Genuinely not covered by either.** An unknown bug in a path no test
  imagined. This is why `pause()` exists and why the first budget should be
  worth a cent.
