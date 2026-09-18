// filter.js
//
// The membership test, and nothing else. No network, no storage, no DOM.
//
// WHY THE EXTENSION HOLDS A LIST AT ALL
// The alternative is to send every address on every page to our server, which
// would tell us which explorer pages you visit. The privacy policy says we do
// not, so the decision has to happen here.
//
// THIS MUST AGREE WITH THE SERVER, BIT FOR BIT
// backend/core/extension/membership.py builds the filter and holds a reference
// implementation of this same test, called `member`. The two hash the same
// way on purpose: SHA-256 of the key, the first eight bytes as h1, the next
// eight as h2 forced odd, then k positions at (h1 + i*h2) mod m. If either
// side changes, both change in the same commit, or every lookup silently
// misses and the extension goes quiet rather than erroring.
//
// h2 IS FORCED ODD AND THAT IS NOT DECORATION
// m is rounded up to a whole number of bytes, so it is always even. An even h2
// shares a factor with an even m and the probe sequence walks only half the
// filter, which pushes the realised false positive rate above the target
// without anything appearing to be wrong.
//
// KEY SPACES
//   o:<lowercase 0x address>   owns a registered agent
//   j:<lowercase 0x address>   named as provider on an ERC-8183 job
//   h:<lowercase 0x address>   in the Hyperliquid collector's set
//   a:<chain slug>:<token id>  one agent page on 8004scan
//
// LOWERCASE IS LOAD BEARING
// Etherscan-family URLs carry EIP-55 checksummed addresses. The server keys
// everything lowercase. A key built without toLowerCase() misses every time,
// and misses look exactly like "not covered", so this would fail silently and
// completely. The one place that builds an address key is `addressKey` below,
// so there is one line to get wrong rather than eight.
//
// Solana addresses are deliberately absent from every key space: base58 is
// case sensitive, so the normalisation above would destroy them. No Solana
// site is in the manifest, so nothing is lost today. If one is ever added it
// needs its own key space with its own rules.

/* exported TnegaFilter */
const TnegaFilter = (() => {
  /** base64 to bytes, without fetch or Blob, because this runs in a service
   *  worker and in content scripts and atob is the one path available in
   *  both. */
  function decode(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /** SHA-256 is async in the browser (crypto.subtle), and a membership test
   *  that returns a promise is still cheap: one page view asks once. */
  async function positions(key, m, k) {
    const bytes = new TextEncoder().encode(key);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    // BigInt rather than Number: h1 and h2 are 64-bit and Number loses the
    // low bits above 2^53, which would make this disagree with Python for
    // most keys while still looking plausible for some.
    let h1 = 0n;
    let h2 = 0n;
    for (let i = 0; i < 8; i++) h1 = (h1 << 8n) | BigInt(digest[i]);
    for (let i = 8; i < 16; i++) h2 = (h2 << 8n) | BigInt(digest[i]);
    h2 |= 1n;
    const M = BigInt(m);
    const out = new Array(k);
    for (let i = 0; i < k; i++) out[i] = Number((h1 + BigInt(i) * h2) % M);
    return out;
  }

  async function member(bits, m, k, key) {
    for (const b of await positions(key, m, k)) {
      if (!((bits[b >> 3] >> (b & 7)) & 1)) return false;
    }
    return true;
  }

  function addressKey(prefix, address) {
    return `${prefix}:${String(address).toLowerCase()}`;
  }

  function agentKey(slug, tokenId) {
    return `a:${String(slug).toLowerCase()}:${String(tokenId)}`;
  }

  return { decode, member, addressKey, agentKey };
})();

// Available to the service worker (importScripts) and to content scripts
// (script order in the manifest). No module system: MV3 content scripts are
// classic scripts and a bundler for four files would be its own maintenance.
if (typeof self !== "undefined") self.TnegaFilter = TnegaFilter;
