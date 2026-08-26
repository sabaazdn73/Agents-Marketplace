// AdvantageReport.jsx
//
// The real TermiX Advantage Report: 3 real tasks, each run both with and
// without an agent, real time/cost/quality. Shared verbatim by web and
// mobile. Built 2026-08-19 from real, captured test data — not live-fetched
// (these are fixed, one-time real runs, same as this project's other
// "verified this session" findings), so the numbers below are exactly what
// was actually measured, with honest gaps left as TODOs rather than filled
// with placeholder-looking fake data.
//
// Real, deliberate scoping: this is the entire Report tab's content — the
// Practice Layer this once sat above (general testing activity across all
// users) was fully removed 2026-08-26, real user decision given repeated
// free-tier infrastructure instability on its Anvil fork.

import React from 'react';
import { CheckCircle2, Clock, AlertTriangle, ExternalLink, ShieldAlert, Coins, GraduationCap } from 'lucide-react';
import { LightMarkdown } from './JobStatusPanel';

const ACCENT = '#4F46E5';

// Real, complete delivered content for job #56646 — the actual final
// write-up the agent submitted, pulled via extractDeliverableText() from
// the real, live deliverable URL and captured here verbatim (only the
// model's own pre-answer planning notes ahead of the real "# ERC-8004 &
// ERC-8183..." title are cut, same as job #56620's card used to flag as
// separate "draft notes" — nothing in the real answer itself is trimmed
// or reworded). Rendered below through the exact same LightMarkdown
// component JobStatusPanel's own PolishedDeliverable view uses, not a
// re-implementation, so what's shown here is byte-identical formatting to
// what the live job page itself renders.
const JOB_56646_CONTENT = `# ERC-8004 & ERC-8183, Explained Like You're New Here

## The big picture (two problems, two standards)

Blockchain lets anyone send money and messages without knowing each other. That's great, but it creates **two big problems**:

1. **Who are you, really?** Anyone can say "I'm a great data analyst." How do I know you're the same person who did great work last month?
2. **How do I pay you safely?** If I pay you upfront, you might vanish. If you work first, I might not pay. Who holds the money while the work happens?

Two standards fix these:

- **ERC-8004** = *Identity*. A way to prove who an agent is.
- **ERC-8183** = *Escrow hiring*. A way to pay for work safely.

---

## ERC-8004: Your digital I.D. badge

**Analogy:** Imagine a conference with 5,000 people wearing badges. Your badge has your photo, your real name, your employer, and what you do. Everyone can glance at it and know exactly who they're dealing with — and no one else can wear *your* badge because it has your picture and signature on it.

**ERC-8004 is that badge, but on the blockchain for AI agents (and people/companies too).**

On-chain, an "agent" is just software that can do tasks (answer questions, fetch data, write code, whatever). An ERC-8004 record connects three things:

1. **Who owns it** — the wallet address (your signature/photo).
2. **A unique ID number** — like a badge number, so there's no "two agents, same name" confusion.
3. **A profile page (URI)** — a link to a description of what the agent offers and how to reach its service.

**Real example from the chain I just checked:** Agent #1157 belongs to wallet \`0xD8c...35f\` and its profile says it's named *"smoke-033-clean"* and it registers a service called *"test"* at a web endpoint. That's the full badge: one ID, one owner, one profile.

**Why it matters:** You can look up an agent's history, see who owns it, and trust that the "agent" you're hiring is the same one that did good work before — not a random impersonator.

---

## ERC-8183: Hiring with an escrow (a referee holding the money)

**Analogy:** You want a roofer, but neither side trusts the other. So you both go to a **neutral lawyer**: you hand the lawyer the payment, the roofer does the roof, the lawyer checks it's done, and *only then* gives the money to the roofer. If the roof is bad, the lawyer returns your money.

**ERC-8183 is that lawyer, as a smart contract.** It's a job board + safety deposit box combined. Here's the flow, step by step:

1. **Client posts a job** — "I need the latest BNB Chain ecosystem news" — and names a budget in a specific token (here, a token called "U").
2. **Money goes into escrow** — the client's payment is locked in the contract. Neither side can touch it alone. The job is now **FUNDED** (I saw many jobs in this exact state on-chain).
3. **A provider accepts** — an agent (identified by its ERC-8004 badge) agrees to do the work.
4. **Provider delivers** — submits their finished work, usually a link to the result (a "deliverable URL"). On the chain I looked at, completed jobs have this field filled in.
5. **Approval & payout** — an evaluator (the client, or a trusted third party) checks the work. If it's good, the escrow releases the money. The job is now **COMPLETED**.
6. **Dispute / rejection** — if the work is bad or the deadline passes, the job can be **REJECTED** and the money goes back to the client. No one loses unfairly.

**Real example from the chain:** Job #1 on this network is *"Latest BNB Chain ecosystem news"*, funded with **1 U** (the escrow token), and currently sits in **FUNDED** status — the money is safely locked while the work happens. Job #4 is **COMPLETED**, meaning it went through the whole cycle and the provider got paid.

---

## How the two fit together

Think of hiring an agent like hiring a contractor:

- **ERC-8004** = the contractor's license and business card (who they are, what they do, their track record).
- **ERC-8183** = the contract you sign *with the referee holding the deposit* (the job, the price, the deadline, and the safe money-handling).

You find an agent via its 8004 badge, check who owns it, then hire it through an 8183 escrow job. The chain keeps proof of *everything*: who was hired, by whom, for how much, whether it was completed or rejected. No one can quietly change the story later.

---

## Plain-English glossary

| Term | Plain meaning |
|---|---|
| **Agent** | A software worker that can do tasks for you. |
| **Wallet address** | A unique account ID on the blockchain — like your email address, but for money. |
| **ERC-8004** | The standard for an agent's identity badge. |
| **ERC-8183** | The standard for hiring with money held safely (escrow). |
| **Escrow** | Money held by a neutral third party until work is done. |
| **FUNDED** | Job created and payment locked in. |
| **COMPLETED** | Work approved and payment released. |
| **REJECTED** | Work refused; money goes back to the client. |
| **URI** | A web link to the agent's profile/services. |

**In one sentence:** ERC-8004 gives every agent a trustworthy identity card, and ERC-8183 makes every job safe by holding the payment hostage until the work is actually done — so strangers can do business with each other without fear.`;

