// agentMarket.js
//
// Client integration with the AgentAccessMarket contract (multi-token). Shared
// hooks live here so web and mobile drive identical logic and can't drift.
//
// Multi-token, buyer's choice, NO swap: a creator can price the same agent in
// several accepted tokens (one offer per token); the BUYER picks which token to
// pay with. Native BNB is the NATIVE sentinel (paid via msg.value); ERC-20s
// (real USDT + live $U) are approved + pulled. The contract address is read
// from VITE_AGENT_MARKET_ADDRESS; until it's set the UI shows an honest "not
// live on this network yet" state.

import { useEffect, useState, useCallback } from 'react';
import { useAccount, useWriteContract, usePublicClient } from 'wagmi';
import { ERC8183_ADDRESSES } from '@altananetwork/sdk';

export const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'; // ERC-8004 AgentIdentity
export const NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'; // == contract NATIVE sentinel
// Real BSC mainnet deployment (13 Aug 2026, tx 0xa94fca60…d522c26). Public,
// permanent address — used as the default; VITE_AGENT_MARKET_ADDRESS can still
// override (e.g. pointing at a fork for testing).
export const MARKET_ADDRESS = import.meta.env?.VITE_AGENT_MARKET_ADDRESS || '0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333';

// $U read LIVE from the installed Altana SDK (not a hardcoded, possibly-stale
// address); falls back to the known value only if the SDK read fails.
let _U;
try { _U = ERC8183_ADDRESSES[56].paymentToken; } catch { _U = '0xcE24439F2D9C6a2289F741120FE202248B666666'; }

