# EIP-7702: a payout event cannot tell you who was paid (2026-09-23)

## The claim

On a chain that has EIP-7702, an externally owned account can carry a delegation
to contract code that runs whenever the account is called. If that code forwards
incoming value, then paying the account and paying somebody else are the same
transaction, and they produce the same logs.

So a payment event naming an address is evidence that the address was credited.
It is not evidence that whoever controls that address kept the money, and there
is no event, no receipt field and no balance reading that separates the two after
the fact. This is a property of 7702 and of payouts to accounts, not a property
of any contract in this repository.

It was found while verifying AgentBudgetEscrow, which is why it is written up
here, but it applies to every payout to an account on a 7702 chain.

## What was observed, and on what

Chain 56 (BNB Smart Chain), 2026-09-23. Every address below returns the same
account code:

```
0xef01008a67b5020ee254ef48e3b6a04927f39baf7e408a
```

`0xef0100` is the EIP-7702 delegation indicator. The twenty bytes after it are
the delegate: `0x8a67b5020ee254ef48e3b6a04927f39baf7e408a`.

| Address | Where the key comes from |
|---|---|
| `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | anvil default key 0 |
| `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | anvil default key 1 |
| `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` | anvil default key 2 |
| `0x90F79bf6EB2c4f870365E785982E1f101E93b906` | anvil default key 3 |
| `0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65` | anvil default key 4 |
| `0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A` | private key `0x1111…1111` |
| `0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf` | private key `0x00…01` |
| `0x1563915e194D8CfBA1943570603F7606A3115508` | private key `0x2222…2222` |

The common property is the key, not the address: each of these private keys is
published, guessable or trivially enumerable. A key generated fresh for this
check, `0xeFd58Da16a6D1C3d213Dabc1A7618b7037805eEb`, returns `0x` and carries no
delegation. Nothing here is a weakness in the addresses themselves. Somebody
holding these keys has signed a 7702 authorisation on each of them, which is
what anybody holding a key may do.

The delegation was read from two independent public endpoints,
`https://bsc-dataseed.bnbchain.org` and `https://bsc-rpc.publicnode.com`, which
returned identical code for every address.

## What the delegate does

`0x8a67b5020ee254ef48e3b6a04927f39baf7e408a` holds 717 bytes of runtime. It
dispatches on calldata size rather than on a selector, and its first branch is
the one that matters for a payout:

```
36 15 6056 57     CALLDATASIZE, ISZERO, jump to 0x56 if empty
...
0x56:
  5b                       JUMPDEST
  5f 5f 5f 5f              retSize, retOffset, argsSize, argsOffset
  34                       CALLVALUE
  69 bbb074f17a54b7673b95  PUSH10
  69 cc04506d439d338bde8e  PUSH10
  60 50 1b 17              SHL 80, OR
  5a f1                    GAS, CALL
  6102c7 57                revert if the call failed
```

The two pushes assemble one address,
`0xcc04506d439d338bde8ebbb074f17a54b7673b95`, and the CALL forwards the entire
incoming value to it. A plain transfer into any of the accounts above, with empty
calldata, therefore lands on this branch and leaves again in the same
transaction. The recipient is itself an account with no code.

The other branches do the same thing for tokens: the runtime contains the
`a9059cbb` (transfer) and `23b872dd` (transferFrom) selectors, built against the
same packed recipient, plus an `onERC721Received` responder and a hardcoded
`0xdac17f958d2ee523a2206206994597c13d831ec7`, which is USDT on Ethereum, a token
that does not exist on BSC. The same delegate is deployed on other chains, which
the next section confirms directly.

## The same delegate is on all four deployment chains

The addresses above were enumerated on BSC, but none of this is particular to
BSC, and the reads elsewhere in this document would be worth nothing if it
were. A clean `eth_getCode` on a chain that does not implement 7702 is not
evidence of anything: it is what every account returns there. So the same
weak key, anvil default key 0
(`0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`), and the same delegate were
read on every chain AgentBudgetEscrow is deployed to.