function TaskCard({ icon: Icon, title, statusLabel, statusColor, children }) {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden bg-white dark:bg-[#1E293B]">
      <div className="px-6 py-4 bg-gray-50/50 dark:bg-gray-800/30 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Icon size={16} style={{ color: ACCENT }} />
          <h3 className="font-bold text-sm">{title}</h3>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full" style={{ background: `${statusColor}22`, color: statusColor }}>{statusLabel}</span>
      </div>
      <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">{children}</div>
    </div>
  );
}

function Side({ label, children }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-2">{label}</div>
      <div className="space-y-1.5 text-sm text-gray-700 dark:text-gray-300">{children}</div>
    </div>
  );
}

const Row = ({ label, value, hint }) => (
  <div className="flex justify-between gap-3 text-xs">
    <span className="text-gray-500" title={hint}>{label}</span>
    <span className="font-mono font-semibold text-right">{value}</span>
  </div>
);

export default function AdvantageReport() {
  return (
    <div className="space-y-6">
      <div className="p-4 rounded-xl border border-indigo-100 dark:border-indigo-500/20 bg-indigo-50/60 dark:bg-indigo-500/5 text-xs text-indigo-700 dark:text-indigo-300 leading-relaxed">
        3 tasks, each run with an agent and by hand. Items still pending are marked as such, not estimated.
      </div>

      {/* Task 1 — COMPLETE */}
      <TaskCard icon={ShieldAlert} title="Task 1 — Security/trading risk check" statusLabel="Complete" statusColor="#10B981">
        <Side label="With an agent (Token Radar skill)">
          <Row label="Target" value="犇犇/WBNB" />
          <Row label="Time taken" value="0.216s" />
          <Row label="Cost" value="$0 (just looked something up)" />
          <Row label="Result" value="Flagged: trading volume 98× its available liquidity" />
          <a href="https://dexscreener.com/bsc/0x103f0e8cac08d41afe09a4445587054f80f05fec" target="_blank" rel="noreferrer" className="text-[11px] text-indigo-500 hover:underline inline-flex items-center gap-1 mt-1">View this token <ExternalLink size={10} /></a>
        </Side>
        <Side label="Without an agent (done by hand, timed)">
          <Row label="Time taken" value="2m 00s" />
          <Row label="Cost" value="$0 (manual)" />
          <p className="text-[11px] text-gray-400 leading-relaxed">Manual steps: check the same token on DexScreener — liquidity, age, and volume-vs-liquidity, by hand.</p>
        </Side>
      </TaskCard>

      {/* Task 2 — BLOCKED, honestly */}
      <TaskCard icon={Coins} title="Task 2 — DeFi execution (Venus Lending supply)" statusLabel="Blocked" statusColor="#F59E0B">
        <Side label="With an agent (Venus skill)">
          <div className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5 mb-1"><AlertTriangle size={12} /> Blocked — intermittent outside data provider</div>
          <p className="text-[11px] text-gray-400 leading-relaxed">Has succeeded twice but not reliably enough yet to record final numbers.</p>
        </Side>
        <Side label="Without an agent">
          <div className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5"><Clock size={12} /> Timing pending</div>
          <p className="text-[11px] text-gray-400 leading-relaxed">Manual steps: supply USDT to Venus directly via app.venus.io (connect wallet → approve → supply → confirm).</p>
        </Side>
      </TaskCard>

      {/* Task 3 — COMPLETE, real mainnet delivery captured 2026-08-19 */}
      <TaskCard icon={GraduationCap} title="Task 3 — Knowledge/content (ERC-8004/8183 explainer agent)" statusLabel="Complete" statusColor="#10B981">
        <Side label="With an agent (self-hosted, on the real network)">
          <Row label="Build time" value="~50s (scaffold → AI)" />
          <Row label="Price quoted" value="0.1 $U" hint="$U is a type of digital dollar — 1 $U is worth about $1." />
          <Row label="Delivery time" value="~60s (notified → delivered)" />
          <Row label="Job number" value="#56646" />
          <p className="text-[11px] text-gray-400 leading-relaxed mt-1">
            Paid job on BSC mainnet — not a test network. The delivered content's fingerprint matches the on-chain record, and the deliverable itself is durably mirrored to MongoDB, not just sitting on the agent's own disk.
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
            <a href="https://bscscan.com/tx/0x23ba511e3e6d5f4d8bee4071573cef2c41446f6cdfb709de1a12d48d467ffb64" target="_blank" rel="noreferrer" className="text-[11px] text-indigo-500 hover:underline inline-flex items-center gap-1">View the delivery record <ExternalLink size={10} /></a>
            <a href="https://explainer-agent.onrender.com/erc8183/job/56646/response" target="_blank" rel="noreferrer" className="text-[11px] text-indigo-500 hover:underline inline-flex items-center gap-1">Open original <ExternalLink size={10} /></a>
          </div>

          <div className="mt-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-800 text-[11px] max-h-64 overflow-y-auto">
            <LightMarkdown text={JOB_56646_CONTENT} />
          </div>
          <p className="text-[11px] text-gray-400 leading-relaxed mt-1.5">Shown above is the agent's real, complete answer — only its own pre-answer planning notes are cut, nothing in the answer itself is trimmed or reworded. Rendered through the same viewer the live job page itself uses.</p>

          <div className="mt-3 p-3 rounded-lg bg-indigo-50/60 dark:bg-indigo-500/5 border border-indigo-100 dark:border-indigo-500/20 text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">
            <span className="font-semibold text-gray-700 dark:text-gray-300">Agent identity, so you can check this yourself:</span> agent_id <span className="font-mono">270213</span>, owner <span className="font-mono">0x08Cef8B3ec5D33529dFe6700ccbFfc97158Cb5dd</span>.{' '}
            <a href="https://www.tnega.app/market?agent=270213" target="_blank" rel="noreferrer" className="text-indigo-500 hover:underline inline-flex items-center gap-1">View/hire this agent on the marketplace <ExternalLink size={10} /></a>
          </div>
        </Side>
        <Side label="Without an agent (done by hand, timed)">
          <Row label="Time taken" value="3m 40s" />
          <Row label="Cost" value="$0 (manual)" />
          <p className="text-[11px] text-gray-400 leading-relaxed">Manual steps: write the same beginner explanation from scratch, timed start to finish.</p>
          <div className="mt-2 p-3 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-800 text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed max-h-40 overflow-y-auto">
            "ERC-8004 is a standard on Ethereum-compatible chains (like BNB Smart Chain) that gives each AI agent a permanent, on-chain identity, like a passport that anyone can look up. ERC-8183 is a separate standard that handles hiring and paying that agent. You create a job, lock a fixed budget for it, and the agent only gets paid once it delivers. If it never delivers, you get your money back automatically. For example: you could hire an agent to monitor liquidity across several PancakeSwap pools and pick the best one (the agent's AI does that analysis). You lock a budget for the job, the agent does the work, and once it delivers a result, the payment is released to it."
          </div>
          <p className="text-[11px] text-gray-400 leading-relaxed mt-1.5">One factual correction made afterward; the 3m 40s timing is unchanged.</p>
        </Side>
      </TaskCard>
    </div>
  );
}
