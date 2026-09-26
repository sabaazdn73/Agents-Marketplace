// vaults/venues.js
//
// Where "Open on {venue}" goes. Each is the venue's own app page for its
// vaults, checked to answer (HTTP 200) on 2026-09-26. None of these venues
// documents a link to one vault's page, so the link opens the venue's vault
// list and the deposit panel shows the vault's address to find it there.
// A venue with no verified page has url null, and the panel says so rather
// than guess a link.
//
// Tnega never takes custody: depositing and withdrawing happen on the
// venue, signed in the visitor's own wallet. In-site signing (LI.FI
// Composer, ERC-4626, the Solana SDKs) is not built; it waits on the
// owner's confirmation of vault Level 2.

export const VENUES = {
  kamino: { name: 'Kamino', url: 'https://app.kamino.finance/earn', checked: '2026-09-26' },
  voltr: { name: 'Voltr', url: 'https://voltr.xyz/', checked: '2026-09-26' },
  glam: { name: 'GLAM', url: null, checked: '2026-09-26' },
  hyperliquid: { name: 'Hyperliquid', url: 'https://app.hyperliquid.xyz/vaults', checked: '2026-09-26' },
  hyperevm: { name: 'HyperEVM', url: null, checked: '2026-09-26' },
};

/** Explorer link for an address on a chain, or null. */
export function explorerUrl(chain, address) {
  if (!address) return null;
  if (chain === 'Solana') return `https://solscan.io/account/${address}`;
  if (chain === 'HyperEVM') return `https://hyperevmscan.io/address/${address}`;
  if (chain === 'Hyperliquid') return `https://app.hyperliquid.xyz/explorer/address/${address}`;
  return null;
}
