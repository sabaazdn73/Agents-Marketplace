# Direct-wallet execution for Altana Skills (2026-08-28)

**Update (2026-09-03):** the "Face ID mini-wallet" choice this doc describes for `kind: 'tx'` skills was later removed; a complete job-history scan found it had never been used for a real, completed transaction (same finding that removed the marketplace's Autonomous hire path, see [Known Limitations](limitations.md#altana-passkey-session-hiring-removed-2026-09-03)). Every `kind: 'tx'` skill now runs only through the user's own connected wallet, no upfront choice screen. The passkey mini-wallet remains, unchanged, for the `kind: 'pay'` (x402) skill specifically, which still has no direct-wallet equivalent. The rest of this doc is kept as the historical record of why the direct-wallet path was built and how it works; read the choice-screen framing below as describing the state at the time, not today.

## The question

For a user who already has an existing, connected, funded wallet (MetaMask, etc.), did the Venus Lending skill (and the other Altana Skills) genuinely require creating a brand-new, separate passkey wallet, with no way to use funds already in the wallet they already have?

## What was actually true (confirmed by reading the code, not assumed)

**Yes, that was a confirmed gap.** Every `kind: 'tx'` skill in `AltanaSkillsPanel.jsx` (Venus Lending, Aave, Lista staking, PancakeSwap trading/liquidity, Four Meme) only ever called `getOrCreateAltanaWallet()`/`recoverAltanaWallet()`; there was no code path anywhere in the Skills panel using the user's already-connected wallet (`wagmi`'s `useAccount`) at all. That's a valid complaint: forcing a brand-new, empty wallet on someone who already has funds ready adds real friction with no benefit for them; the passkey model's actual value (seedless onboarding, no existing wallet needed) doesn't apply to that user.

## What was genuinely feasible, confirmed, not assumed, before building

The marketplace's own "Always Ask" direct hire flow (`useHireAgent.js`) already does exactly this kind of thing for hiring: connected-wallet execution via `wagmi`, with a live EIP-5792 (`wallet_getCapabilities`/`wallet_sendCalls`) atomic-batch check, falling back to sequential signed transactions when the connected wallet doesn't support batching. This is proven, working, production code, not a hypothetical; confirming a direct-wallet path for Skills was a moderate amount of new code (reusing this same proven pattern at a new call site), not a new technical capability needing R&D.

## What shipped

- **`useDirectWalletExecutor.js`** (new): a wagmi-based executor matching Altana's own shape (`{ walletAddress, publicClient, execute(calls) }`) exactly, so every existing skill function (`venusSupply`, `executeEnterPosition`, etc.) works completely unchanged against either kind of executor. Atomic batching via `wallet_sendCalls` when the connected wallet supports it (same live capability check as `useHireAgent.js`'s own `useBatchHireCapability`); sequential signing (each call its own separately-signed transaction) as the fallback most wallets still need.
- **`AltanaSkillsPanel.jsx`**: every `kind: 'tx'` skill now shows an upfront choice before anything else: **"Use my connected wallet"** (one signature per run, no new wallet, shows a `ConnectButton` inline if nothing's connected yet) or **"Use a Face ID mini-wallet"** (the existing passkey flow, unchanged). `kind: 'pay'` (x402) skills stay passkey-only, Altana's own settlement infrastructure, not a plain on-chain call a connected wallet can make directly.
- Both paths route through the same `WalletConfirmStep` (address + live balance, before signing anything) and the same `preflight` check already built for Venus; no shortcuts taken for the new path.

## The tradeoff, stated in the UI, not hidden

A directly-connected wallet has no on-chain spend cap or session at all. Altana's own "Autonomous" value, set a limit once, it can act within it later with no further signature, genuinely doesn't apply to a direct wallet; every run needs its own signature, right then. Structurally this is the same "Always Ask" model the main marketplace hire flow's direct path already uses, just applied to a Skill. The UI says this plainly in both the choice screen and the running-status text, never implies the two options are equivalent beyond "both really work."

Applies to both web and mobile; `AltanaSkillsPanel.jsx` is the one, shared component both already use.
