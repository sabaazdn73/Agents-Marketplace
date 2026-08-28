# Venus Lending skill: reason-less revert investigation (2026-08-28)

## The real incident

Attempting the Venus Lending skill through a real Altana session failed with the SDK's own raw text: `An error occurred while executing calls. Reason: 0x Details: 0x`.

## What "0x / 0x" actually is

Traced through the installed `@altananetwork/sdk` (`dist/execute.js`) into its own `porto` dependency and `ox`'s generic `BaseError` formatter (`node_modules/ox/core/Errors.ts`). This confirms: the SDK isn't failing to decode a real reason it has — the relay genuinely received **empty revert data** (`0x`, zero bytes) for this call. That's a real, structural fact about what came back on-chain, not a gap in error-decoding that was hiding a real message from us. It was, however, a real gap that our own code never tried to decode ANYTHING beyond what the SDK prints verbatim — fixed (see below).

## The four hypothesized causes — three ruled out with live evidence, one narrowed

1. **Decimal/amount-encoding mismatch** — **ruled out.** Live `eth_call`: `USDT_BSC.decimals()` returns `18` (the code's assumption is correct); `VENUS_VUSDT.underlying()` returns `USDT_BSC`'s exact address (no token mismatch); `VENUS_VUSDT.decimals()` returns `8`, which is correct and irrelevant to `mint()`'s amount argument (denominated in the underlying's own units, not the vToken's).
2. **vUSDT market paused** — **ruled out.** Venus's real Comptroller has been upgraded to a Diamond proxy (EIP-2535) — the old Compound-style `mintGuardianPaused(address)` selector reverts with `"Diamond: Function does not exist"` on it now. Found the real, current replacement (`actionPaused(address,uint8)`) and called it live: `actionPaused(vUSDT, Mint)` returns `false`. `markets(vUSDT)` also confirms `isListed: true`.
3. **Supply cap hit** — **ruled out.** Live reads: real supply cap is 600,000,000 USDT; real, current total underlying supplied (computed from `totalSupply()` × `exchangeRateStored()`) is ~201.7M USDT — roughly **$398M of real headroom**. Nowhere close.
4. **Session-scope permission mismatch** — **not ruled out, but the obvious version of it checks out.** The skills panel requests its own, correctly-scoped session per skill (`grantSkillSession`, distinct from the marketplace hire flow's `grantMarketplaceSession`) — for Venus specifically, `contracts: [VENUS_VUSDT, USDT_BSC]` is passed correctly, both real target addresses are allowlisted. This does NOT rule out a real rejection happening inside Altana's own relay-side policy enforcement in a way this project's client-side code can't see or verify (no server-side visibility into their policy engine) — a real revert with genuinely zero returndata is, if anything, *more* consistent with a permission check failing before the call ever reached Venus/USDT at all (a plain Solidity contract-level revert almost always carries at least a short reason) than with an on-chain business-logic rejection.

Also checked, not on the original list: an **insufficient real balance/allowance** in the specific session wallet — this is the one real hypothesis that genuinely could not be checked without the actual wallet address involved, which wasn't available. Real Venus Protocol status (WebSearch, 2026-08-28) shows no current incident affecting BSC.

## What shipped

Rather than guess further, built the real tooling to settle this definitively on the next attempt:

- **`altana.js`'s `decodeAltanaExecutionError()`** — walks every real hex string in a thrown `execute()` error (message, `.data`, nested `.cause` chain) and decodes the two standard Solidity revert shapes (`Error(string)`, `Panic(uint256)`) when present, real and human-readable. A genuinely empty revert is now reported as exactly that, explicitly — "no on-chain reason at all... most consistent with the session's own permission/scope check rejecting the call" — rather than left as opaque hex. Wired into `getAltanaExecutor()`; every skill execution failure now carries this alongside (never replacing) the SDK's own original message.
- **`defiSkills.js`'s `venusSupplyPreflight()`** — a real, read-only check of the wallet's actual current USDT balance and BNB balance before a real attempt runs at all. Wired into the Venus skill specifically in `AltanaSkillsPanel.jsx`; stops before spending a real session grant + relay attempt only on a genuine, high-confidence finding (real insufficient balance), never on the unverifiable session-scope hypothesis.

## Honest status: not yet identified with certainty

The real, most likely remaining explanation, given the live evidence above, is a real rejection inside Altana's own relay-side session/permission enforcement — but this project has no visibility into that system beyond its client SDK, so this is the most-consistent-with-the-evidence explanation, not a confirmed one. **What would settle it**: retry the same attempt now that error-decoding is live — if the real cause is anything with a real Solidity revert string (an on-chain business-logic rejection), it will show a real, specific reason instead of "0x/0x" this time. If it fails with the exact same, still-genuinely-empty revert, that's real, positive evidence for the relay/permission-layer hypothesis, worth raising with Altana directly at that point (their own relay is the only system that could confirm or deny it from here).
