// altana.js
//
// Integration with @altananetwork/sdk (v0.7.0), verified directly against
// the INSTALLED type definitions under node_modules/@altananetwork/sdk/dist
// (client.d.ts, internal/sessions.d.ts, erc8183.d.ts, config.d.ts), not
// against comments or memory.
//
// Autonomous session hiring (grantMarketplaceSession/hireAgentWithSession/
// settleJob/disputeJob/revokeMarketplaceSession, and the AltanaSessionPanel.jsx
// UI that called them) was removed 2026-09-03. Decisive finding before
// removal: a full scan of the complete, real ERC-8183 job index (56,667
// jobs, every one this marketplace's kernel has ever processed) found ZERO
// jobs of ANY status carrying that path's own hire-description marker —
// not one attempt ever completed, or even started, end to end. See
// docs/limitations.md for the full finding. What remains here: wallet
// creation/recovery and scoped Skill sessions, still genuinely used by the
// x402-payments Skill (the one real Skill that still needs Altana's own
// settlement infrastructure) and by the Native/Skills panels' shared
// on-chain read helpers below.
//
// This project is MAINNET-ONLY. There is no testnet branch anywhere: the
// client is configured once for BNB mainnet (chainId 56).
//
// Signing is entirely client-side via Altana's passkey wallet
// (createPasskeyWallet -> Face ID / Touch ID / WebAuthn). No private key
// is ever held by this app or its backend.

import {
  createClient, BNB,
  getErc8183Job, getErc8183DeliverableUrl,
  erc8183Addresses,
} from '@altananetwork/sdk';
import { createPublicClient, http, hexToString, decodeAbiParameters, size } from 'viem';
import { bsc } from 'viem/chains';

// Same event the installed SDK's own getErc8183DeliverableUrl() looks for
// (POLICY_INITIALISED_EVENT in erc8183.js) — redefined here because that
// const isn't exported, only the function that uses it internally. Signature
// confirmed by reading the SDK source directly.
const JOB_INITIALISED_EVENT = {
  type: 'event', name: 'JobInitialised',
  inputs: [
    { name: 'jobId', type: 'uint256', indexed: true },
    { name: 'deliverable', type: 'bytes32', indexed: false },
    { name: 'submittedAt', type: 'uint64', indexed: false },
    { name: 'optParams', type: 'bytes', indexed: false },
  ],
};

const RP_ID = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
const APP_NAME = 'Tnega';

// One shared client, configured once for BNB mainnet. The same smart-account
// address is produced on any client configured for this chain, so a single
// module-level client is all this app needs.
const network = BNB;
const client = createClient({ chains: [BNB] });

// Reads use a plain BSC mainnet public client. The read-only skills
// (copy-trade / wallet-tracker) and the deliverable-URL lookup all issue
// getLogs calls, which the default public RPC (publicnode) refuses
// outright. Audit 2026-08-20: tried the project's own dRPC keys (both the
// Anvil fork's and a fresh one gotten specifically for this) — both are
// genuinely valid and work for plain eth_call, but their free-tier getLogs
// consistently times out on real test cases (job #56620's deliverable
// scan, and even a single bounded 200-block query on a busy PancakeSwap
// pair) — a plan-tier limit, not a code bug. Tried 8 other free/keyless
// public RPCs; only https://bsc.rpc.blxrbdn.com (bloXroute) worked end to
// end on all three cases (job #56620's deliverable, Copy Trade detection,
// 1,262 trades for an active wallet, Wallet Tracker, 1,278 swaps). It's
// public and keyless (no secret to protect), so it's safe as the default
// here — VITE_MAINNET_READ_RPC still overrides it if you later provision a
// paid RPC with better throughput.
const MAINNET_READ_RPC = import.meta.env?.VITE_MAINNET_READ_RPC || 'https://bsc.rpc.blxrbdn.com';
const _mainnetPublicClient = createPublicClient({ chain: bsc, transport: http(MAINNET_READ_RPC) });

/** A BSC mainnet read client, for the read-only/detection skills (Token Radar,
 * Wallet Tracker, Copy Trade detection) that make no transactions. */
export function getMainnetReadClient() {
  return _mainnetPublicClient;
}

const _USDT_BALANCE_OF_ABI = [{
  type: 'function', name: 'balanceOf', stateMutability: 'view',
  inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }],
}];

