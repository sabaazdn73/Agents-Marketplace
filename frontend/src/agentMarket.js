// agentMarket.js
//
// Client integration with the AgentAccessMarket contract (contracts/src/
// AgentAccessMarket.sol) — the "Sell Your Agent" creator economy. Shared
// hooks live here so the web and mobile apps drive identical logic and can
// never drift; each app only renders thin presentational UI on top.
//
// Models 1 (one-time license) and 2 (subscription) are on-chain here. Model 3
// (x402 pay-per-call) settles off this contract via the existing x402 path and
// is handled as configuration, not a contract call.
//
// The contract is NOT yet deployed to mainnet (tested on the Practice/Anvil
// fork only). Its address is read from VITE_AGENT_MARKET_ADDRESS; until that is
// set, isMarketConfigured() is false and the UI shows an honest "not yet live
// on this network" state instead of pretending to transact.

import { useEffect, useState, useCallback } from 'react';
import { useAccount, useWriteContract, usePublicClient } from 'wagmi';

export const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'; // ERC-8004 AgentIdentity
// Payment token the deployed contract settles in (must match the contract's
// immutable paymentToken). Defaults to $U (United Stables); override per deploy.
export const PAYMENT_TOKEN = import.meta.env?.VITE_AGENT_MARKET_TOKEN || '0xcE24439F2D9C6a2289F741120FE202248B666666';
export const MARKET_ADDRESS = import.meta.env?.VITE_AGENT_MARKET_ADDRESS || '';

export const MODEL = { NONE: 0, ONE_TIME: 1, SUBSCRIPTION: 2 };
export const isMarketConfigured = () => /^0x[0-9a-fA-F]{40}$/.test(MARKET_ADDRESS);

export const MARKET_ABI = [
  { type: 'function', name: 'list', stateMutability: 'nonpayable', inputs: [{ name: 'agentId', type: 'uint256' }, { name: 'model', type: 'uint8' }, { name: 'price', type: 'uint256' }, { name: 'period', type: 'uint64' }], outputs: [] },
  { type: 'function', name: 'buyOneTime', stateMutability: 'nonpayable', inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'subscribe', stateMutability: 'nonpayable', inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'setListingActive', stateMutability: 'nonpayable', inputs: [{ name: 'agentId', type: 'uint256' }, { name: 'active', type: 'bool' }], outputs: [] },
  { type: 'function', name: 'hasAccess', stateMutability: 'view', inputs: [{ name: 'agentId', type: 'uint256' }, { name: 'buyer', type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'listings', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ name: 'creator', type: 'address' }, { name: 'model', type: 'uint8' }, { name: 'price', type: 'uint256' }, { name: 'period', type: 'uint64' }, { name: 'active', type: 'bool' }] },
  { type: 'function', name: 'accessExpiry', stateMutability: 'view', inputs: [{ type: 'uint256' }, { type: 'address' }], outputs: [{ type: 'uint64' }] },
];
export const ERC20_ABI = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
];
export const REGISTRY_ABI = [
  { type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }] },
];

/** Parse a decimal price string into raw token units (default 18 decimals). */
export function toRawUnits(amountStr, decimals = 18) {
  const [whole, frac = ''] = String(amountStr).trim().split('.');
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt((whole || '0') + fracPadded);
}
export function fromRawUnits(raw, decimals = 18) {
  const s = (BigInt(raw)).toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

/**
 * Real on-chain ownership check against the ERC-8004 registry — the same guard
 * the contract enforces in list(). Lets the listing form verify the connected
 * wallet genuinely owns the agent BEFORE offering to list it (works today, even
 * before our own contract is deployed).
 */
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

/** Read the on-chain listing for an agent (if the market is deployed). */
export function useListing(agentIdStr) {
  const publicClient = usePublicClient();
  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    const id = (agentIdStr || '').trim();
    if (!isMarketConfigured() || !id || !/^\d+$/.test(id) || !publicClient) { setListing(null); return; }
    setLoading(true);
    try {
      const r = await publicClient.readContract({ address: MARKET_ADDRESS, abi: MARKET_ABI, functionName: 'listings', args: [BigInt(id)] });
      const [creator, model, price, period, active] = r;
      setListing({ creator, model: Number(model), price, period: Number(period), active, exists: Number(model) !== MODEL.NONE });
    } catch { setListing(null); }
    finally { setLoading(false); }
  }, [agentIdStr, publicClient]);

  useEffect(() => { refresh(); }, [refresh]);
  return { listing, loading, refresh };
}

/** Whether the connected wallet currently has access to an agent. */
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

/** Create a listing for an agent you own (models 1 & 2). */
export function useListAgent() {
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const listAgent = useCallback(async ({ agentId, model, priceRaw, periodSeconds }) => {
    setBusy(true); setError(null);
    try {
      const hash = await writeContractAsync({
        address: MARKET_ADDRESS, abi: MARKET_ABI, functionName: 'list',
        args: [BigInt(agentId), model, priceRaw, BigInt(periodSeconds || 0)],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      return hash;
    } catch (e) { setError(e.shortMessage || e.message || String(e)); throw e; }
    finally { setBusy(false); }
  }, [writeContractAsync, publicClient]);
  return { listAgent, busy, error };
}

/** Buy/subscribe: approve the payment token if needed, then call the contract. */
export function useBuyAccess() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(null); // 'approving' | 'buying'
  const [error, setError] = useState(null);

  const buy = useCallback(async ({ agentId, model, priceRaw }) => {
    setBusy(true); setError(null);
    try {
      const allowance = await publicClient.readContract({ address: PAYMENT_TOKEN, abi: ERC20_ABI, functionName: 'allowance', args: [address, MARKET_ADDRESS] });
      if (BigInt(allowance) < BigInt(priceRaw)) {
        setStep('approving');
        const ah = await writeContractAsync({ address: PAYMENT_TOKEN, abi: ERC20_ABI, functionName: 'approve', args: [MARKET_ADDRESS, priceRaw] });
        await publicClient.waitForTransactionReceipt({ hash: ah });
      }
      setStep('buying');
      const fn = model === MODEL.SUBSCRIPTION ? 'subscribe' : 'buyOneTime';
      const hash = await writeContractAsync({ address: MARKET_ADDRESS, abi: MARKET_ABI, functionName: fn, args: [BigInt(agentId)] });
      await publicClient.waitForTransactionReceipt({ hash });
      return hash;
    } catch (e) { setError(e.shortMessage || e.message || String(e)); throw e; }
    finally { setBusy(false); setStep(null); }
  }, [address, writeContractAsync, publicClient]);

  return { buy, busy, step, error };
}
