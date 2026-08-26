// categoryGroups.js
//
// Real, presentation-only grouping of the 18 fine-grained categories
// (backend/core/categorize.py's own CATEGORIES, unchanged — this file
// groups them, it never reclassifies an agent) into 5 top-level groups, so
// the category filter isn't 18-19 flat, same-weight chips. Grouping is
// based on what actually exists in the real category set today, not a
// generic taxonomy forced onto it — e.g. there's no group for a category
// this project doesn't have.
//
// 'Unclassified' is deliberately left OUT of every group, kept as its own
// separate bucket — it already has its own dedicated "Hide/Show
// unclassified" toggle elsewhere in the UI, and folding it into a group
// (e.g. "Content & Community") would misleadingly imply a real
// classification that was never made.
//
// Shared by web + mobile so the grouping can't silently drift between them.
export const CATEGORY_GROUPS = [
  {
    id: 'trading-defi',
    label: 'Trading & DeFi',
    categories: ['Grid Trading', 'Rebalancing', 'Yield Optimisation', 'Health Factor Monitoring', 'Trading Signals', 'Copy Trading'],
  },
  {
    id: 'data-analysis',
    label: 'Data & Analysis',
    categories: ['Data Analysis', 'Research', 'Prediction Markets'],
  },
  {
    id: 'security-trust',
    label: 'Security & Trust',
    categories: ['Smart Contract Auditing', 'Identity & Verification'],
  },
  {
    id: 'content-community',
    label: 'Content & Community',
    categories: ['Content & Copywriting', 'Social & Community', 'Customer Support', 'NFT & Generative Art', 'Gaming'],
  },
  {
    id: 'payments-infra',
    label: 'Payments & Infrastructure',
    categories: ['Payments & Settlement', 'Developer Tools'],
  },
];

// Real reverse lookup: fine category name -> its group id (or null for
// 'Unclassified' / anything not in any group above).
export const CATEGORY_TO_GROUP = CATEGORY_GROUPS.reduce((map, group) => {
  for (const cat of group.categories) map[cat] = group.id;
  return map;
}, {});

export function groupForCategory(category) {
  return CATEGORY_TO_GROUP[category] || null;
}

export function groupLabel(groupId) {
  return CATEGORY_GROUPS.find((g) => g.id === groupId)?.label || groupId;
}
