// hackathonPartners.js
//
// Real hackathon partners/tracks this project actually uses or was built
// for — shared by the footer strip (HackathonPartnersFooter.jsx) and the
// full credits page (HackathonPartnersPage.jsx), web + mobile. Same
// pattern as dataSources.js: every logo is fetched directly from the
// partner's own real domain, checked live before use (2026-08-26), not a
// third-party favicon-proxy.
//   - ETHGlobal: the events this project was submitted to (Lisbon 2026,
//     and Online 2026) — an attribution of where it was built, not a
//     partnership or endorsement.
//   - BNB Chain: the chain this whole project runs on (mainnet-only, per
//     this project's standing rule) — real favicon at bnbchain.org.
//   - TermiX: the AACP protocol (ERC-8004 identity + ERC-8183 commerce)
//     the large "X.agent" cluster in the real marketplace registers
//     through — real domain confirmed termix.ai (not termix.io, a
//     different, unrelated site — checked before using it).
//   - PancakeSwap: one of the real Altana Skills this app can run
//     (pancakeswapSkill.js).
//   - Altana: the passkey-wallet SDK (@altananetwork/sdk) powering every
//     client-side signature and Skill session in this app.
//   - AltLayer (8004scan): the real agent identity/reputation index this
//     whole marketplace is built on (adapters/bsc.py) — credited by
//     company name here, distinct from the Data Sources entry which
//     credits 8004scan.io itself as the data source.
export const HACKATHON_PARTNERS = [
  {
    name: 'ETHGlobal',
    url: 'https://ethglobal.com',
    // First-party asset, verified rather than assumed: ethglobal.com's own
    // <head> declares /favicon.ico, and the file decodes as a real
    // multi-size Windows icon (16, 32 and 48px, 32-bit) rather than an
    // HTML error page served with an image content-type. Same .ico form
    // several existing entries here already use.
    logo: 'https://ethglobal.com/favicon.ico',
    description: 'Tnega was submitted to ETHGlobal Lisbon 2026 and is being submitted to ETHGlobal Online 2026.',
  },
  {
    name: 'BNB Chain',
    url: 'https://www.bnbchain.org',
    logo: 'https://www.bnbchain.org/favicon.ico',
    description: 'The mainnet this entire marketplace runs on.',
  },
  {
    name: 'TermiX',
    url: 'https://termix.ai',
    logo: 'https://termix.ai/favicon.svg',
    description: 'AACP — the agent identity/commerce protocol a large share of real registered agents here use.',
  },
  {
    name: 'PancakeSwap',
    url: 'https://pancakeswap.finance',
    logo: 'https://pancakeswap.finance/favicon.ico',
    description: 'One of the ready-made Altana Skills agents here can run.',
  },
  {
    name: 'Altana',
    url: 'https://altana.network',
    logo: 'https://docs.altana.network/favicon.svg',
    description: 'The passkey wallet SDK behind the Skills Registry, the x402-payments Skill, wallet creation/recovery, and the on-chain passkey-secured wallet badge.',
  },
  {
    name: 'AltLayer (8004scan)',
    url: 'https://www.altlayer.io',
    logo: 'https://www.altlayer.io/favicon.ico',
    description: 'Built the real agent identity/reputation index this whole marketplace reads from.',
  },
];