/**
 * Shared "is this the wallet I think it is" snapshot — added 2026-08-28,
 * the direct fix for a confirmed UX gap: a user with several identically-
 * labeled saved passkeys had no way to tell a previously-funded wallet
 * apart from an empty, orphaned one (see docs/venus-skill-revert-
 * investigation.md for the full incident) without a doomed attempt first.
 * Live reads only — never a write, never a signature, safe to call before
 * the user commits to anything. `usdtAddress` is passed in by the caller
 * (defiSkills.js's USDT_BSC) rather than imported here, so this module
 * doesn't need a hardcoded opinion about which token matters.
 */
export async function fetchWalletBalanceSnapshot(address, usdtAddress) {
  const [bnbRaw, usdtRaw] = await Promise.all([
    _mainnetPublicClient.getBalance({ address }),
    _mainnetPublicClient.readContract({ address: usdtAddress, abi: _USDT_BALANCE_OF_ABI, functionName: 'balanceOf', args: [address] }),
  ]);
  const bnb = Number(bnbRaw) / 1e18;
  const usdt = Number(usdtRaw) / 1e18;
  return { address, bnb, usdt, isEmpty: bnb === 0 && usdt === 0 };
}

// Standard Panic(uint256) codes (Solidity's own, per the ABI spec) — used by
// decodeAltanaExecutionError below so a Panic reason reads as plain
// English, not a bare integer.
const _PANIC_REASONS = {
  0x01n: 'an assert() failed',
  0x11n: 'arithmetic overflow/underflow',
  0x12n: 'division or modulo by zero',
  0x21n: 'an invalid enum value',
  0x22n: 'invalid storage byte array access',
  0x31n: 'pop() on an empty array',
  0x32n: 'an out-of-bounds array/index access',
  0x41n: 'out of memory',
  0x51n: 'called an uninitialized internal function',
};

/**
 * Decoding for an Altana `execute()` failure — added 2026-08-28 after a
 * confirmed incident: the Venus Lending skill failed with the SDK's own
 * raw "An error occurred while executing calls. Reason: 0x Details: 0x",
 * traced (by reading the installed @altananetwork/sdk's own dist/execute.js
 * and its `porto` dependency) to `ox`'s generic BaseError formatter, given
 * a genuinely EMPTY revert (`0x`) by the relay. That's not a decoding gap
 * on our side — `0x` really is the complete raw revert data the relay
 * received — but this project's own code was never trying to decode
 * anything beyond what the SDK already prints, so a decodable reason (when
 * one exists) was silently treated the same as a genuinely empty one. This
 * walks every hex string found anywhere in the thrown error (message,
 * `.data`, `.cause.data`, nested causes) and decodes the two standard
 * Solidity revert shapes (`Error(string)` and `Panic(uint256)`) when
 * present, returning a human-readable reason. Genuinely empty revert data
 * (`0x`, confirmed length 0) is reported as exactly that: an honest "no
 * on-chain reason at all" finding, most consistent with a session/
 * permission-scope rejection or an out-of-gas condition (see
 * docs/venus-skill-revert-investigation.md), never guessed at further than
 * the evidence supports.
 */
export function decodeAltanaExecutionError(error) {
  const rawStrings = [];
  let cur = error;
  let depth = 0;
  while (cur && depth < 6) {
    if (typeof cur.data === 'string') rawStrings.push(cur.data);
    if (typeof cur.message === 'string') rawStrings.push(cur.message);
    if (typeof cur.details === 'string') rawStrings.push(cur.details);
    cur = cur.cause;
    depth += 1;
  }

  // Hex blobs found anywhere above, longest first (a short "0x" is never
  // worth preferring over a longer, potentially-decodable one).
  const hexMatches = rawStrings
    .flatMap((s) => s.match(/0x[0-9a-fA-F]*/g) || [])
    .filter((h) => h.length > 2) // strip bare "0x" matches here; handled as the explicit empty case below
    .sort((a, b) => b.length - a.length);

  for (const hex of hexMatches) {
    try {
      if (size(hex) < 4) continue;
      const selector = hex.slice(0, 10);
      const rest = `0x${hex.slice(10)}`;
      if (selector === '0x08c379a0') {
        const [reason] = decodeAbiParameters([{ type: 'string' }], rest);
        return { decoded: true, reason: `On-chain revert reason: "${reason}"` };
      }
      if (selector === '0x4e487b71') {
        const [code] = decodeAbiParameters([{ type: 'uint256' }], rest);
        return { decoded: true, reason: `Solidity panic (code 0x${code.toString(16)}): ${_PANIC_REASONS[code] || 'an internal check failed'}.` };
      }
    } catch {
      // Not a decodable shape at this hex candidate — fall through to the next one.
    }
  }

  // Every hex candidate found was either literally "0x" or an unrecognized
  // custom-error selector we have no ABI for.
  const hadAnyData = rawStrings.some((s) => /0x[0-9a-fA-F]{2,}/.test(s));
  return {
    decoded: false,
    reason: hadAnyData
      ? 'This call reverted with revert data we don’t have a matching ABI to decode (a custom error, not a plain string or panic).'
      : 'This call reverted with genuinely NO on-chain reason at all (empty revert data) — most consistent with the session’s own permission/scope check rejecting the call before it ever reached the target contract, or an out-of-gas condition, rather than the target contract itself rejecting it.',
  };
}

