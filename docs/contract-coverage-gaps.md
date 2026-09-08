# Contract test coverage: what is still untested

Status as of 2026-09-07. Deferred until after the deadline, recorded here
so it does not get lost, not because it is urgent.

Both contracts are live on BSC mainnet and unchanged by this work. Everything
below is additive test work; none of it requires touching contract source.

## Where coverage stands

Measured with `forge coverage --fork-url https://bsc-dataseed.binance.org`.
The fork is required: `AgentAccessMarket.t.sol` reads the ERC-8004
registry, and without `--fork-url` its 11 tests fail at setup and its numbers
collapse to ~24%. That is a missing flag, not a regression.

| File | Lines | Statements | Branches | Funcs |
|---|---|---|---|---|
| `AgentBudgetEscrow.sol` | 100.00% (104/104) | 87.42% (139/159) | 60.47% (26/43) | 100.00% (15/15) |
| `AgentAccessMarket.sol` | 88.89% (80/90) | 77.05% (94/122) | 33.33% (10/30) | 84.62% (11/13) |

`AgentBudgetEscrow` reached 100% line and function coverage when `setFeeBps`
and `setFeeWallet` were tested (2026-09-07); before that both had zero
lines executed. Branch coverage went 53.49% → 60.47%.

## A warning about the lcov branch data

Do not treat `lcov.info`'s per-line `BRDA` records as a to-do list. Forge
records a phantom untaken side for every single-sided `if (cond) revert ...;`,
so demonstrably-tested lines appear "uncovered".

Concrete proof: line 253, `if (b.status == Status.NONE) revert NoSuchBudget();`
is reported with an untaken side, yet `test_unknownBudgetId_reverts` asserts
exactly that revert. Twenty lines in `AgentBudgetEscrow.sol` are flagged this
way and most of them are fine.

The list below was built by reading the contract, not by reading the tool.

## Genuinely untested, in priority order

### 1. `_payout` → `NativeTransferFailed` (line 361)

```solidity
(bool ok,) = payable(to).call{value: amount}("");
if (!ok) revert NativeTransferFailed();
```

`NativeTransferFailed` appears zero times in the test suite. Nothing
exercises a native transfer that fails.

Needs a test double that rejects BNB, a contract with either no `receive()`
or one that reverts, installed as the agent (for `draw`), the client (for
`reclaim`), and the fee wallet (for `withdrawFees`). Worth checking each of
those three paths: a fee wallet that cannot receive BNB would strand fees
until `setFeeWallet` is called, which is recoverable, whereas the client and
agent paths matter more.

Highest value of the three items here: it is the only branch where a failure
mode is silently unexercised on a money path.

### 2. `drawableNow` early returns (lines 334 to 338)

```solidity
if (b.status != Status.OPEN) return 0;
if (block.timestamp > b.deadline) return 0;
if (b.cooldown != 0 && block.timestamp < uint256(b.lastDrawAt) + b.cooldown) return 0;
if (b.maxPerDraw != 0 && b.maxPerDraw < remaining) return b.maxPerDraw;
```

Referenced once in the suite, incidentally, as an assertion inside another
test (`assertEq(esc.drawableNow(id), 0, "nothing left")`). None of the four
paths is individually exercised.

This is the view function `docs/budget-integration.md` tells agent developers
to rely on before drawing. If it returns a wrong number, integrators build on
a wrong number. Cheap to test, it is a pure read, so each case is a state
setup plus one assertion.

### 3. `close()` guard combinations (lines 315 to 316)

`close()` is exercised by five tests, so this is the weakest of the three.
What is missing is the guard matrix: closing an already-closed budget, closing
a reclaimed one, and closing a non-existent id.

## Not in scope here

`AgentAccessMarket.sol` sits at 33.33% branch coverage and its `list()`
function carries the Aderyn HIGH (state change after the `ownerOf` external
call, no `nonReentrant`). That is a separate piece of work with its own
judgement call attached, see the audit notes rather than folding it in here.
