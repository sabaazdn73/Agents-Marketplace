// practiceWallet.js
//
// The Practice Mode signer/executor. Practice Mode runs skills against our
// self-hosted, persistent Anvil fork of live BSC mainnet (via the backend's
// allow-listed proxy at /api/practice/rpc), NOT through Altana's relay —
// Altana's relay only talks to real chains, so practice signing is a plain
// local viem key on the fork instead of a passkey session.
//
// The burner key is throwaway and fork-only: it never touches real mainnet,
// holds only faucet funds, and is persisted in localStorage so a returning
// user keeps the same practice address (and thus their accumulated fork
// state and their MongoDB practice history).

import { createWalletClient, createPublicClient, http, defineChain } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';

// The browser reaches the fork ONLY through the backend proxy (default,
// same-origin). Overridable for other deployments via VITE_PRACTICE_RPC_URL.
const PRACTICE_RPC_URL = import.meta.env?.VITE_PRACTICE_RPC_URL || '/api/practice/rpc';
const BURNER_KEY_STORAGE = 'aam_practice_burner_pk';

// Same chain id as real BSC (56) so every contract address, quote and ABI
// behaves exactly as it does on mainnet — the whole point of a fork.
export const practiceChain = defineChain({
  id: 56,
  name: 'BSC Practice Fork',
  nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
  rpcUrls: { default: { http: [PRACTICE_RPC_URL] } },
});

/** The throwaway, fork-only burner account, stable across reloads. */
export function getPracticeAccount() {
  let pk = null;
  if (typeof localStorage !== 'undefined') pk = localStorage.getItem(BURNER_KEY_STORAGE);
  if (!pk) {
    pk = generatePrivateKey();
    if (typeof localStorage !== 'undefined') localStorage.setItem(BURNER_KEY_STORAGE, pk);
  }
  return privateKeyToAccount(pk);
}

export function getPracticePublicClient() {
  return createPublicClient({ chain: practiceChain, transport: http(PRACTICE_RPC_URL) });
}

/**
 * A practice-mode executor with the same shape the skill modules consume in
 * real mode ({ walletAddress, publicClient, execute(calls) }). Altana batches
 * a skill's calls into one atomic relay intent; on the fork we instead submit
 * each signed tx sequentially and wait for its receipt.
 */
export function getPracticeExecutor() {
  const account = getPracticeAccount();
  const publicClient = getPracticePublicClient();
  const walletClient = createWalletClient({ account, chain: practiceChain, transport: http(PRACTICE_RPC_URL) });

  return {
    mode: 'practice',
    walletAddress: account.address,
    publicClient,
    async execute(calls) {
      const receipts = [];
      for (const call of calls) {
        const hash = await walletClient.sendTransaction({
          to: call.to,
          data: call.data,
          value: call.value ?? 0n,
        });
        receipts.push(await publicClient.waitForTransactionReceipt({ hash }));
      }
      return { mode: 'practice', receipts };
    },
  };
}
