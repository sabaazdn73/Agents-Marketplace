# Deploying AgentBudgetEscrow to Arbitrum and Robinhood Chain

Companion to `budget-escrow-golive.md`, which covers the BSC deployment.
The contract source is unchanged, so the compiled bytecode is byte-identical
to the one already deployed on BSC: creation 8,380 bytes, runtime 7,396,
solc `0.8.24+commit.e11b9ed9`, optimizer on at 200 runs.

You run both deploys yourself. Nothing here needs a private key to be shared,
and no command below contains one.

## What differs per chain

The contract does not change. Three inputs do.

| | Arbitrum One | Robinhood Chain |
|---|---|---|
| Chain id | 42161 | 4663 |
| Gas token | ETH | ETH |
| RPC | `https://arb1.arbitrum.io/rpc` | `https://rpc.mainnet.chain.robinhood.com` |
| Accepted ERC-20s | USDC, USD₮0 | USDG |
| Explorer verification | Etherscan V2 | Sourcify (see below) |
| Owner | `0x48cE74cdC366E8347f17F7187FBf2Ab9240692E9` | same |
| Fee wallet | same as owner | same |
| `FEE_BPS` | 250, the default | 250, the default |

The owner is the same address on both chains and on BSC, so all three
contracts have one owner, which is what you asked for.

### Why these tokens

Each address below was read on its own chain rather than copied from a token
list. `symbol()` and `decimals()` were called live on the chain in question:

| Chain | Token | Address | Decimals |
|---|---|---|---|
| 42161 | USDC (Circle native) | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | 6 |
| 42161 | USD₮0 (Tether) | `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9` | 6 |
| 4663 | USDG (Paxos Global Dollar) | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | 6 |

Native ETH is added automatically by the deploy script as `tokens[0]`, using
the `0xEeee…EEeE` sentinel. You do not list it in `ACCEPTED_ERC20S`.

WETH is deliberately excluded on both chains. A budget denominated in WETH
would be a budget denominated in the gas token wrapped, which gives a client
two ways to express the same thing and an agent two balances to reason about,
for no gain. Native ETH is already accepted.

## Cost, and what to fund

Measured, not estimated: the deployment gas is a real `estimateGas` against
each chain's own RPC for the exact calldata below.

| Chain | Gas | Gas price when measured | Cost |
|---|---|---|---|
| Arbitrum | 1,835,096 | 0.0200 gwei | 0.0000367 ETH, about $0.09 |
| Robinhood | 1,830,703 | 0.1286 gwei | 0.0002354 ETH, about $0.58 |

Fund roughly double the figure above on each chain. Gas price moves between
reading it and running the command, and being short mid-deploy is far more
annoying than overfunding by a dollar. Re-check the balance right before you
run:

```bash
cast balance 0x48cE74cdC366E8347f17F7187FBf2Ab9240692E9 --rpc-url https://arb1.arbitrum.io/rpc
cast balance 0x48cE74cdC366E8347f17F7187FBf2Ab9240692E9 --rpc-url https://rpc.mainnet.chain.robinhood.com
```

## Deploy

Run from `contracts/`. `--account` is your local `cast wallet` keystore name,
the same one used for the BSC deploy.

Deploy and verify are separated deliberately. `--verify` on the deploy makes a
failed verification look like a failed deployment, and on Robinhood Chain
verification needs a different route anyway (below). Deploy first, confirm the
address, then verify.

### Arbitrum

```bash
PLATFORM_FEE_WALLET=0x48cE74cdC366E8347f17F7187FBf2Ab9240692E9 \
ACCEPTED_ERC20S=0xaf88d065e77c8cC2239327C5EDb3A432268e5831,0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9 \
forge script script/DeployBudgetEscrow.s.sol \
  --rpc-url https://arb1.arbitrum.io/rpc \
  --account <your-cast-wallet> \
  --broadcast
```

### Robinhood Chain

```bash
PLATFORM_FEE_WALLET=0x48cE74cdC366E8347f17F7187FBf2Ab9240692E9 \
ACCEPTED_ERC20S=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 \
forge script script/DeployBudgetEscrow.s.sol \
  --rpc-url https://rpc.mainnet.chain.robinhood.com \
  --account <your-cast-wallet> \
  --broadcast
```

