# Deploying AgentBudgetEscrow to Ethereum

Everything downstream of the deploy is already written and inert. The view
switches itself on, so the deploy is the only manual step and then two lines
turn it on.

## Before you run it

| Check | Value at time of writing |
|---|---|
| Wallet | `0x48cE74cdC366E8347f17F7187FBf2Ab9240692E9` |
| Balance | 0.000468 ETH, being topped up to 0.01 |
| Nonce on mainnet | **0**, this wallet has never transacted on Ethereum |
| Base fee | 0.0635 gwei, block 25,956,888 |
| Deploy gas, measured | **1,805,989** via `eth_estimateGas` against mainnet, identical on two RPCs |

Cost at 0.0635 gwei is about 0.000115 ETH. At 1 gwei it is 0.0018 ETH, and at
20 gwei it is 0.036 ETH. With 0.01 ETH funded you are covered up to roughly
5 gwei, which is ample headroom against the current 0.06.

The nonce being 0 matters: this is the wallet's first ever mainnet broadcast,
so a config problem shows up on the only attempt that counts. Run the dry run
first.

## Constructor arguments

```
constructor(address[] tokens_, address feeWallet_, uint16 feeBps_)
```

`tokens_` is the list of ERC-20s a budget may be denominated in. On Ethereum
the obvious pair is USDC and USDT, which is what the gas estimate above was
priced with. `feeBps_` is 250 on the existing deployments, and
`MAX_FEE_BPS` is 1000.

Mainnet token addresses:

```
USDC  0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
USDT  0xdAC17F958D2ee523a2206206994597C13D831ec7
```

## Dry run first, against a fork

This costs nothing and catches the whole class of problems that would
otherwise surface on your only funded attempt.

```bash
cd contracts

# 1. Fork mainnet locally and deploy against it.
anvil --fork-url https://ethereum-rpc.publicnode.com --port 8545 &

forge create src/AgentBudgetEscrow.sol:AgentBudgetEscrow \
  --rpc-url http://127.0.0.1:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --broadcast \
  --constructor-args \
    "[0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48,0xdAC17F958D2ee523a2206206994597C13D831ec7]" \
    0x48cE74cdC366E8347f17F7187FBf2Ab9240692E9 \
    250
```

The private key above is Anvil's first well-known test account. It is public,
it holds nothing on any real network, and it must never appear in a command
that names a mainnet RPC.

Verify the constructor actually took, rather than trusting that it deployed:

```bash
A=<address forge printed>
R=http://127.0.0.1:8545

cast call $A 'feeWallet()(address)' --rpc-url $R      # your fee wallet
cast call $A 'feeBps()(uint16)'     --rpc-url $R      # 250
cast call $A 'MAX_FEE_BPS()(uint16)' --rpc-url $R     # 1000
cast call $A 'acceptedTokens(address)(bool)' 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 --rpc-url $R
cast call $A 'acceptedTokens(address)(bool)' 0xdAC17F958D2ee523a2206206994597C13D831ec7 --rpc-url $R
```

The token allowlist getter is `acceptedTokens`, not `allowedToken`. Both USDC
and USDT must answer `true` and an unrelated address must answer `false`; if
the allowlist is empty the deploy succeeded and the contract is useless.

Run on a fork of block 25,957,151 this deploy used **1,790,611 gas**, against
the 1,805,989 that `eth_estimateGas` predicted. Both tokens returned `true`,
`feeBps` was 250 and `MAX_FEE_BPS` 1000.

Note that `owner()` is the deploying wallet, not the fee wallet. On the fork
that is Anvil's test account; on mainnet it will be whichever key you unlock
with `--interactive`.

Stop the fork when the checks pass.

## The real deploy

```bash
cd contracts

forge create src/AgentBudgetEscrow.sol:AgentBudgetEscrow \
  --rpc-url https://ethereum-rpc.publicnode.com \
  --interactive \
  --broadcast \
  --constructor-args \
    "[0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48,0xdAC17F958D2ee523a2206206994597C13D831ec7]" \
    0x48cE74cdC366E8347f17F7187FBf2Ab9240692E9 \
    250 \
  --verify \
  --etherscan-api-key "$ETHERSCAN_API_KEY"
```

`--broadcast` is required. Forge 1.7.1 only simulates without it: it prints the
contract ABI, exits 0, and deploys nothing. Confirmed on the fork, where the
first run without it produced no contract and no transaction hash. That failure
is harmless but silent, so check the output names a "Deployed to" address.

`--interactive` prompts for the key rather than taking it on the command line,
so it never enters shell history. Do not substitute `--private-key` here.

`--verify` publishes the source to Etherscan in the same run, which is what
Arbitrum and Robinhood both have and what the view's capabilities panel
reports.

## Turning the view on, two lines

The Ethereum view already renders the hireable theme the moment budget hiring
resolves for chain 1. It reads `BUDGET_ESCROW_BY_CHAIN`, so that map is the
feature flag and nothing in the view needs editing.

**1. `frontend/src/chainContracts.js`**

```js
const BUDGET_ESCROW_BY_CHAIN = {
  56: '0x4728f03693DDABbe50E79c7BfFCb930e522D585B',
  1: '0xYOUR_DEPLOYED_ADDRESS',        // <- add this
  42161: '0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333',
  4663: '0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333',
};
```

**2. `backend/core/chain_views.py`**

```python
BUDGET_HIRE_CHAIN_IDS = (56, 1, 42161, 4663)
```

Those two must stay in step. The frontend resolves the address, the backend is
what the API promises, and they describe the same deployment.

Do not assume the Ethereum address matches the Arbitrum one. It will only
match if this wallet's nonce happens to line up, and `chainContracts.js`
already documents why reusing an address across chains is the dangerous kind
of mistake: both AgentAccessMarket and AgentBudgetEscrow answer `owner()`,
`feeBps()` and `MAX_FEE_BPS()`, so a defensive probe passes while pointing at
the wrong contract.

## What the view does before and after

Before, and right now: the read-only listing, with a population note stating
that 812 of 30,779 Ethereum agents answer and 29,725 publish no service
endpoint at all. That note stays either way, because it is true either way.

After: the same hireable theme Arbitrum and Robinhood use. The BNB Chain card
with an action on it, category chips with counts, and numbered pages instead
of "load more".

## Being accurate about what is there

Live counts from `full_agent_registry`:

| Status | Agents | Share |
|---|---|---|
| `unknown`, no endpoint published | 24,869 | 80.80% |
| `no_endpoint` | 4,856 | 15.78% |
| `responding` | 812 | 2.64% |
| `not_responding` | 242 | 0.79% |

Deploying the escrow makes 812 agents hireable, not 30,779. The `unknown`
group is not a backlog that a re-run will clear: `service_status` is set to
`unknown` when the check cannot be performed, and all 24,869 of them have no
`service_endpoint` to check. 13,511 are still named `Agent #NNNN`, meaning
their metadata was never resolved at all. Moving them needs tokenURI
resolution, not another health-check pass.
