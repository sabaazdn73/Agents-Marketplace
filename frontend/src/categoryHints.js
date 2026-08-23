// categoryHints.js
//
// Copy audit (2026-08-22): the category taxonomy itself (backend/core/
// categorize.py) uses real trading/DeFi terms as its category NAMES —
// "Health Factor Monitoring", "Yield Optimisation", etc. — because those
// names double as the keyword-matching labels and changing them would touch
// backend classification logic, not just display text. Renaming them here
// isn't safe to do blind, so instead: every category gets a short, plain-
// language explanation attached as a tooltip wherever it's shown as a chip,
// so a beginner isn't left staring at an unexplained term. Shared by web +
// mobile so the two can't drift.
export const CATEGORY_HINTS = {
  'Rebalancing': 'Keeps a mix of coins at a chosen ratio, buying/selling automatically to stay balanced.',
  'Grid Trading': 'Places a ladder of buy/sell orders at set price steps, aiming to profit as the price moves up and down.',
  'Yield Optimisation': 'Moves your crypto between places that pay interest, chasing the best return.',
  'Health Factor Monitoring': 'Watches a crypto loan and warns you before it gets risky enough to be seized.',
  'Trading Signals': 'Studies the market and tells you when it thinks is a good time to buy or sell.',
  'Copy Trading': "Automatically copies another trader's moves with your own money.",
  'Smart Contract Auditing': 'Checks a piece of blockchain code for bugs or security holes before you trust it.',
  'Data Analysis': 'Digs through data and turns it into charts, summaries, or reports.',
  'Research': 'Looks things up and writes up findings, like a research assistant.',
  'Content & Copywriting': 'Writes text for you — articles, posts, product descriptions, and the like.',
  'Identity & Verification': 'Checks who someone or something really is.',
  'Customer Support': 'Answers customer questions automatically.',
  'NFT & Generative Art': 'Creates or manages digital collectible art (NFTs).',
  'Gaming': 'Plays or manages tasks inside a game.',
  'Prediction Markets': 'Lets people bet on the outcome of real-world events.',
  'Social & Community': 'Helps run or moderate an online community or social account.',
  'Payments & Settlement': 'Sends, receives, or manages payments.',
  'Developer Tools': 'Helps programmers build or test software.',
  'Unclassified': "We couldn't tell what this agent does from its description — read its details before hiring.",
};