// The fixed, pre-approved payment whitelist (matches the contract's constructor).
export const ACCEPTED_TOKENS = [
  { symbol: 'BNB', address: NATIVE, native: true, decimals: 18 },
  { symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', native: false, decimals: 18 },
  { symbol: '$U', address: _U, native: false, decimals: 18 },
];
export const tokenByAddress = (a) => ACCEPTED_TOKENS.find((t) => t.address.toLowerCase() === (a || '').toLowerCase());
// x402 config default token ($U).
export const PAYMENT_TOKEN = _U;

export const MODEL = { NONE: 0, ONE_TIME: 1, SUBSCRIPTION: 2 };
export const isMarketConfigured = () => /^0x[0-9a-fA-F]{40}$/.test(MARKET_ADDRESS);

export const MARKET_ABI = [
  { type: 'function', name: 'list', stateMutability: 'nonpayable', inputs: [{ name: 'agentId', type: 'uint256' }, { name: 'token', type: 'address' }, { name: 'model', type: 'uint8' }, { name: 'price', type: 'uint256' }, { name: 'period', type: 'uint64' }], outputs: [] },
  { type: 'function', name: 'buyOneTime', stateMutability: 'payable', inputs: [{ name: 'agentId', type: 'uint256' }, { name: 'token', type: 'address' }], outputs: [] },
  { type: 'function', name: 'subscribe', stateMutability: 'payable', inputs: [{ name: 'agentId', type: 'uint256' }, { name: 'token', type: 'address' }], outputs: [] },
  { type: 'function', name: 'setOfferActive', stateMutability: 'nonpayable', inputs: [{ name: 'agentId', type: 'uint256' }, { name: 'token', type: 'address' }, { name: 'active', type: 'bool' }], outputs: [] },
  { type: 'function', name: 'hasAccess', stateMutability: 'view', inputs: [{ name: 'agentId', type: 'uint256' }, { name: 'buyer', type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'offers', stateMutability: 'view', inputs: [{ type: 'uint256' }, { type: 'address' }], outputs: [{ name: 'model', type: 'uint8' }, { name: 'price', type: 'uint256' }, { name: 'period', type: 'uint64' }, { name: 'active', type: 'bool' }] },
  { type: 'function', name: 'agentCreator', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'accessExpiry', stateMutability: 'view', inputs: [{ type: 'uint256' }, { type: 'address' }], outputs: [{ type: 'uint64' }] },
  { type: 'function', name: 'acceptedTokens', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'feeBps', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint16' }] },
  { type: 'function', name: 'creatorBalance', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'withdrawCreatorBalance', stateMutability: 'nonpayable', inputs: [{ name: 'token', type: 'address' }], outputs: [] },
];
export const ERC20_ABI = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
];
export const REGISTRY_ABI = [
  { type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }] },
];

export function toRawUnits(amountStr, decimals = 18) {
  const [whole, frac = ''] = String(amountStr).trim().split('.');
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt((whole || '0') + fracPadded);
}
export function fromRawUnits(raw, decimals = 18) {
  const s = BigInt(raw).toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}
export function splitByFee(priceRaw, feeBps) {
  if (feeBps == null) return { fee: null, creatorGets: null };
  const p = BigInt(priceRaw);
  const fee = (p * BigInt(feeBps)) / 10000n;
  return { fee, creatorGets: p - fee };
}

/** Live platform fee from feeBps() — never hardcoded. */
export function useFeeBps() {
  const publicClient = usePublicClient();
  const [feeBps, setFeeBps] = useState(null);
  useEffect(() => {
    if (!isMarketConfigured() || !publicClient) { setFeeBps(null); return; }
    let cancelled = false;
    publicClient.readContract({ address: MARKET_ADDRESS, abi: MARKET_ABI, functionName: 'feeBps' })
      .then((v) => { if (!cancelled) setFeeBps(Number(v)); })
      .catch(() => { if (!cancelled) setFeeBps(null); });
    return () => { cancelled = true; };
  }, [publicClient]);
  return { feeBps, feePct: feeBps == null ? null : feeBps / 100 };
}

/** On-chain ownership check against the ERC-8004 registry (same guard the contract enforces). */
export function useAgentOwnership(agentIdStr) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const [state, setState] = useState({ status: 'idle', owner: null, isOwner: false });
  useEffect(() => {
    const id = (agentIdStr || '').trim();
    if (!id || !/^\d+$/.test(id) || !publicClient) { setState({ status: 'idle', owner: null, isOwner: false }); return; }
    let cancelled = false;
    setState({ status: 'checking', owner: null, isOwner: false });
    publicClient.readContract({ address: REGISTRY, abi: REGISTRY_ABI, functionName: 'ownerOf', args: [BigInt(id)] })
      .then((owner) => { if (!cancelled) setState({ status: 'done', owner, isOwner: !!address && owner.toLowerCase() === address.toLowerCase() }); })
      .catch(() => { if (!cancelled) setState({ status: 'notfound', owner: null, isOwner: false }); });
    return () => { cancelled = true; };
  }, [agentIdStr, address, publicClient]);
  return state;
}

/** Read every accepted token's offer for an agent — the buyer's token choices. */
export function useOffers(agentIdStr) {
  const publicClient = usePublicClient();
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    const id = (agentIdStr || '').trim();
    if (!isMarketConfigured() || !id || !/^\d+$/.test(id) || !publicClient) { setOffers([]); return; }
    setLoading(true);
    try {
      const rows = await Promise.all(ACCEPTED_TOKENS.map(async (t) => {
        const [model, price, period, active] = await publicClient.readContract({ address: MARKET_ADDRESS, abi: MARKET_ABI, functionName: 'offers', args: [BigInt(id), t.address] });
        return { ...t, model: Number(model), price, period: Number(period), active, exists: Number(model) !== MODEL.NONE };
      }));
      setOffers(rows.filter((r) => r.exists));
    } catch { setOffers([]); }
    finally { setLoading(false); }
  }, [agentIdStr, publicClient]);
  useEffect(() => { refresh(); }, [refresh]);
  return { offers, loading, refresh };
}

