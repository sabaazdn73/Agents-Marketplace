// rpcTransport.js
//
// The one, real, shared BSC mainnet read transport — bloXroute as primary,
// a real Infura BSC endpoint (bsc-mainnet.infura.io) as an automatic backup
// via viem's own `fallback()` transport, added 2026-09-04.
//
// Real, confirmed reason this exists: wagmiConfig.js and altana.js each
// independently hardcoded their own single-URL `http(MAINNET_READ_RPC)`
// transport (bloXroute only, no backup) — see wagmiConfig.js's own
// 2026-08-29 bug comment for the real incident this caused (a direct-
// wallet Venus Lending run timed out waiting on a slow/unreachable
// primary, with nothing to fail over to). This is the one, shared place
// that transport now lives, so both callers get the same real failover,
// not two independently-maintained copies.
//
// `fallback()` is used in `{ rank: false }` mode deliberately: bloXroute
// is ALWAYS tried first, never reordered by measured latency/uptime — the
// same "in order, not ranked" requirement core/rpc.py's own backend
// version follows. Infura only gets a real request when bloXroute's own
// attempt genuinely fails (a real timeout, network error, or malformed/
// error RPC response) within its own real, short timeout, so a slow
// primary can't stall the app waiting to fail over.
import { http, fallback } from 'viem';

const PRIMARY_RPC = import.meta.env?.VITE_MAINNET_READ_RPC || 'https://bsc.rpc.blxrbdn.com';
const INFURA_API_KEY = import.meta.env?.VITE_INFURA_API_KEY;
const BACKUP_RPC = INFURA_API_KEY ? `https://bsc-mainnet.infura.io/v3/${INFURA_API_KEY}` : null;

// A few seconds, not a stall — short enough that a real user waiting on a
// balance read or a tx receipt poll isn't stuck behind a dead primary for
// the default 10s viem would otherwise allow before this backup ever gets
// a chance to answer.
const PRIMARY_TIMEOUT_MS = 5_000;

export const MAINNET_READ_RPC = PRIMARY_RPC;

/** The real, shared BSC mainnet transport every read in this app should
 * use. Without a real `VITE_INFURA_API_KEY` configured, this is exactly
 * the same single-URL bloXroute transport both call sites already used —
 * a missing key never breaks anything, it just means no real backup
 * exists yet. With one configured, bloXroute is still always tried
 * first; Infura only ever engages on a real primary failure. */
export function getBscTransport() {
  const primary = http(PRIMARY_RPC, { timeout: PRIMARY_TIMEOUT_MS });
  if (!BACKUP_RPC) return primary;
  const backup = http(BACKUP_RPC);
  return fallback([primary, backup], { rank: false });
}
