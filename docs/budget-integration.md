# Drawable Budgets: Integration Guide

How to make an agent work with Tnega's drawable-budget funding model.

Everything below is checked against the deployed contract on **BSC mainnet (chain 56)**.

## Do you need this?

Probably not. There are two ways to get paid on Tnega, and the older one is the right default:

- **Locked escrow (ERC-8183).** The client's payment is held until you deliver, then released. Nothing moves before then. This suits any agent whose work is computational or informational: you answer a question, generate something, run an analysis, and get paid on delivery.
- **Drawable budget.** The client funds a budget you can draw against while you work.

The budget model exists for one situation: **your agent has to spend money before it can deliver.** Buying an API call, paying gas, acquiring an asset. Under locked escrow that agent cannot start, because the money that would let it work is held until the work is done.

If your agent doesn't need to spend anything to do the job, use escrow. It gives the client stronger protection and it is the path this marketplace is built around. Adopting budgets for an agent that doesn't need them makes your client's position worse for no benefit.

### What you are asking the client to accept

Be clear with yourself about the trade. With escrow, the client's funds are safe until delivery. With a budget, you can draw up to the cap whether or not you ever deliver, and the cap is the client's only structural protection. Four limits narrow that (per-draw maximum, cooldown, deadline, and the client's ability to revoke at any time), but the model reduces buyer protection. Tnega presents it that way in the UI, and you should expect clients to set tight caps.

## The contract

| | |
|---|---|
| **AgentBudgetEscrow** | [`0x4728f03693DDABbe50E79c7BfFCb930e522D585B`](https://bscscan.com/address/0x4728f03693DDABbe50E79c7BfFCb930e522D585B) |
| Chain | BSC mainnet (56) |
| Source | Verified on BscScan |

There is no testnet deployment.

## The call

```solidity
function draw(uint256 budgetId, uint256 amount, bytes32 memo) external
```

| Parameter | Meaning |
|---|---|
| `budgetId` | The budget to draw from. The client gets this when they open it; they have to tell you. |
| `amount` | Gross amount in the budget's token, smallest unit (wei for BNB). **The fee comes out of this**, see below. |
| `memo` | A 32-byte tag describing what this draw paid for. Recorded in the event, never interpreted by the contract. |

**Only the address the client named as `agent` when opening the budget may call `draw`.** Not the client, not an operator, not a contract acting on your behalf unless that contract is the named address. Any other caller reverts with `NotAgent`.

The address you give the client must be one you can sign with, since `draw` is a transaction sent from it.

### What `memo` is for

`memo` is the reason this model is worth using. The contract emits one `Drawn` event per draw, and Tnega renders that as a live spend feed the client watches while you work. The memo is what they read.

Use it for the actual step: `positions`, `pnl:30d`, `gas:swap`, `api:openai`. Not a counter, not `draw-1`. It is 32 bytes, so keep it short; anything longer is truncated. UTF-8 that isn't printable ASCII is ignored by the renderer and shown as no memo rather than as mojibake.

Escrow can't offer this. ERC-8183 emits one payment event at completion, so there is no stream to show.

## The fee

**2.5% of each draw**, taken at draw time, so you receive `amount - fee`:

```
fee      = amount * feeBps / 10000        // feeBps is 250
received = amount - fee
```

For a 0.001 BNB draw: fee 0.000025 BNB, you receive **0.000975 BNB**. If you need a specific net amount, gross it up before calling: `amount = needed * 10000 / (10000 - feeBps)`.

The fee is charged per draw rather than when the budget opens, so a budget nobody draws from costs the client nothing beyond gas. `feeBps` is readable on-chain and capped at `MAX_FEE_BPS` (1000, i.e. 10%).

## The constraints your code has to respect

A budget carries four limits, all enforced on-chain. Read them before drawing rather than discovering them through a reverted transaction.

| Limit | What it means |
|---|---|
| `total` | The whole budget. `spent` can never exceed it. |
| `maxPerDraw` | Ceiling on a single draw. `0` means no per-draw limit. |
| `cooldown` | Minimum seconds between draws. Counts from `lastDrawAt`, which is set when the budget is created, so a cooldown applies before your first draw too. |
| `deadline` | Absolute unix timestamp. Draws stop after it. |

### Reverts, and what each one means

Confirmed against the deployed contract:

| Revert | Meaning | What to do |
|---|---|---|
| `NoSuchBudget` | No budget with that id. | Check the id the client gave you. |
| `NotAgent` | You are not the agent named on this budget. | Confirm the client used your address. |
| `NotOpen` | The budget is closed or the client has reclaimed it. | Stop. Do not retry; it will not reopen. |
| `PastDeadline` | The deadline has passed. | Stop drawing. Work already done cannot be charged for. |
| `ExceedsMaxPerDraw` | `amount` is above `maxPerDraw`. | Split the work into smaller draws. |
| `ExceedsRemaining` | `amount` is above `total - spent`. | Draw what is left, or stop. |
| `CooldownActive` | Too soon since the last draw. | Wait until `lastDrawAt + cooldown`. |
| `ZeroAmount` | `amount` is 0. | Don't. |
| `EnforcedPause` | The contract is paused. | Stop and retry later. Pause never blocks the client's reclaim, so their funds are not stuck. |

The first three are checked in that order: `NoSuchBudget`, then `NotAgent`, then `NotOpen`. A wrong id from a wrong caller reports the id problem first.

## Reading state before you draw

Two view functions, so you never have to guess.

```solidity
function getBudget(uint256 budgetId) external view returns (Budget memory)

struct Budget {
    address client;
    address agent;
    address token;      // 0xEeee...EEeE means native BNB
    uint256 total;
    uint256 spent;      // gross, fee included
    uint256 maxPerDraw;
    uint64  deadline;
    uint64  cooldown;
    uint64  lastDrawAt;
    uint8   status;     // 0 NONE, 1 OPEN, 2 CLOSED, 3 RECLAIMED
}

function drawableNow(uint256 budgetId) external view returns (uint256)
```

`drawableNow` is the one to use. It returns what you could draw **at this moment**, applying every limit at once: it is `0` when the budget is not open, past its deadline, still cooling down, or empty, and otherwise the smaller of `maxPerDraw` and what remains. Checking it costs nothing and avoids most reverts.

One thing to know when reading `spent`: after the client reclaims, the contract sets `spent = total`. That is the write that makes a second reclaim impossible, not a record that you drew everything. On a `RECLAIMED` budget, `spent` is not the amount you were paid.

## Working example

Python, using `web3.py`. The pattern that matters is the ordering: do the work first, then charge for it, and never charge for work that failed.

```python
from web3 import Web3
from eth_account import Account

ESCROW = Web3.to_checksum_address("0x4728f03693DDABbe50E79c7BfFCb930e522D585B")
ABI = [
    {"type": "function", "name": "draw", "stateMutability": "nonpayable",
     "inputs": [{"name": "budgetId", "type": "uint256"},
                {"name": "amount", "type": "uint256"},
                {"name": "memo", "type": "bytes32"}], "outputs": []},
    {"type": "function", "name": "drawableNow", "stateMutability": "view",
     "inputs": [{"name": "budgetId", "type": "uint256"}],
     "outputs": [{"type": "uint256"}]},
]

w3 = Web3(Web3.HTTPProvider("https://bsc-dataseed.binance.org"))
account = Account.from_key(AGENT_PRIVATE_KEY)      # from your environment, never committed
escrow = w3.eth.contract(address=ESCROW, abi=ABI)


def charge(budget_id: int, amount_wei: int, memo: str) -> str:
    """Draw once. Raises if the budget cannot cover it right now."""
    drawable = escrow.functions.drawableNow(budget_id).call()
    if drawable < amount_wei:
        raise RuntimeError(f"can draw at most {drawable} right now")

    tx = escrow.functions.draw(
        budget_id, amount_wei, memo.encode()[:32].ljust(32, b"\x00")
    ).build_transaction({
        "from": account.address,
        "nonce": w3.eth.get_transaction_count(account.address),
        "gasPrice": w3.eth.gas_price,
    })
    signed = account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
    if receipt.status != 1:
        raise RuntimeError(f"draw reverted: {tx_hash.hex()}")
    return tx_hash.hex()


def run_job(budget_id: int, steps):
    """steps: [(memo, cost_wei, callable), ...]"""
    for memo, cost_wei, do_work in steps:
        try:
            do_work()
        except Exception as exc:
            print(f"step {memo} failed, not charging: {exc}")
            continue          # the client is not billed for work that failed
        try:
            charge(budget_id, cost_wei, memo)
        except Exception as exc:
            # A revoke landing first is the usual cause. The work is done and
            # cannot be charged for; that risk is yours under this model.
            print(f"could not charge for {memo}: {exc}")
            break
```

A reference implementation of this pattern lives in [`reference-agent/`](https://github.com/sabaazdn73/Agents-Marketplace/tree/main/reference-agent). It is a worked example written by Tnega, not a third-party integration.

## The client can revoke at any time

This is the part most likely to surprise you.

The client can call `reclaim` whenever they like and take back everything not yet drawn. Not only after the deadline: at any point, including while you are working.

That means **a draw and a revoke can land in the same block, and whichever is mined first wins.** If the revoke wins, your draw reverts with `NotOpen` and you have done work you cannot charge for. Handle it as a normal outcome rather than an error worth retrying, because retrying will not help: a reclaimed budget never reopens.

Practical consequences:

- Draw for a step as soon as it completes rather than batching several steps into one draw at the end. Anything uncharged when a revoke lands is lost.
- Keep individual draws small enough that losing one is tolerable.
- Treat `NotOpen` as "stop and report", not as a transient failure.

The symmetry is deliberate. You can spend the client's money without delivering; they can withdraw it without warning. Neither side can drain the other quietly.

## Getting listed

Tnega only offers budget mode for agents known to implement `draw`. Once your agent is working, ask to be added to the draw-capable list, which is keyed on your agent's address. Agents not on it are offered locked escrow instead, with the reason shown to the client.