/** Whether the connected wallet currently has access to an agent (token-agnostic). */
export function useHasAccess(agentIdStr) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const [access, setAccess] = useState(null);
  const refresh = useCallback(async () => {
    const id = (agentIdStr || '').trim();
    if (!isMarketConfigured() || !address || !id || !/^\d+$/.test(id) || !publicClient) { setAccess(null); return; }
    try {
      const [ok, expiry] = await Promise.all([
        publicClient.readContract({ address: MARKET_ADDRESS, abi: MARKET_ABI, functionName: 'hasAccess', args: [BigInt(id), address] }),
        publicClient.readContract({ address: MARKET_ADDRESS, abi: MARKET_ABI, functionName: 'accessExpiry', args: [BigInt(id), address] }),
      ]);
      setAccess({ hasAccess: ok, expiry: Number(expiry) });
    } catch { setAccess(null); }
  }, [agentIdStr, address, publicClient]);
  useEffect(() => { refresh(); }, [refresh]);
  return { access, refresh };
}

/** Create/update an offer for an agent you own, in a chosen accepted token. */
export function useListAgent() {
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const listAgent = useCallback(async ({ agentId, token, model, priceRaw, periodSeconds }) => {
    setBusy(true); setError(null);
    try {
      const hash = await writeContractAsync({ address: MARKET_ADDRESS, abi: MARKET_ABI, functionName: 'list', args: [BigInt(agentId), token, model, priceRaw, BigInt(periodSeconds || 0)] });
      await publicClient.waitForTransactionReceipt({ hash });
      return hash;
    } catch (e) { setError(e.shortMessage || e.message || String(e)); throw e; }
    finally { setBusy(false); }
  }, [writeContractAsync, publicClient]);
  return { listAgent, busy, error };
}

/** Reads the connected creator's withdrawable balance in every accepted token. */
export function useCreatorEarnings() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const [rows, setRows] = useState([]);
  const refresh = useCallback(async () => {
    if (!isMarketConfigured() || !address || !publicClient) { setRows([]); return; }
    try {
      const r = await Promise.all(ACCEPTED_TOKENS.map(async (t) => {
        const balance = await publicClient.readContract({ address: MARKET_ADDRESS, abi: MARKET_ABI, functionName: 'creatorBalance', args: [t.address, address] });
        return { ...t, balance };
      }));
      setRows(r);
    } catch { setRows([]); }
  }, [address, publicClient]);
  useEffect(() => { refresh(); }, [refresh]);
  return { rows, refresh };
}

/** Read every accepted token's offer for one agent (plain async, for looping). */
export async function readAgentOffers(publicClient, agentId) {
  const rows = await Promise.all(ACCEPTED_TOKENS.map(async (t) => {
    const [model, price, period, active] = await publicClient.readContract({ address: MARKET_ADDRESS, abi: MARKET_ABI, functionName: 'offers', args: [BigInt(agentId), t.address] });
    return { ...t, model: Number(model), price, period: Number(period), active, exists: Number(model) !== MODEL.NONE };
  }));
  return rows.filter((r) => r.exists);
}

/** Creator write actions: withdraw earnings per token, pause/resume an offer. */
export function useCreatorWrites() {
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const [busy, setBusy] = useState(null); // key of the in-flight action
  const [error, setError] = useState(null);
  const _run = useCallback(async (key, fn, args) => {
    setBusy(key); setError(null);
    try {
      const hash = await writeContractAsync({ address: MARKET_ADDRESS, abi: MARKET_ABI, functionName: fn, args });
      await publicClient.waitForTransactionReceipt({ hash });
      return hash;
    } catch (e) { setError(e.shortMessage || e.message || String(e)); throw e; }
    finally { setBusy(null); }
  }, [writeContractAsync, publicClient]);
  const withdraw = useCallback((token) => _run('wd:' + token, 'withdrawCreatorBalance', [token]), [_run]);
  const setOfferActive = useCallback((agentId, token, active) => _run(`of:${agentId}:${token}`, 'setOfferActive', [BigInt(agentId), token, active]), [_run]);
  return { withdraw, setOfferActive, busy, error };
}

// Real, ordered step keys for the buy/subscribe flow. 'approving' is
// genuinely conditional: never runs for native BNB (paid via msg.value,
// nothing to approve), and skipped for ERC-20 when the existing allowance
// already covers the price.
export const BUY_STEPS = ['approving', 'buying'];