/**
 * Executor ({ walletAddress, publicClient, execute(calls) }) — writes go
 * through the granted Altana session (one atomic relay intent), reads use
 * BSC mainnet. Added 2026-08-28: execute() failures now carry a
 * `.realReason` (see decodeAltanaExecutionError above) alongside the SDK's
 * own original message — never replacing it, always additive, so a
 * genuinely undecodable error still shows the SDK's own real text too.
 */
export function getAltanaExecutor(session) {
  return {
    mode: 'real',
    walletAddress: session.walletAddress,
    publicClient: _mainnetPublicClient,
    execute: async (calls) => {
      try {
        return await client.execute({ session, calls });
      } catch (e) {
        const { reason } = decodeAltanaExecutionError(e);
        e.realReason = reason;
        throw e;
      }
    },
  };
}

// Mainnet explorer, taken from the SDK's own NetworkConfig (bscscan.com),
// not hardcoded or guessed.
export const ALTANA_EXPLORER_URL = BNB.explorer;

/**
 * Confirmed bug fix (2026-08-28): `getOrCreateAltanaWallet()` used to be
 * one function — try `recoverFromPasskey`, and on ANY failure (a bare
 * `catch`), silently call `createPasskeyWallet()` instead. That conflated
 * two genuinely different situations the installed SDK's own
 * `recoverFromPasskey.js` explicitly distinguishes: a "nothing to recover"
 * case (no passkey exists) vs. a "recovery ran, but the result isn't
 * usable" case — most concretely, its own documented error: "Picked
 * passkey resolves to wallet X, but that wallet has no keys registered in
 * KeyStore yet. Either: (a) you picked the wrong passkey (the OS keychain
 * has multiple with similar names...), or (b)...". Confirmed live
 * incident this caused: a user with several identically-labeled saved
 * passkeys for this site (all just "Tnega") picked a different one than
 * her originally-funded wallet on a retry — the SDK correctly threw the
 * error above — and this project's own bare `catch` silently created yet
 * another brand-new, empty, session-less wallet in response, rather than
 * surfacing that specific, actionable error. Repeated across several
 * attempts, this is exactly how one user ended up with four separate
 * saved passkeys for one site, at least some of them orphaned, zero-
 * balance wallets — and exactly why a later Venus Lending attempt
 * reverted with no on-chain reason: a fresh wallet has no USDT, no BNB,
 * and no granted session at all, regardless of what's being called.
 *
 * A limitation this fix works within: the raw WebAuthn API itself does
 * not reliably distinguish "no passkey saved at all" from "user cancelled
 * the picker" — both surface as the same `NotAllowedError`. Not fixable
 * purely in our own code (a standard platform ambiguity), so the safe
 * fix is to never auto-create on ANY recovery failure — only on the
 * deliberate, explicit choice below.
 *
 * New shape: `recoverAltanaWallet()` only ever recovers (throws its own
 * specific error on failure, never silently creates anything);
 * `createNewAltanaWallet()` is a separate, explicit action a caller must
 * deliberately choose — every UI call site now requires the user to see
 * the recovery error first and consciously pick "create a new wallet
 * instead", never an automatic, invisible fallback.
 */
export async function recoverAltanaWallet() {
  return await client.recoverFromPasskey({ rpId: RP_ID });
}

