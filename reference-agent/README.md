# Reference agent — drawable budgets

**This is a reference implementation, built by Tnega. It is not a
third-party agent and must never be presented as adoption.**

It exists because deploying `AgentBudgetEscrow` proved the contract works
but left nothing able to call `draw()`. Without a real drawer, budget mode
is a funding model with no counterparty — a buyer could fund a budget that
nothing could ever draw from. This closes that honestly, by being a real
drawer, rather than by implying agents had taken the pattern up.

The product labels it accordingly: `core/budget_agents.py` carries
`kind="reference_implementation"` and a label that says so in plain words,
and that label is what the UI renders.

## Why its cost is real

It produces a **wallet due-diligence report** on an address the client
names, using the Zerion API — which this project pays for, on a real
300-calls-per-day budget.

That makes it a genuine instance of the case ERC-8183 cannot fund: the
agent must spend before it can deliver, so a locked escrow would leave it
unable to start. It is deliberately not a no-op that draws for show.

## The rule it follows

**Work first, then charge — and never charge for work that failed.**

Each step runs its real API call, and only draws if that call succeeded. A
failed call is recorded with its error and is not billed. An agent that
charged for work it did not do would be a worse example than no example.

Before each step it re-reads the budget on-chain, so a client revoking
mid-run stops the work rather than being billed for the remainder.

## The memos

Each draw carries a `bytes32` memo naming the actual step:

| memo | what it paid for |
|---|---|
| `positions` | current token positions for the subject wallet |
| `pnl:30d` | realised/unrealised P&L over 30 days |
| `activity:90d` | recent transaction history |

These are what a person reads in the live spend view. They are the real
step names, not counters or filler — the point of the `Drawn` event is
that a buyer can see *what* their money went on as it happens, which
ERC-8183 cannot show at all, since it emits one payment at the very end.

## Running it

```bash
cd reference-agent
pip install -r requirements.txt

export BUDGET_ESCROW_ADDRESS=0x4728f03693DDABbe50E79c7BfFCb930e522D585B
export AGENT_PRIVATE_KEY=...        # this agent's OWN wallet, never committed
export ZERION_API_KEY=...
export BSC_RPC_URL=https://bsc-dataseed.binance.org

uvicorn main:app --port 8100
```

`GET /ping` returns the agent's address. **That address is what a client
must name as `agent` when opening a budget**, and it is what goes in the
backend's `REFERENCE_AGENT_ADDRESS` so budget mode becomes selectable for
it.

Then, after a client has funded a budget on-chain:

```bash
curl -X POST localhost:8100/fulfil \
  -H 'content-type: application/json' \
  -d '{"budget_id": 3, "subject": "0x<wallet-to-report-on>"}'
```

## Key handling

The agent's private key is read from the environment and is never
committed, logged or echoed. It is the agent's own wallet, and its
authority is bounded by the contract: it can only move money a client
already granted to that specific budget, capped by `maxPerDraw`, the
cooldown and the deadline. It cannot touch anything else, including other
budgets.

## What this does not demonstrate

Being explicit, so the example is not read as more than it is:

- **Adoption.** One reference drawer is not an ecosystem.
- **That the model is safe for large budgets.** The trust inversion is
  real and unchanged — the cap is still the buyer's only structural
  protection.
- **Third-party interoperability.** Any other agent implementing `draw()`
  would need its own review before being listed as draw-capable.
