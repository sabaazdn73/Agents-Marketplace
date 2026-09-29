// sign/tokenMeta.js
//
// A token's decimals() never change, so once a value has been CHECKED it is
// kept: in memory for this page, and in this tab's sessionStorage
// (tnega_tokmeta_v2:<chain>:<address>:decimals) so a reload does not read it
// again. A blocked or full store is survived: memory only.
//
// NOTHING IS KEPT UNCHECKED. readDecimals only reads (from the kept value if
// there is one); the page calls commitDecimals once the value agrees with the
// order and with this site's list, and forgetDecimals when it does not. So
// one wrong answer from one endpoint is never remembered: found 2026-09-29,
// when a value was kept before the check and a single bad answer refused
// every later order for that token for the rest of the tab session.

import { readContract } from 'wagmi/actions';
import { erc20Abi } from 'viem';

const memory = new Map();
const key = (chainId, address) => `tnega_tokmeta_v2:${chainId}:${String(address).toLowerCase()}:decimals`;

function fromSession(k) {
  try { const v = window.sessionStorage.getItem(k); return v == null ? null : Number(JSON.parse(v)); } catch { return null; }
}

/** decimals() of a token: the checked value if one is kept, else a read.
 *  `client` (a viem public client) reads instead of the wagmi config, for a
 *  second opinion from other endpoints; `fresh` skips the kept value. */
export async function readDecimals(config, chainId, address, { fresh = false, client = null } = {}) {
  const k = key(chainId, address);
  if (!fresh) {
    if (memory.has(k)) return memory.get(k);
    const s = fromSession(k);
    if (Number.isInteger(s)) { memory.set(k, s); return s; }
  }
  const req = { address, abi: erc20Abi, functionName: 'decimals' };
  const v = client ? await client.readContract(req) : await readContract(config, { chainId, ...req });
  return Number(v);
}

/** Keep a value that has passed the page's check. */
export function commitDecimals(chainId, address, value) {
  const k = key(chainId, address);
  memory.set(k, value);
  try { window.sessionStorage.setItem(k, JSON.stringify(value)); } catch { /* blocked or full: memory only */ }
}

/** Drop a kept value (it did not pass the check). */
export function forgetDecimals(chainId, address) {
  const k = key(chainId, address);
  memory.delete(k);
  try { window.sessionStorage.removeItem(k); } catch { /* blocked */ }
}