// Added 2026-08-28 — the direct mitigation for the "four identically-
// labeled saved passkeys" confusion this whole investigation traced back
// to. Confirmed live (read the installed @altananetwork/sdk -> its own
// `porto` dependency's Key.createWebAuthnP256, node_modules/porto/dist/
// viem/Key.js): the `name` we pass here maps directly to the WebAuthn
// credential's own `user.name` AND `user.displayName` fields, exactly what
// a browser's saved-passkey picker shows to tell multiple credentials for
// the same site apart. This genuinely was controllable, not assumed.
//
// A limitation found and NOT worked around: the literal wallet address
// can't be embedded in this label. `createPasskeyWallet` generates its
// throwaway EOA (the address that becomes the smart-account address)
// inside itself, strictly after the name we pass in is already committed
// to the WebAuthn ceremony — there is no way to learn the address first
// through the SDK's own public API without reimplementing its internal
// EIP-7702 upgrade sequence ourselves, a meaningfully riskier change
// (duplicated, money-moving logic that could silently drift from the
// SDK's own behavior on a future update) for a cosmetic label. Not done.
// A creation-time label is used instead — genuinely distinguishable in the
// browser picker (unlike the flat, identical "Tnega" every prior wallet
// used), even though it can't carry the address itself.
function _distinctivePasskeyLabel() {
  const now = new Date();
  const stamp = now.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  return `${APP_NAME} — new wallet, ${stamp}`;
}

export async function createNewAltanaWallet() {
  return await client.createPasskeyWallet({ name: _distinctivePasskeyLabel(), rpId: RP_ID });
}

export async function getJobStatus(jobId) {
  return getErc8183Job(network, BigInt(jobId));
}

/** Freshly-measured average BSC block time (seconds/block), sampled off
 * two reads (current tip + 50,000 blocks back) rather than assumed. BSC's
 * block time has gotten materially faster over this project's lifetime
 * (confirmed live 2026-08-28: ~0.45s/block now, not the ~3s a naive
 * assumption would use), which is exactly what made the old fixed-depth
 * scan below go stale. */
async function _avgBlockTimeSeconds(publicClient, currentBlock) {
  const sampleBack = 50000n;
  const refBlock = currentBlock > sampleBack ? currentBlock - sampleBack : 1n;
  const [nowBlock, refBlockData] = await Promise.all([
    publicClient.getBlock({ blockNumber: currentBlock }),
    publicClient.getBlock({ blockNumber: refBlock }),
  ]);
  const seconds = Number(nowBlock.timestamp - refBlockData.timestamp);
  const blocks = Number(currentBlock - refBlock);
  return blocks > 0 && seconds > 0 ? seconds / blocks : 3; // sane fallback only if something's genuinely off
}

/** Scans [fromBlock, toBlock] in <=4000-block chunks (this RPC's confirmed
 * cap is 5000/call — kept under it) for the job's JobInitialised event,
 * parsing optParams the same way the SDK's own getErc8183DeliverableUrl
 * does. */
async function _scanForDeliverableUrl(publicClient, policyAddress, jobId, fromBlock, toBlock) {
  const CHUNK = 4000n;
  let hi = toBlock;
  while (hi >= fromBlock) {
    const lo = hi - CHUNK + 1n > fromBlock ? hi - CHUNK + 1n : fromBlock;
    const logs = await publicClient.getLogs({
      address: policyAddress,
      event: JOB_INITIALISED_EVENT,
      args: { jobId: BigInt(jobId) },
      fromBlock: lo,
      toBlock: hi,
    });
    if (logs.length > 0) {
      const optParams = logs[0].args.optParams;
      if (!optParams || optParams === '0x') return undefined;
      try {
        const decoded = hexToString(optParams).replace(/\0+$/, '');
        const parsed = JSON.parse(decoded);
        return typeof parsed.deliverable_url === 'string' ? parsed.deliverable_url : undefined;
      } catch {
        return undefined;
      }
    }
    if (lo === fromBlock) break;
    hi = lo - 1n;
  }
  return undefined;
}

