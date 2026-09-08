// hackathonCategories.js
//
// A view, not a classification. The four hackathon DeFi labels sit on top of
// the taxonomy in backend/core/categorize.py, which stays exactly as it is.
// Nothing here reclassifies an agent, and no agent's stored `category`
// changes because of this file.
//
// WHY A VIEW RATHER THAN A REBUILD
// The four labels were the hackathon's suggested examples, not a taxonomy.
// Live registry data carries badge verification, copywriting, auditing,
// research, gaming and more, and forcing those into four buckets would
// throw away what the data actually shows. So the fine categories stay, and
// this maps whichever of them belong under each hackathon label. The
// marketplace can filter by either.
//
// WHY MOST OF THE MAPPINGS ARE ONE TO ONE, STATED PLAINLY
// Three of the four have exactly one fine category under them, because
// nothing else in the taxonomy is that strategy. Yield Optimisation is the
// exception and it is not a judgement call: a liquid-staking agent and a
// yield-routing agent are the same category to a judge looking for yield
// optimisation, and Copy Trading is not, however close it sits in the UI.
//
// A mapping that quietly folded Trading Signals into Grid Trading would
// make the counts look better and would be wrong. Trading Signals is 23,793
// agents of general trading vocabulary, and almost none of them run a grid.
// See docs/category-evaluation.md for what was measured instead.
import { CATEGORY_GROUPS } from './categoryGroups.js';

export const HACKATHON_CATEGORIES = [
  {
    id: 'rebalancing',
    label: 'Rebalancing',
    // 'Rebalancing' also absorbs LP range management (lp range, tick range,
    // re-center), which is rebalancing a concentrated liquidity position
    // rather than a portfolio. Both belong here.
    categories: ['Rebalancing'],
  },
  {
    id: 'grid-trading',
    label: 'Grid Trading',
    categories: ['Grid Trading'],
  },
  {
    id: 'yield-optimisation',
    label: 'Yield Optimisation',
    categories: ['Yield Optimisation'],
  },
  {
    id: 'health-factor',
    label: 'Health Factor Monitoring',
    categories: ['Health Factor Monitoring'],
  },
];

// fine category -> hackathon id. A category with no hackathon label maps to
// null, which is most of them and is correct: the taxonomy is broader than
// the four on purpose.
export const CATEGORY_TO_HACKATHON = HACKATHON_CATEGORIES.reduce((map, h) => {
  for (const cat of h.categories) map[cat] = h.id;
  return map;
}, {});

export function hackathonForCategory(category) {
  return CATEGORY_TO_HACKATHON[category] || null;
}

export function hackathonLabel(id) {
  return HACKATHON_CATEGORIES.find((h) => h.id === id)?.label || id;
}

/** Every fine category that is NOT under one of the four. Useful for
 *  showing that the taxonomy is wider than the hackathon view rather than
 *  implying the rest do not exist. */
export function categoriesOutsideHackathonView() {
  const inView = new Set(Object.keys(CATEGORY_TO_HACKATHON));
  return CATEGORY_GROUPS.flatMap((g) => g.categories).filter((c) => !inView.has(c));
}
