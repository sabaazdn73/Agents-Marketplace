// vaults/venues.js
//
// Where "Open on {venue}" goes: the vault's own page on its venue, where
// the venue shows the vault at a stable address. Checked headless on
// 2026-09-26:
//   Kamino  kamino.com/earn/lend/<address>/vault-overview, the page
//           app.kamino.finance/earn/lend/<address> redirects to, showing
//           that vault (Allez USDC checked);
//   Voltr   voltr.xyz/vault/<address>, the link Voltr's own list at
//           voltr.xyz/earn gives each vault ("View More"; Hubra Copilot
//           USDC checked).
// Where no per-vault page was verified, the venue's vault list is used, or
// null when the venue has no verified page; the panel then says so.
//
// Tnega never takes custody: depositing and withdrawing happen on the
// venue, signed in the visitor's own wallet. In-site signing (LI.FI
// Composer, ERC-4626, the Solana SDKs) is not built; it waits on the
// owner's confirmation of vault Level 2.

export const VENUES = {
  kamino: { name: 'Kamino', vault: (a) => `https://kamino.com/earn/lend/${a}/vault-overview`, url: 'https://app.kamino.finance/earn', checked: '2026-09-26' },
  voltr: { name: 'Voltr', vault: (a) => `https://voltr.xyz/vault/${a}`, url: 'https://voltr.xyz/earn', checked: '2026-09-26' },
  glam: { name: 'GLAM', vault: null, url: null, checked: '2026-09-26' },
  hyperliquid: { name: 'Hyperliquid', vault: null, url: 'https://app.hyperliquid.xyz/vaults', checked: '2026-09-26' },
  hyperevm: { name: 'HyperEVM', vault: null, url: null, checked: '2026-09-26' },
};

/** The page "Open on {venue}" links to for one vault, and whether it is the
 *  vault's own page or the venue's list. */
export function venueLink(platformKey, address) {
  const v = VENUES[platformKey];
  if (!v) return null;
  if (v.vault && address) return { href: v.vault(address), own: true, name: v.name };
  if (v.url) return { href: v.url, own: false, name: v.name };
  return { href: null, own: false, name: v.name };
}

/** Explorer link for an address on a chain, or null. */
export function explorerUrl(chain, address) {
  if (!address) return null;
  if (chain === 'Solana') return `https://solscan.io/account/${address}`;
  if (chain === 'HyperEVM') return `https://hyperevmscan.io/address/${address}`;
  if (chain === 'Hyperliquid') return `https://app.hyperliquid.xyz/explorer/address/${address}`;
  return null;
}