/** The deliverable URL a provider submitted for a job (parsed from the
 * policy's on-chain event), or undefined if none yet. Read-only.
 *
 * Bug fixed 2026-08-20: this used the plain `network` object (BNB's
 * default publicRpcUrl, bsc-rpc.publicnode.com), NOT MAINNET_READ_RPC,
 * even though the exact same "publicnode refuses getLogs" problem is
 * already documented and solved above for copy-trade/wallet-tracker.
 * Confirmed directly (Node, real RPC calls, job #56620): publicnode
 * rejects it outright ("Archive requests require a personal token"), and
 * several other free/keyless public RPCs tried (bsc-dataseed, meowrpc,
 * 1rpc, nodereal, blockpi, bscrpc) ALL failed too, each for its own
 * reason — this needs a properly provisioned RPC, not a public default.
 * Routing through the same working MAINNET_READ_RPC this file already
 * uses for getLogs elsewhere.
 *
 * Bug found and fixed 2026-08-28 (job #56646's deliverable silently
 * stopped showing, not a domain-move regression, confirmed by tracing the
 * cause): the installed SDK's getErc8183DeliverableUrl() scans backward
 * from "now" in window=1000 chunks, capped at maxWindows=200, a fixed
 * 200,000-block lookback. That was fine when BSC produced blocks every
 * ~3s, but block time is now ~0.45s (measured live), so 200,000 blocks
 * covers barely one day. Confirmed directly against job #56646 (submitted
 * 27.6h earlier): a byte-for-byte replica of the SDK's own scan logic ran
 * clean (zero RPC errors, so this was never an archive-access problem)
 * but genuinely found nothing, the submission block was ~220,000 blocks
 * back, just past the 200,000-block wall. The on-chain event and the
 * MongoDB-backed deliverable were both fine the whole time; only this
 * lookback depth had gone stale.
 *
 * Fix: use the job's own submittedAt timestamp (already a free read via
 * getErc8183Job) plus a freshly-measured block time to jump to an
 * estimated block instead of blindly walking back from "now", then scan a
 * bounded, progressively-widening window around that estimate. Finds a
 * job of any age, a day old or a year old, in a handful of getLogs calls
 * instead of a lookback depth that silently expires as time passes. Falls
 * back to the SDK's own original scan only as a last resort (e.g. a job
 * so new the estimate undershoots). */
export async function getDeliverable(jobId) {
  const netWithRpc = { ...network, publicRpcUrl: MAINNET_READ_RPC };
  const job = await getErc8183Job(netWithRpc, BigInt(jobId));
  if (!job || job.submittedAt === 0n) return undefined;

  try {
    const addresses = erc8183Addresses(network.chainId);
    const currentBlock = await _mainnetPublicClient.getBlockNumber();
    const [avgBlockTime, currentBlockData] = await Promise.all([
      _avgBlockTimeSeconds(_mainnetPublicClient, currentBlock),
      _mainnetPublicClient.getBlock({ blockNumber: currentBlock }),
    ]);
    const secondsAgo = Math.max(0, Number(currentBlockData.timestamp) - Number(job.submittedAt));
    const estimatedBlocksAgo = BigInt(Math.ceil(secondsAgo / avgBlockTime));
    const estimatedBlock = currentBlock > estimatedBlocksAgo ? currentBlock - estimatedBlocksAgo : 1n;

    for (const margin of [8000n, 40000n, 200000n]) {
      const from = estimatedBlock > margin ? estimatedBlock - margin : 1n;
      const to = estimatedBlock + margin < currentBlock ? estimatedBlock + margin : currentBlock;
      const url = await _scanForDeliverableUrl(_mainnetPublicClient, addresses.policy, jobId, from, to);
      if (url) return url;
    }
  } catch (e) {
    console.warn('[getDeliverable] estimated-block scan failed, falling back to the SDK default scan:', e);
  }

  // Last-resort fallback: the SDK's own original (fast, recent-only) scan.
  return getErc8183DeliverableUrl(netWithRpc, BigInt(jobId));
}

export function explorerLinkForWallet(address) {
  // bscscan.com/address/{addr} is the standard explorer path.
  return `${BNB.explorer}/address/${address}`;
}

/**
 * Grants a scoped session (spend cap + expiry + allowlisted contracts) for
 * whatever contracts and spend token a specific Skill declares (from the
 * Skills Registry's own `scope` field). Still genuinely used today by the
 * x402-payments Skill specifically — see this file's own top-of-file note
 * for why every other Altana-session use case was removed but this one
 * wasn't.
 */
export async function grantSkillSession(wallet, adminSigner, { contractAddresses, spendToken, spendCapUnits, expiryHours = 24 }) {
  return client.grantSession({
    wallet,
    signer: adminSigner,
    permissions: {
      calls: contractAddresses.map((to) => ({ to })),
      spend: [{
        limit: BigInt(Math.round(spendCapUnits * 1e18)),
        period: 'day',
        token: spendToken,
      }],
    },
    expiry: Math.floor(Date.now() / 1000) + expiryHours * 3600,
  });
}
