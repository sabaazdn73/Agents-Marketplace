# Venus Lending skill: reason-less revert investigation (2026-08-28)

## The incident

Attempting the Venus Lending skill through an Altana session failed with the SDK's own raw text: `An error occurred while executing calls. Reason: 0x Details: 0x`.

## What "0x / 0x" actually is

Traced through the installed `@altananetwork/sdk` (`dist/execute.js`) into its own `porto` dependency and `ox`'s generic `BaseError` formatter (`node_modules/ox/core/Errors.ts`). This confirms: the SDK isn't failing to decode a reason it has; the relay genuinely received **empty revert data** (`0x`, zero bytes) for this call. That's a structural fact about what came back on-chain, not a gap in error-decoding that was hiding a message from us. It was, however, a genuine gap that our own code never tried to decode anything beyond what the SDK prints verbatim; fixed (see below).

## The four hypothesized causes: three ruled out with live evidence, one narrowed

1. **Decimal/amount-encoding mismatch**: **ruled out.** Live `eth_call`: `USDT_BSC.decimals()` returns `18` (the code's assumption is correct); `VENUS_VUSDT.underlying()` returns `USDT_BSC`'s exact address (no token mismatch); `VENUS_VUSDT.decimals()` returns `8`, which is correct and irrelevant to `mint()`'s amount argument (denominated in the underlying's own units, not the vToken's).
2. **vUSDT market paused**: **ruled out.** Venus's Comptroller has been upgraded to a Diamond proxy (EIP-2535); the old Compound-style `mintGuardianPaused(address)` selector reverts with `"Diamond: Function does not exist"` on it now. Found the current replacement (`actionPaused(address,uint8)`) and called it live: `actionPaused(vUSDT, Mint)` returns `false`. `markets(vUSDT)` also confirms `isListed: true`.
3. **Supply cap hit**: **ruled out.** Live reads: supply cap is 600,000,000 USDT; current total underlying supplied (computed from `totalSupply()` x `exchangeRateStored()`) is ~201.7M USDT, roughly **$398M of headroom**. Nowhere close.
4. **Session-scope permission mismatch**: **not ruled out, but the obvious version of it checks out.** The skills panel requests its own, correctly-scoped session per skill (`grantSkillSession`, distinct from the marketplace hire flow's `grantMarketplaceSession`); for Venus specifically, `contracts: [VENUS_VUSDT, USDT_BSC]` is passed correctly, both target addresses are allowlisted. This does NOT rule out a rejection happening inside Altana's own relay-side policy enforcement in a way this project's client-side code can't see or verify (no server-side visibility into their policy engine); a revert with genuinely zero returndata is, if anything, *more* consistent with a permission check failing before the call ever reached Venus/USDT at all (a plain Solidity contract-level revert almost always carries at least a short reason) than with an on-chain business-logic rejection.

Also checked, not on the original list: an **insufficient balance/allowance** in the specific session wallet; this is the one hypothesis that genuinely could not be checked without the actual wallet address involved, which wasn't available. Venus Protocol status (WebSearch, 2026-08-28) shows no current incident affecting BSC.

## What shipped

Rather than guess further, built the tooling to settle this definitively on the next attempt:

- **`altana.js`'s `decodeAltanaExecutionError()`**: walks every hex string in a thrown `execute()` error (message, `.data`, nested `.cause` chain) and decodes the two standard Solidity revert shapes (`Error(string)`, `Panic(uint256)`) when present, human-readable. A genuinely empty revert is now reported as exactly that, explicitly, "no on-chain reason at all... most consistent with the session's own permission/scope check rejecting the call," rather than left as opaque hex. Wired into `getAltanaExecutor()`; every skill execution failure now carries this alongside (never replacing) the SDK's own original message.
- **`defiSkills.js`'s `venusSupplyPreflight()`**: a read-only check of the wallet's actual current USDT balance and BNB balance before an attempt runs at all. Wired into the Venus skill specifically in `AltanaSkillsPanel.jsx`; stops before spending a session grant + relay attempt only on a genuine, high-confidence finding (insufficient balance), never on the unverifiable session-scope hypothesis.

## Update (2026-08-28): a decisively confirmed root cause found, "orphaned wallet"

New evidence from the user: the wallet-setup step's screenshot showed **four separate saved passkeys**, all identically labeled "Tnega"/"Thega", in the browser's own password manager (plus "use a phone/tablet" and "USB security key" options, the standard native WebAuthn picker, not anything this app renders itself; confirmed by reading every wallet-creation code path in this app and finding exactly one, `getOrCreateAltanaWallet`, no three-way branch anywhere).

Reading the **installed SDK's own `recoverFromPasskey.js`** end to end surfaced the decisive mechanism: when a user picks the wrong one of several identically-named saved passkeys, `recoverFromPasskey` correctly resolves a wallet address from that passkey's own `userHandle`, but that wallet has never executed a transaction, so it throws this exact, SDK-authored error:

> *"Picked passkey resolves to wallet `{address}`, but that wallet has no keys registered in KeyStore yet. Either: (a) you picked the wrong passkey (the OS keychain has multiple with similar names...), or (b) this wallet was created but never executed a transaction..."*

This project's own `getOrCreateAltanaWallet()` had a bare `catch { createPasskeyWallet(...) }` around the recovery call, meaning **this exact, specific, actionable error (and any other recovery failure) was silently swallowed, and a brand-new, empty, session-less wallet was created in response, every time.** Repeated across several attempts, this is exactly how four separate passkeys accumulated for one site, and exactly why a Venus Lending attempt would revert with no on-chain reason: a fresh wallet has zero USDT, zero BNB, and no granted session at all, regardless of what it's asked to call. Confirmed, not merely plausible: this is the SDK's own documented behavior for precisely this situation.

### The fix shipped

`getOrCreateAltanaWallet()` is now two separate, explicit functions: `recoverAltanaWallet()` (only ever recovers; throws its own error on failure, never auto-creates anything) and `createNewAltanaWallet()` (a deliberate, separate action). Both UI call sites (`AltanaSessionPanel.jsx`, `AltanaSkillsPanel.jsx`) now show the recovery error and require an explicit, conscious "This is genuinely my first time, create a new wallet" click before ever creating a new wallet, never an automatic, invisible fallback again.

### Guidance on identifying which of the 4 saved passkeys (if any) has funds

There's no way for this app (or me) to enumerate or query the four saved passkeys' corresponding wallet addresses in advance; WebAuthn credentials are opaque to a website until an actual authentication ceremony completes. This is an unavoidable platform limitation, not a gap in this project's own code. But the fix above makes each one self-revealing when tried: click "Try again", pick one of the four saved passkeys from the OS picker, and either (a) it succeeds, the connected wallet's address is shown in the UI, or (b) it fails with the SDK's own error above, which **includes the exact wallet address** that specific passkey resolves to, even though it's unfunded. Repeating this once per saved passkey (four times) will surface all four addresses. Once you have them, share them and I'll check each one's live on-chain USDT/BNB balance (a safe, read-only check) to tell you plainly which one (if any) is the previously-funded wallet worth continuing with, and which are genuinely empty and safe to ignore.

## Update (2026-08-28): a UX fix, never guess again, always show and confirm

Fixing the silent-creation bug removed the cause, but the underlying UX gap remained: still no way to see, before signing anything, whether a recovered/created wallet is the funded one or an empty one. Built directly for that:

- **`altana.js`'s `fetchWalletBalanceSnapshot()`**: a read-only helper (BNB + USDT balance via the existing bloXroute RPC) shared by both UI flows.
- **`WalletConfirmStep.jsx`** (new, shared by web and mobile): shown immediately after any wallet recovery or creation, **before** proceeding to grant a session or sign anything: the resolved address, its live BNB and USDT balance, and, if both are genuinely zero, the exact message requested: *"This wallet is real but currently empty. If you were expecting funds here, you may have picked a different saved passkey than the one you funded before..."* plus the address to fund if it's intentional, and a "try a different saved passkey" button. The user must explicitly click through; nothing proceeds automatically behind this screen. Wired into both `AltanaSessionPanel.jsx` (marketplace hire flow) and `AltanaSkillsPanel.jsx` (Venus and the other DeFi skills).
- **A verified feasibility check on the "distinguishable passkey names" idea**: read the installed SDK's own `porto` dependency (`Key.createWebAuthnP256`) and confirmed the `name` passed to `createPasskeyWallet` maps directly to the WebAuthn credential's `user.name`/`user.displayName`, genuinely the field browsers use to distinguish saved passkeys for one site. Newly-created wallets now get a creation-time-stamped label (`"Tnega, new wallet, Aug 28, 3:45 PM"`) instead of the flat, identical `"Tnega"` every prior wallet used, a live-verified, working mitigation. **A limitation found and not worked around**: the literal wallet address can't be embedded in that label, because `createPasskeyWallet` generates its throwaway EOA (the address) internally, strictly after the name is already committed to the WebAuthn ceremony; reaching in further would mean reimplementing the SDK's own EIP-7702 upgrade sequence ourselves, a meaningfully riskier change for a cosmetic label. Not done.