| Chain | Key's account code | Delegate runtime |
|---|---|---|
| BNB Smart Chain, 56 | `0xef0100` + `8a67b502…e408a` | 717 bytes |
| Ethereum, 1 | `0xef0100` + `8a67b502…e408a` | 717 bytes |
| Arbitrum One, 42161 | `0xef0100` + `8a67b502…e408a` | 717 bytes |
| Robinhood Chain, 4663 | `0xef0100` + `8a67b502…e408a` | 717 bytes |

The delegate's runtime is byte-identical on all four, not merely the same
length. The SHA-256 of the 717 decoded bytes is the same everywhere:

```
ade240182bccfb8b770fb6b9c4fffa7638af8a5e2e1f2a48455cb3af5f7f90d0
```

That is the digest of the bytes, not of the hex text the RPC returns. The
command that produces it is in the next section; run it against any of the
four endpoints and it gives the line above. Every row was read from two
independent public endpoints per chain, eight reads in all, which agreed on
the account code and on this digest.

Two things follow. First, 7702 is live on every chain this contract is
deployed to, so the clean reads reported at the end of this document are
meaningful rather than vacuous: those accounts could have carried a
delegation and do not. Second, the sweeper is not a BNB Chain curiosity. The
same code, watching the same published keys, forwarding to the same address,
is in place on all four, which is what makes the conclusion below a property
of paying an externally owned account rather than an observation about one
chain.

## Why this reaches a payout event

`AgentBudgetEscrow._payout` sends native value like this:

```solidity
(bool ok,) = payable(to).call{value: amount}("");
```

Empty calldata. That is precisely the branch above. So when a budget's agent
address is one of these accounts and it calls `draw`:

- `draw` succeeds. Nothing reverts.
- `Drawn` is emitted with the correct `amount`, `fee`, `spent` and `remaining`.
- `spent` and `lastDrawAt` update in storage exactly as they should.
- The payout leaves the escrow, arrives at the agent address, and continues on
  to `0xcc04506d439d338bde8ebbb074f17a54b7673b95` before the transaction ends.

Every check the contract performs passes, because every check is about the
address, and the address is correct. Storage decides who the payee is. The
delegation decides what that payee does with the money at the instant it
arrives, and it does so inside the same transaction, so there is no window in
which the agent held the funds and no second transaction to observe.

## How to reproduce

The delegation itself, with no local tooling beyond curl:

```bash
curl -s -X POST https://bsc-dataseed.bnbchain.org \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_getCode",
           "params":["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266","latest"]}'
```

Expect `"result":"0xef01008a67b5020ee254ef48e3b6a04927f39baf7e408a"`. Substitute
any address from the table. Substitute `cast wallet new` output for the control,
which returns `0x`.

The delegate's own code, which is where the forwarding is legible:

```bash
cast code 0x8a67b5020ee254ef48e3b6a04927f39baf7e408a \
  --rpc-url https://bsc-dataseed.bnbchain.org
```

And the digest quoted above, which is the SHA-256 of the decoded runtime. The
`cut` strips the leading `0x` and `xxd -r -p` turns the hex back into the 717
bytes, so this hashes the code rather than the text the RPC wrapped it in:

```bash
cast code 0x8a67b5020ee254ef48e3b6a04927f39baf7e408a \
  --rpc-url https://bsc-dataseed.bnbchain.org \
  | cut -c3- | xxd -r -p | shasum -a 256
```

Expect `ade240182bccfb8b770fb6b9c4fffa7638af8a5e2e1f2a48455cb3af5f7f90d0`.
Hashing the RPC's response text instead, `0x` prefix included, gives a
different and meaningless digest; that is a distinction worth keeping if the
number is ever compared.

To check another chain, swap the endpoint for that chain's own and read the
same two addresses. The delegation and the delegate should both be present on
any chain where 7702 is live and this sweeper has been authorised.

The delegation is live state and can be revoked by whoever holds the key, by
signing an authorisation to the zero address. If a lookup returns `0x` in
future, that is the state having moved on, not a failure to reproduce.

## What follows

