// shareLink.js
//
// Shareable per-agent deep links — the one genuinely-missing piece for a
// freelancer who wants to send their own client a direct link to hire/subscribe
// to their specific agent, instead of making them browse the whole marketplace.
//
// Small and self-contained: no router, no new backend. A link carries the
// agent's on-chain token id (or its marketplace id) as `?agent=<id>`; on load
// the app opens that agent's existing detail view if it's in the served set.
// Shared by web and mobile so both behave identically.

/** The shareable URL for an agent (prefers the on-chain ERC-8004 token id). */
export function agentShareUrl(agent) {
  const id = agent?.tokenId != null ? String(agent.tokenId) : String(agent?.id ?? '');
  const { origin, pathname } = window.location;
  return `${origin}${pathname}?agent=${encodeURIComponent(id)}`;
}

/** The `?agent=` id from the current URL, or null. */
export function readDeepLinkAgentId() {
  try { return new URLSearchParams(window.location.search).get('agent'); } catch { return null; }
}

/** Does this agent match a deep-link id (by token id or marketplace id)? */
export function matchesDeepLink(agent, id) {
  if (!id) return false;
  return String(agent.id) === id || (agent.tokenId != null && String(agent.tokenId) === id);
}

/** Copy a share URL to the clipboard; returns true on success. */
export async function copyShareLink(url) {
  try {
    if (navigator?.clipboard?.writeText) { await navigator.clipboard.writeText(url); return true; }
  } catch { /* fall through */ }
  return false;
}
