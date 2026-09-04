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

/** An agent's id for URLs (prefers the on-chain ERC-8004 token id). */
export function agentUrlId(agent) {
  return agent?.tokenId != null ? String(agent.tokenId) : String(agent?.id ?? '');
}

/** The canonical in-app path for an agent's detail view.
 *
 * Added 2026-09-04. Opening an agent used to change no URL at all, so a
 * refresh on a detail page dropped the user back to the marketplace root:
 * there was nothing in the address bar for a cold load to restore from.
 * The back-navigation fix in 7129356 gave detail views real history
 * entries, but history entries only exist within a session, and a refresh
 * throws that away. This is the missing half. */
export function agentPath(agent) {
  return `/agent/${encodeURIComponent(agentUrlId(agent))}`;
}

/** The full shareable URL for an agent. */
export function agentShareUrl(agent) {
  return `${window.location.origin}${agentPath(agent)}`;
}

/** The agent id in the current URL, or null.
 *
 * Reads BOTH forms on purpose. `/agent/<id>` is what the app now writes,
 * but `?agent=<id>` was the original share format and links using it are
 * already out in the world, so they keep resolving. */
export function readDeepLinkAgentId() {
  try {
    const m = window.location.pathname.match(/^\/agent\/([^/?#]+)/);
    if (m) return decodeURIComponent(m[1]);
    return new URLSearchParams(window.location.search).get('agent');
  } catch { return null; }
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
