# Tnega Receipt

On-chain purchase receipts for [Tnega](https://tnega.app), on Solana. Tnega shows a
buyer what a tokenized stock will cost; this program records, after the
purchase, what it was quoted and what it actually cost, so anyone can check the
claim without trusting Tnega's servers.

The design is TrustCycle's (a shared, revocable, content-immutable record with
a capability-gated issuer), ported from IOTA Move to Anchor, and so is the idea
behind version 2: in TrustCycle the credential is a portable signed JSON whose
hash is anchored on chain, checked offline (signature) and online (state). A
Tnega Receipt is the same: the full record is published as JSON
(`tnega.app/receipts/<content_hash>.json`), its SHA-256 is the receipt's
address, the buyer signs that hash with their own wallet, and the program
refuses to write the receipt unless that signature was verified in the same
transaction.

## Deployed

| | |
| --- | --- |
| Program, Solana devnet | [`6Nzn82QGVZTiU3iv26ZT9UKQFfyYyjyCoWqUZJ5LLrxP`](https://explorer.solana.com/address/6Nzn82QGVZTiU3iv26ZT9UKQFfyYyjyCoWqUZJ5LLrxP?cluster=devnet), version 2 since 11 October 2026 |
| First receipt | [`8w9EaQ8adnD3u4P16zjApdq13AAB1ib4xX837vozGv7G`](https://explorer.solana.com/address/8w9EaQ8adnD3u4P16zjApdq13AAB1ib4xX837vozGv7G?cluster=devnet), for a 4 USDC AAPLx buy on Solana mainnet; the card and its checks: [tnega.app/receipt/b029c6c2…a07](https://www.tnega.app/receipt/b029c6c2622bdcec5d2a3e9c49cf56608bbfac136198a21052b7aba8963a8a07) |
| For readers | [docs/receipt.md](../../docs/receipt.md): what a receipt says, how to check it, and what it does not prove |

`anchor keys sync` on a fresh clone writes a new program id of your own into
`declare_id!` and `Anchor.toml`; the deployed program is the one above.

## Prerequisites

| Tool | Version |
| --- | --- |
| Anchor | 1.1.2 |
| Solana CLI | 3.1 or newer |
| Rust | 1.98.0 (pinned in `rust-toolchain.toml`, as in the class repos) |

```bash
anchor keys sync     # first time only: the repo does not ship the program keypair
anchor build && cargo test
```

`anchor build` before `cargo test`, every time: the tests `include_bytes!` the
`.so`. `cargo test` first gives a missing-file error, not a test failure.

## Accounts

| Account | Seeds | Holds |
| --- | --- | --- |
| `ReceiptConfig` | `["config"]` | `authority`, `attestor`, `paused`, `bump` |
| `Receipt` | `["receipt", content_hash]` | see below |

`Receipt` (version 2): `content_hash`, `chain_id` (0 for Solana), `tx_hash`
(an EVM hash, or SHA-256 of a Solana signature), `buyer` (a Solana key, or an
EVM address left-padded to 32 bytes), `quoted_cost_bps`, `executed_cost_bps`,
`notional_usd_cents`, `issued_at` (Solana clock), `issuer`, `active`, `bump`,
then `version` (2), `executed_at` (when the purchase happened on its own
chain) and `readings` (up to 8).

`Reading` (50 bytes): `chain_id`, `token_suffix` (the token's last 8 bytes;
the full key is in the record), `state` (filled, too thin, no route),
`cost_bps`, `price_per_share_micros`, `size_usd`, `as_of`, `block` (EVM block
or Solana slot), `source` (pool simulated at the block, or Jupiter quote). A
reading that did not fill must carry no cost and no price: never a zero that
reads as a number.

`content_hash` is the SHA-256 of the full order-and-execution JSON, computed
off chain and published. Only `active` can ever change.

## Instructions

| Instruction | Signer | Effect |
| --- | --- | --- |
| `initialize(attestor)` | anyone; becomes `authority` | creates the config |
| `set_attestor(attestor)` | `authority` | replaces the hot key |
| `set_paused(paused)` | `authority` | blocks issuing only |
| `issue_receipt(..., executed_at, readings)` | `attestor`, after the buyer's Ed25519 check | creates the receipt, emits `ReceiptIssued` |
| `revoke_receipt()` | `attestor` or `authority` | sets `active = false`, emits `ReceiptRevoked` |

## Design decisions

- **No signature, no receipt.** The instruction right before `issue_receipt`
  must be the Ed25519 program checking exactly one signature, by `buyer`,
  over `Tnega Receipt v1\ncontent_hash: <hex>`, with the key, signature and
  message inside that instruction. The runtime verifies the signature before
  anything runs; the program reads the instructions sysvar to make sure the
  check was about this buyer and this receipt. A forged signature fails in
  the Ed25519 program; a real signature by someone else, or over another
  receipt, fails in ours. An EVM buyer (secp256k1) is refused until that
  check is added.
- **The numbers on chain, the record by hash.** The costs, the size, the
  execution time and up to 8 readings are stored, so a reader needs no
  server for the numbers; the full record (keys, routes, sources) is the
  published JSON whose hash is the address.
- **Version 2 appends.** Version 1's fields keep their order; a reader that
  knows version 1 still reads them. A version 1 receipt cannot be read by
  the version 2 program, so revoke any you want revoked before upgrading.

- **Two keys.** `authority` governs and can live on a hardware wallet;
  `attestor` is the hot key a server signs with. A leaked hot key is replaced
  with one `set_attestor`, and the authority can still revoke everything it
  issued.
- **The address is the hash.** A receipt lives at `["receipt", content_hash]`,
  so a second receipt for the same record fails at `init`. No counter, no
  lookup table, no way to rewrite history under the same hash.
- **A pause never blocks a revocation.** The same rule as Tnega's
  AgentBudgetEscrow, where `pause()` can never block `reclaim`. `revoke_receipt`
  does not read `paused`, and `test_revoke.rs` fails if it starts to.
- **Costs are bounded.** A cost in basis points above 10,000 is rejected;
  exactly 10,000 is accepted (`<=`, not `<`).

## What this does not prove

The program cannot re-derive `content_hash` from the fields, and it cannot see
the purchase, which happened on another chain. A receipt says "Tnega's attestor
and the buyer signed this record", not "this happened". The off-chain issuer is meant to read the
purchase transaction from its own chain first and refuse to sign for one that
did not succeed; that check is in the attestor (`scripts/receipt-devnet.mjs`
reads a Solana purchase and its payer before signing), not here, and anyone
can repeat it from `chain_id` and `tx_hash`, as the receipt page does.

## Tests

33 LiteSVM tests (precompiles on, so the Ed25519 program really verifies).
Version 1's 19: issue, duplicate hash, wrong signer, the authority is not the
attestor, the 10,000 bps boundary, pause and unpause, revoke by attestor and
by authority, revoke twice, revoke while paused, rotation. Version 2's 14
(`test_signature_and_readings.rs`): no signature, the signature after instead
of before, a signature by a stranger or by the attestor, the buyer signing
another receipt or the bare hash, a forged signature (refused by the Ed25519
program, instruction 0), two signatures in one check, an EVM buyer, eight
readings stored in order, nine refused, an unfilled reading carrying a cost,
unknown state or source, a filled reading over 10,000 bps, and an execution
time in the future or at zero. Each failure test asserts its error code.

Rules checked by breaking them on purpose: the cost check changed to `<`, a
pause blocking revocation, and the buyer's key not compared: the matching
test failed each time.

## Devnet

```bash
solana config set --url devnet
solana-keygen new -o ~/.config/solana/tnega-receipt-deployer.json   # a fresh key
solana airdrop 2 -k ~/.config/solana/tnega-receipt-deployer.json
anchor keys sync && anchor build
anchor deploy --provider.cluster devnet --provider.wallet ~/.config/solana/tnega-receipt-deployer.json
```

Deploying reserves rent for twice the program's size (about 2.6 SOL for the
185 KB binary), refundable with `solana program close`. `target/deploy/*-keypair.json`
is a private key and is git-ignored; do not add it.

### Upgrading a deployed version 1 to version 2

```bash
node scripts/receipt-devnet.mjs revoke <any version 1 receipt to revoke>   # before the upgrade
anchor build && cargo test
anchor deploy --provider.cluster devnet --provider.wallet ~/.config/solana/tnega-receipt-deployer.json
```

### Issuing a receipt (the demo's attestor is this script)

The buyer opens `https://www.tnega.app/receipt/<content_hash>`, reads the
card and signs (a message, not a transaction). Then:

```bash
curl -sfO https://www.tnega.app/receipts/<content_hash>.json
node scripts/receipt-devnet.mjs issue --receipt <content_hash>.json --buyer-sig <base58 signature>
```

The script checks the signature, checks the purchase succeeded on its chain
and was paid by the buyer, and sends the Ed25519 check and `issue_receipt` in
one transaction. The receipt page then reads it back and re-checks it.
