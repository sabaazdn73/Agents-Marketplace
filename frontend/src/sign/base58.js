// sign/base58.js
//
// Bitcoin-alphabet base58, decode only, for checking that a Solana address
// or signature is what it says it is. Plain module with no dependencies, so
// the order parser (sign/solanaOrder.js) does not pull @solana/web3.js into
// the pages that never sign on Solana.

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MAP = new Map([...ALPHABET].map((c, i) => [c, i]));

/** The bytes a base58 string stands for, or null if it is not base58. */
export function base58Decode(str) {
  if (typeof str !== 'string' || str.length === 0) return null;
  const bytes = []; // little-endian
  for (const ch of str) {
    const v = MAP.get(ch);
    if (v === undefined) return null;
    let carry = v;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  // Each leading '1' is one leading zero byte.
  for (let i = 0; i < str.length && str[i] === '1'; i += 1) bytes.push(0);
  return Uint8Array.from(bytes.reverse());
}

/** A Solana address: base58 of exactly 32 bytes. */
export function isSolanaAddress(str) {
  if (typeof str !== 'string' || str.length < 32 || str.length > 44) return false;
  const b = base58Decode(str);
  return !!b && b.length === 32;
}

/** A Solana transaction signature: base58 of exactly 64 bytes. */
export function isSolanaSignature(str) {
  if (typeof str !== 'string' || str.length < 80 || str.length > 90) return false;
  const b = base58Decode(str);
  return !!b && b.length === 64;
}
