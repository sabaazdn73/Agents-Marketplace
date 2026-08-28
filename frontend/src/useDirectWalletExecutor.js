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
 * BSC mainnet, reused here rather than re-implemented. */
async function checkAtomicBatchSupport(config, address) {
  try {
    const capabilities = await getCapabilities(config, { account: address, chainId: bsc.id });
    const atomicStatus = capabilities?.[bsc.id]?.atomic?.status;
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
        const hash = await sendTransaction(config, { to: call.to, data: call.data, chainId: bsc.id });
        await waitForTransactionReceipt(config, { hash, timeout: RECEIPT_TIMEOUT_MS });
        transactionHashes.push(hash);
      }
      return { mode: 'direct-sequential', status: 'success', transactionHashes };
    },
  };
}
