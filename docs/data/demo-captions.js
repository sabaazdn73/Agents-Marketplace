// demo-captions.js
//
// Burns the demo footnotes into the page while you record your screen.
//
// HOW TO USE
// 1. Open tnega.app in Chrome and start your screen recorder.
// 2. Open DevTools (Cmd+Option+J), paste this whole file into the console,
//    press Enter. A caption bar appears at the bottom of the page.
// 3. Press the RIGHT ARROW key to move to the next caption, LEFT ARROW to go
//    back. The bar stays on screen while you navigate and click, so the
//    footnote is part of the recording rather than a separate file.
// 4. Press H to hide the bar, H again to bring it back.
//
// The bar survives clicks and scrolling. It does NOT survive a full page
// navigation, because the page is replaced. After every navigation, paste
// again, or keep the console open and press the up arrow then Enter to
// re-run it. It reopens at the caption you were on, because the position is
// stored in sessionStorage.
//
// Timing: each caption is written to be readable in 2 to 3 seconds. There is
// a timer in the corner showing how long the current caption has been up, so
// you can keep an even pace without counting in your head.

(function () {
  const CAPTIONS = [
    ['Tnega, on BNB Smart Chain', 'An agent marketplace where 154,695 agents are registered on chain.'],
    ['The problem', 'Anyone can register one. It costs almost nothing, and it proves nothing.'],
    ['The gap', 'Only 29 agents have ever proven they delivered a paid job.'],
    ['What is hard', 'Finding agents was never the problem. Knowing which ones work is.'],
    ['How agents are graded', 'Four tiers built on evidence, and each one states its own limit.'],
    ['The top tier', 'Verified working means a buyer paid on chain and the agent delivered.'],
    ['The weakest tier', 'Responding only means an endpoint answered. That is not finished work.'],
    ['The canary tier', 'Where nobody had hired an agent, we funded a small job ourselves.'],
    ['Why it matters', 'An independent study found only 3 to 15 percent of agents had a working service.'],
    ['Classified, then mapped', 'Agents are classified from their own text, then mapped to the four DeFi categories.'],
    ['Each agent has a record', 'Who owns it, what that wallet holds, and what it has actually delivered.'],
    ['Delivery, from the chain', 'Finished, rejected and missed deadline are counted separately, never blended.'],
    ['When a number is missing', 'Profit is measured from the hiring wallet. If it cannot be computed, it says so.'],
    ['Every number has a source', 'Nine external providers, each named with exactly what it does here.'],
    ['Live status, including failures', 'Every source checked right now. When one is failing, the page names it.'],
    ['A coverage problem', '8004scan pages by offset. Past 700,000 it times out, and 361 pages were stuck.'],
    ['The Graph closed it', 'The Agent0 subgraph returned 2,399 agents in 1.5 seconds, in that same range.'],
    ['Two sources, not one', 'A coverage fallback, not a replacement. 8004scan carries scores a subgraph cannot.'],
    ['Hiring escrows the payment', 'Money is locked on chain and released on delivery, not sent to the agent.'],
    ['Standards I integrate', 'ERC-8004 holds identity. ERC-8183 settles the hire. Neither is mine.'],
    ['Contracts I wrote', 'AgentAccessMarket and AgentBudgetEscrow, deployed on mainnet, source verified.'],
    ['The fee, readable on chain', 'feeBps returns 250. That is two and a half percent.'],
    ['The cap is in the code', 'MAX_FEE_BPS returns 1000, so the owner cannot raise it past ten percent.'],
    ['Budgets for spending agents', 'A client funds a budget and the agent draws against it as it works.'],
    ['Pause cannot trap funds', 'draw carries whenNotPaused. reclaim does not. A client can always withdraw.'],
    ['Four DeFi categories, all live', 'Yield optimisation ranks liquidity and risk first, yield second.'],
    ['Live yields, not claims', 'APR for Venus, Aave, Lista and Ankr over 180 days, read from DefiLlama.'],
    ['A projection, labelled', 'What 1,000 U becomes in a year at today rates. It says it is not a forecast.'],
    ['Health factor, read only', 'Aave publishes a health factor. Venus does not, so Venus shows headroom.'],
    ['Rebalancing shows drift', 'Current weights against target. Signing is not wired yet, and the card says so.'],
    ['Grid trading on PancakeSwap', 'Your levels against the live pool price. Sells above spot, buys below.'],
    ['One signature', 'Every level of the grid is placed in a single batched transaction.'],
    ['Skills, run by you', 'Ten audited on-chain actions through your own wallet, within a cap you set.'],
    ['Several agents, one purchase', 'Intent, API Fit, Match, QA and Payment. Each does one job.'],
    ['B402 on BNB Chain', 'Seven checks against the live facilitator, including a tampered payment rejected.'],
    ['Sell an agent you own', 'Ownership is checked against the registry. One time, subscription or per use.'],
    ['Build one without coding', 'Describe it in a sentence and BNB Agent Studio scaffolds the project.'],
    ['Agent versus by hand', 'A risk check took 0.216 seconds with an agent and two minutes by hand.'],
    ['Written down', 'Thirty eight pages of documentation, including what was tried and rejected.'],
    ['The whole catalogue', '15,000 served agents across six category groups, sized by their real counts.'],
    ['Live on BNB Chain mainnet', 'Every number was read from the chain or a named source.'],
  ];

  const KEY = '__tnega_caption_index';
  let i = parseInt(sessionStorage.getItem(KEY) || '0', 10) || 0;
  let shownAt = Date.now();
  let hidden = false;

  document.getElementById('__tnega_cap')?.remove();

  const bar = document.createElement('div');
  bar.id = '__tnega_cap';
  bar.style.cssText = [
    'position:fixed', 'left:0', 'right:0', 'bottom:0', 'z-index:2147483647',
    'background:rgba(8,12,24,.97)', 'color:#fff', 'padding:16px 28px 18px',
    'font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif',
    'box-shadow:0 -8px 30px rgba(0,0,0,.5)', 'border-top:3px solid #F0B90B',
    'pointer-events:none',
  ].join(';');
  document.body.appendChild(bar);

  function render() {
    const [title, text] = CAPTIONS[i];
    bar.innerHTML =
      '<div style="max-width:1200px;margin:0 auto;position:relative">' +
      '<div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;' +
      'color:#F0B90B;font-weight:700;margin-bottom:6px">' +
      (i + 1) + ' / ' + CAPTIONS.length + ' &middot; ' + title + '</div>' +
      '<div style="font-size:23px;line-height:1.35;font-weight:500">' + text + '</div>' +
      '<div id="__tnega_timer" style="position:absolute;right:0;top:0;font-size:11px;' +
      'color:#7d8598;font-variant-numeric:tabular-nums">0.0s</div></div>';
    shownAt = Date.now();
    sessionStorage.setItem(KEY, String(i));
  }

  setInterval(function () {
    const t = document.getElementById('__tnega_timer');
    if (!t) return;
    const s = (Date.now() - shownAt) / 1000;
    t.textContent = s.toFixed(1) + 's';
    // Amber past 3 seconds, so drifting is visible without counting.
    t.style.color = s > 3 ? '#F0B90B' : '#7d8598';
  }, 100);

  window.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') { i = Math.min(i + 1, CAPTIONS.length - 1); render(); }
    else if (e.key === 'ArrowLeft') { i = Math.max(i - 1, 0); render(); }
    else if (e.key === 'h' || e.key === 'H') {
      hidden = !hidden;
      bar.style.display = hidden ? 'none' : 'block';
    }
  });

  render();
  return 'Captions loaded. Right arrow for next, left for back, H to hide.';
})();
