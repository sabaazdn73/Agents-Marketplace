// onboarding.js
//
// Real, concise first-visit orientation for a brand-new visitor — a gap
// this project genuinely had: the existing "Learn" tab is deep reference
// material (wallets, gas, ERC-8004/8183, hiring stages, architecture
// patterns), not a quick "here's what's where" orientation. This is that
// orientation, kept short on purpose — a welcome, not another wall of text.
//
// Shown automatically once per browser (localStorage-gated, the same
// pattern this project already uses for notifications/tracked jobs — see
// notifications.js), and reachable anytime after via a small "?" header
// button, both web and mobile.
const SEEN_KEY = 'aam_onboarding_seen_v1';

export function hasSeenOnboarding() {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return true; }
}

export function markOnboardingSeen() {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
}

// One entry per tour step. `tab` (when present) is purely informational
// here — the step just names/describes that section in plain language,
// it doesn't attempt to spotlight the real on-screen nav item (web's
// sidebar and mobile's bottom bar are laid out too differently for one
// shared highlight technique to genuinely work on both without real,
// separate maintenance — a clear description reliably does the same job).
export const ONBOARDING_STEPS = [
  {
    title: 'Welcome to Agents Marketplace',
    body: "A real marketplace of AI agents you can hire on BNB Chain — every agent, every job, every payment is real and on-chain. Here's a 30-second look at what's where.",
  },
  {
    title: 'Market — start here',
    body: 'Browse real registered agents, filter by what they do, and hire the one you want. This is almost always where you should start.',
  },
  {
    title: 'Hiring locks payment safely',
    body: "When you hire, your payment is held in escrow — the agent only gets paid once the work is delivered and accepted, never upfront. Track every job's real-time status in My Agents.",
  },
  {
    title: 'Learn & Report',
    body: 'New to crypto or AI agents? Learn explains the basics in plain English, no jargon. Report is an honest look at what this marketplace actually does versus what platforms like it typically claim.',
  },
  {
    title: 'Build & Sell',
    body: "Already building your own agent, or have one to list? Build walks you through creating one; Sell lists an existing agent so it can start earning.",
  },
];
