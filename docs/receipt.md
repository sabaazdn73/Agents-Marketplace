# Tnega Receipt on Solana

A Tnega Receipt is an optional, on-chain record of a purchase made through
Tnega: what the order was quoted at, what it actually cost, and what Tnega had
measured on the other versions of the same stock when the order was signed.
It is written by a Solana program, only with the buyer's own signature, and
anyone can check it from a browser without trusting Tnega's servers.

It runs on **Solana devnet** today. The program is
[6Nzn82QGVZTiU3iv26ZT9UKQFfyYyjyCoWqUZJ5LLrxP](https://explorer.solana.com/address/6Nzn82QGVZTiU3iv26ZT9UKQFfyYyjyCoWqUZJ5LLrxP?cluster=devnet)
(Anchor, version 2), and its source and tests are in this repository under
[solana/tnega-receipt/](https://github.com/sabaazdn73/Agents-Marketplace/tree/main/solana/tnega-receipt).

## The first receipt

On 11 October 2026 a buyer paid 4 USDC for 0.01186472 AAPLx (Apple, from
xStocks) on Solana mainnet, through an order prepared by Tnega's MCP server and
signed on a `tnega.app/sign/…` page:

| What | Where |
|---|---|
| Purchase (mainnet) | [4rbGusmy…kPPqw](https://explorer.solana.com/tx/4rbGusmyTGCKNtqUr46b5Q55rp4FgHGQw6qeBGC12nbF2wUCZ2uvPVrQaEP9jWjZH72jQgqF6yfpCEmKjNMkPPqw), slot 455,622,203, 10:42:46 UTC |
| Quoted, paid | 0.08% quoted when the order was prepared; 0.10% paid: Jupiter's price impact plus the shortfall of the tokens received against the tokens quoted, without the network fee |
| The card | [tnega.app/receipt/b029c6c2…a07](https://www.tnega.app/receipt/b029c6c2622bdcec5d2a3e9c49cf56608bbfac136198a21052b7aba8963a8a07) |
| The record | [tnega.app/receipts/b029c6c2…a07.json](https://www.tnega.app/receipts/b029c6c2622bdcec5d2a3e9c49cf56608bbfac136198a21052b7aba8963a8a07.json) |
| The receipt (devnet) | [8w9EaQ8a…ozGv7G](https://explorer.solana.com/address/8w9EaQ8adnD3u4P16zjApdq13AAB1ib4xX837vozGv7G?cluster=devnet), issued 12:03:06 UTC in [3cqhZqZ6…Wx636ktg](https://explorer.solana.com/tx/3cqhZqZ6pdy53LxBJNYQWYNiq2QvniugKfMCf5pdUEUVyTwfYqy1dRhW2r5NbiT7eFiNfGX2FRSvpkSXWx636ktg?cluster=devnet) |

The record also carries seven readings Tnega had taken of the other versions
of Apple (Robinhood Chain, Base, BNB Chain, Ethereum and Solana), each with its
own time, block or slot and source.

## How a receipt is made

1. **The record.** After a purchase, the order the buyer signed, the execution read from the purchase's own chain, and Tnega's readings of the other versions are written into one JSON file with sorted keys and no spaces. Its SHA-256 is the record's `content_hash`, and the file is published at `tnega.app/receipts/<content_hash>.json`.
2. **The buyer opts in.** On the receipt page the buyer connects the wallet that made the purchase and signs the text `Tnega Receipt v1` + newline + `content_hash: <hex>`. This is a message, not a transaction: it moves nothing and costs nothing. Not signing writes nothing.
3. **One transaction.** Tnega's attestor sends a transaction whose first instruction is Solana's Ed25519 program verifying the buyer's signature, and whose second is the program's `issue_receipt`. The program reads the instructions sysvar and refuses unless the instruction right before it checked exactly one signature, by the buyer, over this receipt's text. A forged signature fails in the Ed25519 program; a real signature by someone else, or over another record, fails in the receipt program.
4. **What is stored.** The receipt lives at the address `["receipt", content_hash]`, so one record can have only one receipt. It holds the purchase's chain and transaction, the buyer, the quoted and paid cost in basis points, the amount, when the trade happened and up to eight readings (chain, token, state, cost, price per share, size, time, block or slot, source). A reading that did not fill carries no number, never a zero. Only `active` can change: the attestor or the authority can revoke a receipt, and a pause never blocks a revocation.

## Check it yourself

The [receipt page](https://www.tnega.app/receipt/b029c6c2622bdcec5d2a3e9c49cf56608bbfac136198a21052b7aba8963a8a07)
runs every check in the browser against public endpoints, not Tnega's server:
the record hashes to the address it is served under; a receipt exists at
`["receipt", content_hash]` on devnet, owned by the program; its fields match
the record (buyer, purchase transaction, amount, both costs, the time of the
trade, version 2); the readings on chain match the record's; the issuer is the
attestor named in the program's config; the issuing transaction carries the
Ed25519 check of the buyer's signature right before `issue_receipt`; the
purchase succeeded on Solana mainnet, paid by the buyer, with the amounts in
the record; and the receipt is not revoked.

## What it does not prove

The program cannot see the purchase, which happened on another chain, and it
cannot recompute the record's hash from the fields. A receipt says that Tnega's
attestor and the buyer signed this record. The purchase is checked on its own
chain, by the attestor before it signs and by the receipt page for anyone who
reads it. The other versions' prices are Tnega's measurements, each with its
source: an EVM reading can be replayed at its stated block with an archive
node; a Solana reading is a Jupiter quote, a record of what Tnega read.

## Today, and next

- **Devnet only.** The program and the receipts are on Solana devnet; the purchases they describe are real, on mainnet.
- **Solana buyers only.** An EVM buyer signs with secp256k1, which the program does not check yet, so it refuses one rather than write a receipt nobody signed.
- **Run by Tnega.** On this demo, the record is assembled and the attestor is run by Tnega, with the script `solana/tnega-receipt/scripts/receipt-devnet.mjs`. Building the record after every purchase and issuing it as soon as the buyer signs, with a separate attestor key on the server, is the next step.

## Where the idea comes from

The design follows TrustCycle, the author's earlier project on IOTA: a shared,
revocable record whose content cannot change, issued by a key that can be
replaced, with the full document published and only its hash anchored on
chain. Ported to Anchor, the receipt adds the buyer's signature as a condition
of issuing. The program has 33 tests on LiteSVM, with the Ed25519 precompile
on, so every signature check really runs.
