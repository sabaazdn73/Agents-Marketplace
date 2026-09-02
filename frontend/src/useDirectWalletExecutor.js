// useDirectWalletExecutor.js
//
// Real, direct-wallet execution for Altana Skills (Venus Lending, PancakeSwap
// trading, etc.) — added 2026-08-28 after a real, valid product question: a
// user with an already-connected, already-funded wallet (MetaMask, etc.)
// had no way to run a Skill with it directly — the Skills panel only ever
// offered creating a brand-new, separate Altana passkey wallet, which then
// needs its OWN funding before anything can run. Real, honest value of the
// passkey-wallet model is seedless onboarding for someone with no existing
// wallet; for someone who already has one, forcing a second, empty wallet
// is real, avoidable friction, not a real safety or technical requirement.
//
// Real, confirmed feasibility (not assumed): this reuses the EXACT same
// real, already-proven wagmi/EIP-5792 primitives useHireAgent.js's own
// direct-wallet hire path already depends on in production — real atomic
// batching via wallet_sendCalls when the connected wallet supports it
// (same real wallet_getCapabilities check as useBatchHireCapability
// there), real sequential signing as an honest fallback when it doesn't.
// Not a new technical capability, just the same proven pattern applied to
// a new real call site.
//
// Shape matches Altana's own executor exactly ({ walletAddress,
// publicClient, execute(calls) }), so every real Skill function in
// defiSkills.js / pancakeswapSkill.js / fourMemeSkill.js works completely
// unchanged against either kind of executor — this is purely an
// alternative real way to GET one, not a fork of the skills themselves.
//
// Real, honest limitation, surfaced in the UI, not hidden: a directly-
// connected wallet has no on-chain spend cap or session — Altana's own
// "Autonomous" value (set a limit once, it can act within it later with
// no further signature) genuinely doesn't apply here. Every real run
// needs its own real signature, right then — structurally the same
// "Always Ask" model the main marketplace hire flow's direct path
// already uses, just for a Skill instead of a hire.

import { useAccount, usePublicClient, useConfig } from 'wagmi';
import { getCapabilities, sendCalls, waitForCallsStatus, sendTransaction, waitForTransactionReceipt } from 'wagmi/actions';
import { bsc } from 'wagmi/chains';

const RECEIPT_TIMEOUT_MS = 90_000;

/** Real, live capability check — same real wallet_getCapabilities call
 * useHireAgent.js's useBatchHireCapability already proved live against
 * BSC mainnet, reused here rather than re-implemented.
 *
 * Real, confirmed bug fixed 2026-09-02 (see useHireAgent.js's matching
 * comment for the full trace): this had the identical double-indexing
 * mistake — `capabilities[bsc.id]` a second time on a response viem
 * already unwrapped to that one chain's capabilities directly, since a
 * specific `chainId` was passed in. Always returned false regardless of
 * the real wallet's actual declared support. */
async function checkAtomicBatchSupport(config, address) {
  try {
    const capabilities = await getCapabilities(config, { account: address, chainId: bsc.id });
    const atomicStatus = capabilities?.atomic?.status;
    return atomicStatus === 'supported' || atomicStatus === 'ready';
  } catch {
    // Real, honest fallback — a wallet that doesn't implement
    // wallet_getCapabilities at all (most still don't) throws or 404s
    // here; genuinely unsupported, not an error to surface.
    return false;
  }
}

/**
 * Real hook — returns null while no real wallet is connected (the caller
 * should prompt connection, e.g. via RainbowKit's own ConnectButton,
 * rather than this hook doing it), or a real executor once one is.
 */
export function useDirectWalletExecutor() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const config = useConfig();

  if (!isConnected || !address) return null;

  return {
    mode: 'direct',
    walletAddress: address,
    publicClient,
    execute: async (calls) => {
      const atomicSupported = await checkAtomicBatchSupport(config, address);

      if (atomicSupported) {
        // Real, atomic batch — one real signature covers every real call
        // in `calls`, same as the marketplace hire flow's own batched path.
        const { id } = await sendCalls(config, { chainId: bsc.id, calls });
        const result = await waitForCallsStatus(config, { id, timeout: RECEIPT_TIMEOUT_MS });
        if (result.status !== 'success') {
          throw new Error(
            `The batched steps didn't confirm successfully (real status: ${result.status}). ` +
            `Check this batch's real status before trying again.`
          );
        }
        return {
          mode: 'direct-batch', status: 'success',
          transactionHashes: (result.receipts || []).map((r) => r.transactionHash),
        };
      }

      // Real, honest sequential fallback — most connected wallets don't
      // support EIP-5792 batching yet. Each real call is its OWN,
      // separately-signed transaction — no atomicity guarantee (if a
      // later call fails, earlier ones already landed on-chain), same
      // real tradeoff any normal "approve, then act" dApp flow already
      // has. Never silently claimed to be atomic when it isn't.
      const transactionHashes = [];
      for (const call of calls) {
        // Real bug fixed 2026-09-01, found while wiring up the native
        // Staking agent (a payable call, real BNB value attached): this
        // dropped `call.value` entirely, so any payable skill run through
        // a wallet that doesn't support atomic batching (the common case,
        // per this file's own comment above) would silently send 0 BNB
        // instead of the real amount. Lista's existing listaStake() call
        // already relies on `value` being forwarded — this was a real,
        // previously-unexercised gap, not a new requirement.
        const hash = await sendTransaction(config, { to: call.to, data: call.data, value: call.value ?? 0n, chainId: bsc.id });
        try {
          await waitForTransactionReceipt(config, { hash, timeout: RECEIPT_TIMEOUT_MS });
        } catch (e) {
          // Real, added 2026-08-29 after a real, live incident: viem's own
          // timeout error here is easy to misread as "the transaction
          // failed" when it usually just means the confirmation-polling
          // gave up, not that the transaction itself did anything wrong.
          // Wrapped with an honest, checkable next step instead of
          // showing viem's raw technical string on its own.
          e.message = `Sent (hash ${hash}), but didn't confirm within ${RECEIPT_TIMEOUT_MS / 1000}s. ` +
            `Check this exact hash on BscScan (https://bscscan.com/tx/${hash}) before retrying — ` +
            `if it shows up there as successful, don't run this again; if BscScan has never heard of it either, ` +
            `it likely never left your wallet and it's safe to retry. Original: ${e.message}`;
          throw e;
        }
        transactionHashes.push(hash);
      }
      return { mode: 'direct-sequential', status: 'success', transactionHashes };
    },
  };
}
