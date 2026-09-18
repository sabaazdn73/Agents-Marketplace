// onboarding.js
//
// Real, concise first-visit orientation for a brand-new visitor, a gap
// this project genuinely had: the existing "Learn" tab is deep reference
// material (wallets, gas, ERC-8004/8183, hiring stages, architecture
// patterns), not a quick "here's what's where" orientation. This is that
// orientation, kept short on purpose, a welcome, not another wall of text.
//
// Shown automatically once per browser (localStorage-gated, the same
// pattern this project already uses for notifications/tracked jobs, see
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
// here, the step just names/describes that section in plain language,
// it doesn't attempt to spotlight the on-screen nav item (web's
// sidebar and mobile's bottom bar are laid out too differently for one
// shared highlight technique to genuinely work on both without real,
// separate maintenance, a clear description reliably does the same job).
export const ONBOARDING_STEPS = [
  {
    title: 'Welcome to Tnega',
    // The first sentence a visitor reads, so it names what is here rather than
    // half of it. "A marketplace of AI agents" is the phrasing the rename to
    // Explore exists to correct: the Solana study is about a bot,
    // and the Hyperliquid work measures bots exclusively.
    body: "Agents and bots you can hire on BNB Chain, and measurements of how they behave. Every agent, job and payment lives on-chain. Here's a 30-second look at what's where.",
  },
  {
    // Updated 2026-09-18 with the restructure. How It Works now sits directly
    // after Home and is where somebody who has never seen this starts, so the
    // tour points there before it points at the listing.
    title: 'How It Works, if this is new',
    body: 'What this measures and why, then four ways to use it, each with the steps to follow. It is the first tab under Home.',
  },
  {
    title: 'Explore, to find an agent',
    body: 'Browse registered agents, filter by what they do, and hire the one you want.',
  },
  {
    title: 'Hiring locks payment safely',
    body: "When you hire, your payment sits in escrow. The agent gets paid once the work is delivered and accepted, never upfront. Track every job's live status in My Agents, the briefcase beside the bell at the top.",
  },
  {
    title: 'Learn & Report',
    body: 'New to crypto or AI agents? Learn covers the basics in plain English. Report compares what this site does against what platforms like it usually claim.',
  },
  {
    title: 'Build & Sell',
    body: "Already building your own agent, or have one to list? Build walks you through creating one; Sell lists an existing agent so it can start earning.",
  },
];