A buyer watching a `Drawn` stream cannot distinguish "the agent was paid" from
"someone else was paid". Both produce the same event with the same values. This
is the sharper version of a limit already recorded in this project: `spent` does
not mean delivery, and now the draw count does not reliably mean the agent
received anything either. Counting from `Drawn` events remains the correct floor,
because it is the only figure a reclaim cannot overwrite, but the ceiling on what
may be claimed from it is lower than it looks. A draw records that money left the
escrow toward an address. It does not record who ended the transaction holding it.

It also generalises past this contract. Any payout to an account on a 7702 chain
has the same property: ERC-8183 releasing a payment, a fee wallet withdrawal, a
marketplace paying a seller. Wherever a system's evidence that a party was paid
is an event naming that party's address, 7702 has separated the address from the
outcome.

The useful consequence for anyone building on chain evidence is that "value
reached this address" and "this party was paid" stopped being the same statement
when 7702 shipped, and nothing in a log distinguishes them. A system that needs
the second statement has to get it from somewhere other than a transfer event:
from the recipient attesting, from a settlement the recipient has to take an
action to complete, or from not paying an account in the first place.

## A delegation is not a sign of compromise

The contract's own live participants make the point, and they were read the same
way on the same day.

| Address | Role on BSC budgets 1 to 3 | Account code |
|---|---|---|
| `0xF7cB0edb9C996C1f4D795cE6018F313D7095Ff7D` | agent on budgets 1 and 2 | `0x` |
| `0x55b9A2Df9f6E160D1757eB7da1f2efda1a3b908F` | agent on budget 3 | `0x` |
| `0x48cE74cdC366E8347f17F7187FBf2Ab9240692E9` | client on all three | `0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b` |

The client address carries a 7702 delegation, to
`0x63c0c19a282a1b52b07dd5a65b58948a07dae32b`. That delegate holds 11,185 bytes
and dispatches on function selectors including `eip712Domain`, `entryPoint` and
`onERC1155Received`: it is a smart account implementation, which is what 7702 was
designed for. The sweeper is 717 bytes and dispatches on calldata size.

So on one contract, on one chain, there are two delegations that an
account-code check cannot tell apart without reading and understanding the
delegate, and the delegate can be swapped at any time by the key holder. The
presence of a delegation says nothing on its own. Neither does its absence,
since one can be added in the next block.

## What does not follow

This is not a vulnerability in AgentBudgetEscrow, and there is no change to the
contract that would address it. The contract pays the address its client named.
Checking the payee's account code before paying would be the wrong fix twice
over: a delegation can be added or removed at any time, including in a
transaction ordered immediately after the check, and refusing to pay accounts
that carry one would break the many legitimate uses 7702 exists for, batching
and sponsorship among them, as the client address above is currently doing.
There is no on-chain test that separates a sweeper from a wallet.

It is also not a finding about the specific addresses listed here. They are
demonstration material, chosen because their keys are published, which is why a
sweeper is watching them at all. The finding is about what a payout event means
in general and would hold identically if none of these accounts existed.

Nor does it say anything about whether the agents this project indexes are
compromised. Every agent address named on every budget the contract has ever
held was checked on its own chain, and all four return `0x`:
`0xF7cB0edb…Ff7D` and `0x55b9A2Df…908F` on BSC, `0x75b583C5…4Adc` on Arbitrum,
`0x6C3B4B5f…Dc33` on Robinhood Chain. None carries a delegation of any kind, so
no draw in the contract's live history was paid to a delegated address. This is
a statement about what the evidence could support, not a report of it having
happened here.

For the record, since the counts are easy to get wrong: five budgets exist in
all, across three chains, three on BSC and one each on Arbitrum and Robinhood
Chain. The contract is deployed on four chains, but Ethereum's `budgetCounter`
is 0 and it has never held one.

## Related

- [What Verified Can Mean](what-verified-can-mean.md), on the distance between a
  reading and the claim it is asked to support.
- [Drawable Budgets: Integration Guide](budget-integration.md), for what a budget
  is and what it does not provide.
- [Known Limitations](limitations.md).