Each prints `AgentBudgetEscrow deployed at: 0x…`. Keep both addresses; the
verify commands need them, and they differ per chain.

## Verify

Constructor arguments are pre-encoded below, so you do not have to rebuild
them. They already include the native sentinel in position 0 and encode
`feeBps = 250` (`0xfa`).

### Arbitrum, via Etherscan V2

Arbiscan is served by the unified Etherscan V2 API. One Etherscan key covers
every chain it supports, including 42161. Confirmed reachable:
`api.etherscan.io/v2/api?chainid=42161` answers, returning
`Missing/Invalid API Key` without one, which is the endpoint responding rather
than a wrong URL.

**You need an `ETHERSCAN_API_KEY`.** There is no key in `backend/.env` or
`contracts/.env`, so this is a prerequisite, not a step. A free key from
etherscan.io works.

```bash
forge verify-contract <DEPLOYED_ADDRESS> \
  src/AgentBudgetEscrow.sol:AgentBudgetEscrow \
  --chain 42161 \
  --verifier etherscan \
  --etherscan-api-key "$ETHERSCAN_API_KEY" \
  --compiler-version 0.8.24 \
  --num-of-optimizations 200 \
  --constructor-args 0x000000000000000000000000000000000000000000000000000000000000006000000000000000000000000048ce74cdc366e8347f17f7187fbf2ab9240692e900000000000000000000000000000000000000000000000000000000000000fa0000000000000000000000000000000000000000000000000000000000000003000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee000000000000000000000000af88d065e77c8cc2239327c5edb3a432268e5831000000000000000000000000fd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9 \
  --watch
```

If your Foundry build defaults to the V1 endpoint, add
`--verifier-url https://api.etherscan.io/v2/api` explicitly. Foundry 1.7.1
targets V2 on its own.

### Robinhood Chain, via Sourcify

Robinhood Chain's Blockscout instance cannot be used for automated
verification from here. `robinhoodchain.blockscout.com/api` returns HTTP 403
with a Cloudflare interstitial rather than an API response. That is
bot protection on the explorer, and getting around it is not something to
automate. `forge verify-contract --verifier blockscout` posts to that same
API and would hit the same wall.

Sourcify is the route instead, and it is a real one rather than a
consolation: Sourcify lists chain 4663 as supported, its server answers for
that chain, and Blockscout displays Sourcify-verified sources natively, so a
judge opening the contract on the explorer sees verified source.

```bash
forge verify-contract <DEPLOYED_ADDRESS> \
  src/AgentBudgetEscrow.sol:AgentBudgetEscrow \
  --chain 4663 \
  --verifier sourcify \
  --verifier-url https://sourcify.dev/server \
  --compiler-version 0.8.24 \
  --num-of-optimizations 200 \
  --watch
```

Sourcify matches on the compiler metadata hash embedded in the deployed
bytecode, so it does not need `--constructor-args`. This exact flag set was
checked locally with `--show-standard-json-input`: it parses and resolves the
contract for chain 4663.

Sourcify also supports 42161, so the same command with `--chain 42161` is a
no-API-key fallback for Arbitrum if you would rather not create an Etherscan
key. Verifying on both Etherscan and Sourcify is fine and is the better
outcome for Arbitrum, since Arbiscan is where a judge will look first.

Confirm afterwards:

```bash
curl -s https://sourcify.dev/server/v2/contract/4663/<DEPLOYED_ADDRESS>
curl -s https://sourcify.dev/server/v2/contract/42161/<DEPLOYED_ADDRESS>
```

A verified contract returns `"match":"match"` with a `verifiedAt` timestamp.

## After deploying: the one-cent checklist

The same real-money smoke test the BSC deployment went through, run per
chain, with a budget small enough that a mistake costs a cent. Do it on each
chain separately, because a contract that works on one proves nothing about
the other.

1. Open a budget with a tiny native amount.
2. Draw a fraction of it as the payee, and confirm the fee lands in the fee
   wallet and the remainder with the payee.
3. Revoke, and confirm the unspent remainder returns to the client.
4. `pause()`, then confirm `draw` reverts and `reclaim` still succeeds.

Step 4 is the one that matters most and is the reason `reclaim` deliberately
carries no `whenNotPaused` modifier: pausing must never be able to trap a
client's funds. Unpause afterwards.
