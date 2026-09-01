# Skills as a distinct interaction type: giving them their own tab (2026-08-29)

## The question

The category-native evaluation framework (see [Category-Aware Evaluation](category-evaluation.md)) routes registered ERC-8004 agents into escrow-compatible (hire directly), SaaS-incompatible (visit their site), and a couple of other evidence-based interaction patterns. But Altana Skills, Venus Lending, PancakeSwap trading, and the rest, aren't registered agents being evaluated at all. Should they get their own, clearly-labeled place in the marketplace's main browsing experience instead of living inside a feature meant for something else?

## What was actually checked

**How many Skills exist, and where did they live?** 10 distinct Skills, confirmed live against `GET /api/skills-registry`: PancakeSwap Trading, Four.meme Trading, PancakeSwap Liquidity, Copy Trade, Venus Lending, x402 API Payments, Lista Liquid Staking, Aave V3 Lending, Token Radar, Wallet Tracker. All 10 are wired and executable (`AltanaSkillsPanel.jsx`'s own `SKILL_EXEC` map).

They lived inside the **"Build Your Agent"** tab, a genuine mismatch. That tab's own header text ("No coding required. If you can describe what you want in a sentence, you can build this... Built on BNB Agent Studio") is entirely about scaffolding a brand-new custom agent via the `bag` CLI, a completely different feature. `AltanaSkillsPanel` sat above that content under a small "Or build something custom" divider; a user looking to run Venus Lending themselves had no real reason to think to click a tab called "Build Your Agent" to find it. The only existing discovery path into Skills was indirect: `AgentGuidancePanel`'s "Try it yourself" suggestion, shown only on an agent's detail page when that agent has no track record yet.

## The structural reason this isn't a category-evaluation problem

A Skill is not a registered ERC-8004 agent, has no owner wallet, no score, no reviews, no verification tier, and isn't hired through an ERC-8183 job-and-deliverable cycle at all. Running one is a **direct, self-executed on-chain action**; the user's own connected wallet (or a spend-capped Altana mini-wallet) signs it, right then, against Altana's own pre-built, fork-tested logic. There's no third-party counterparty to evaluate, no delivery to wait on, no escrow.

The category-native evaluation framework (verification tiers, category groups, the unified Metrics presentation) exists specifically to answer "should I trust and pay *this* third-party agent for delivered work." That question doesn't apply to a Skill; you're not trusting an agent, you're running an already-audited action yourself. Folding Skills into that framework, a category-group badge on marketplace listings, a fifth verification tier, anything that implies "evaluate this like an agent," would blur the exact distinction the framework was built to draw. It was rejected for this reason, not for lack of a tidy place to put it.

## What shipped

**A new, top-level "Skills" tab**, a peer of "Marketplace" rather than a sub-panel of "Build Your Agent," on both web and mobile:

- `AltanaSkillsPanel` moved out of the Build tab entirely into its own tab, with an upfront explanation of what makes this different from hiring: *"Different from hiring an agent from the Marketplace: there's no job, no delivery to wait on, and no third party doing the work on your behalf. This runs directly, right now, within a limit you set."*
- "Build Your Agent" keeps its own unrelated custom-build flow, now honestly matching its own name without an unrelated panel bolted on top.
- The existing "Try it yourself" deep-link (`AgentGuidancePanel` -> `onTrySkill`) now lands on the new Skills tab instead of Build.
- A bookmarkable `/skills` URL (`routePaths.js`), so the new tab works the same way every other top-level tab already does: direct link, refresh, and back-button all land correctly.

No badge or category-group treatment was added to marketplace agent listings; per the reasoning above, there's no per-agent relationship to badge. A Skill isn't tied to a specific marketplace agent at all, so the existing category-to-skill suggestion on an agent's own detail page (routing by *category of work*, not by agent identity) is already the right level of abstraction, and stays as it was.