/** Buy/subscribe in a chosen token: native via msg.value, ERC-20 via approve+call.
 * Tracks the same real per-step state as useHireAgent (completedSteps/
 * skippedSteps/stepHashes) so BuyAccessPanel can drive an honest
 * StepChecklist instead of a single "Approving…/Confirming…" label. */
export function useBuyAccess() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(null);
  const [error, setError] = useState(null);
  const [completedSteps, setCompletedSteps] = useState([]);
  const [skippedSteps, setSkippedSteps] = useState([]);
  const [stepHashes, setStepHashes] = useState({});

  const writeAndConfirm = useCallback(async (stepKey, params) => {
    const hash = await writeContractAsync(params);
    setStepHashes((prev) => ({ ...prev, [stepKey]: hash }));
    await publicClient.waitForTransactionReceipt({ hash });
    setCompletedSteps((prev) => [...prev, stepKey]);
    return hash;
  }, [writeContractAsync, publicClient]);

  const buy = useCallback(async ({ agentId, token, native, model, priceRaw }) => {
    setBusy(true); setError(null);
    setCompletedSteps([]); setSkippedSteps([]); setStepHashes({});
    try {
      const fn = model === MODEL.SUBSCRIPTION ? 'subscribe' : 'buyOneTime';
      if (native) {
        // Nothing to approve for native BNB — it's paid via msg.value on
        // the same call, so this run genuinely never has an approve step.
        setSkippedSteps(['approving']);
        setStep('buying');
        const hash = await writeAndConfirm('buying', { address: MARKET_ADDRESS, abi: MARKET_ABI, functionName: fn, args: [BigInt(agentId), token], value: BigInt(priceRaw) });
        setStep('done');
        return hash;
      }
      const allowance = await publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'allowance', args: [address, MARKET_ADDRESS] });
      if (BigInt(allowance) < BigInt(priceRaw)) {
        setStep('approving');
        await writeAndConfirm('approving', { address: token, abi: ERC20_ABI, functionName: 'approve', args: [MARKET_ADDRESS, priceRaw] });
      } else {
        setSkippedSteps((prev) => [...prev, 'approving']);
      }
      setStep('buying');
      const hash = await writeAndConfirm('buying', { address: MARKET_ADDRESS, abi: MARKET_ABI, functionName: fn, args: [BigInt(agentId), token] });
      setStep('done');
      return hash;
    } catch (e) { setError(e.shortMessage || e.message || String(e)); throw e; }
    finally { setBusy(false); }
  }, [address, writeAndConfirm, publicClient]);

  return { buy, busy, step, error, completedSteps, skippedSteps, stepHashes };
}

// Honest, wallet-matched copy per step. {amount}/{symbol} are filled in by
// buildBuyStepList from the real offer being purchased.
const BUY_STEP_COPY = {
  approving: { label: 'Allow the payment', description: "Giving permission to set aside up to {amount} {symbol} — this doesn't spend anything yet, it just unlocks the next step" },
  buying: { label: 'Pay & unlock access', description: 'Final step — this pays {amount} {symbol} to unlock access' },
};

/** Builds the real, current step list for <StepChecklist/>, straight from
 * useBuyAccess's own state. */
export function buildBuyStepList({ step, completedSteps, skippedSteps, stepHashes, error, amount, symbol }) {
  return BUY_STEPS.map((key) => {
    const copy = BUY_STEP_COPY[key];
    const fill = (s) => s.replace('{amount}', amount ?? '').replace('{symbol}', symbol ?? '');
    let status = 'pending';
    if (completedSteps.includes(key)) status = 'complete';
    else if (skippedSteps.includes(key)) status = 'skipped';
    else if (step === key) status = error ? 'error' : 'active';
    return {
      key, label: fill(copy.label), description: fill(copy.description),
      status,
      hash: stepHashes[key] || null,
      reason: key === 'approving' && status === 'skipped'
        ? (symbol === 'BNB' ? 'Paying with BNB directly — no approval needed' : 'Already approved — skipped')
        : null,
      errorMessage: status === 'error' ? error : null,
    };
  });
}
