// UseWithAi.jsx
//
// /ai. Point your own assistant at this site's MCP server: the endpoint and
// the one-line install on the face, the clients and the tools in short, and
// one worked example. The endpoint, the commands, the tools and the client
// list come from HowItWorksPage.jsx, so this page and the guide's section
// (guide/useWithAi.jsx, which renders the full McpDetails) cannot disagree.
//
// THE EXAMPLE. Real answers of the live server, trimmed, with the time they
// were taken: tools/call tnega_resolve "GOOGL", tnega_get
// tokenized_equities underlying/GOOGL, and one tnega_prepare_buy for the
// example wallet 0x...dEaD on Base, all on 2026-10-01 between 13:04:47 and
// 13:04:59 UTC. The client commands are the ones the client's own MCP
// documentation gives (read 2026-10-01): add with --transport http, list,
// and the in-session status command. No output of those commands is shown,
// because none was taken here.

import React from 'react';
import { ArrowRight, Terminal as TerminalIcon, MessageSquare, FileJson, PenLine } from 'lucide-react';
import {
  McpFront, MCP_TITLE, MCP_LINE, MCP_ENDPOINT, MCP_ADD_COMMAND, MCP_NPX_COMMAND, MCP_TOOLS, CodeBlock,
} from '../HowItWorksPage';
import { Tip } from '../dashboard/cards';
import GuideLink from '../guide/GuideLink';
import { PageFrame } from './PageFrame';
// Fendi's head, the Tnega mark, heads the server's card as it heads every page.
import fendiUrl from '../assets/fendi-head.png';

const TAKEN_AT = '1 Oct 2026, 13:04 UTC';

const firstSentence = (t) => (String(t).match(/^.*?\.(\s|$)/)?.[0] || t).trim();

/** A terminal-styled block: dark in both themes, lines kept as written. */
function Terminal({ title, lines }) {
  return (
    <div className="rounded-lg border border-line overflow-hidden min-w-0">
      <div className="flex items-center gap-1.5 px-3 h-7 bg-[#1b1f27] border-b border-white/10">
        <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" aria-hidden="true" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" aria-hidden="true" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" aria-hidden="true" />
        {title && <span className="ml-2 text-[11px] text-white/50 truncate">{title}</span>}
      </div>
      <pre className="m-0 overflow-x-auto bg-[#0e1116] p-3 text-[11.5px] leading-relaxed font-mono whitespace-pre">
        {lines.map(([kind, text], i) => (
          <div key={i} className={
            kind === 'cmd' ? 'text-[#e6edf3]'
              : kind === 'ask' ? 'text-[#e6edf3]'
              : kind === 'call' ? 'text-[#79c0ff]'
              : kind === 'note' ? 'text-white/40'
              : 'text-[#a5d6a7]'
          }>
            {kind === 'cmd' && <span className="text-[#7ee787] select-none">$ </span>}
            {kind === 'ask' && <span className="text-[#d2a8ff] select-none">&gt; </span>}
            {text}
          </div>
        ))}
      </pre>
    </div>
  );
}

function Step({ n, icon: Icon, title, children }) {
  return (
    <li className="relative pl-10 min-w-0">
      <span className="absolute left-0 top-0 w-7 h-7 rounded-full bg-inset text-fg inline-flex items-center justify-center text-[12px] font-semibold" aria-hidden="true">{n}</span>
      <h3 className="flex items-center gap-2 text-[14px] font-semibold text-fg">
        <Icon size={14} className="text-muted" aria-hidden="true" />{title}
      </h3>
      <div className="mt-2 space-y-2 text-[13px] text-muted min-w-0">{children}</div>
    </li>
  );
}

// Trimmed from the live answers; "…" marks what was cut.
const RESOLVE = [
  ['call', 'tnega_resolve {"query": "GOOGL"}'],
  ['out', '"value": [{"dataset": "tokenized_equities", "key": "underlying/GOOGL",'],
  ['out', '           "why": "Alphabet Class A: every version side by side"}]'],
];
const GET = [
  ['call', 'tnega_get {"dataset": "tokenized_equities", "id": "underlying/GOOGL"}'],
  ['out', '"measured_at": "2026-10-01T13:04:22Z", "order": "by key; side by side, not ranked",'],
  ['out', '"versions": ['],
  ['out', '  {"symbol": "GOOGLon", "issuer": "Ondo", "chain_id": 1, "state_1k": "too_thin", …},'],
  ['note', '  …'],
  ['out', '  {"symbol": "GOOGL", "issuer": "Robinhood", "chain_id": 4663,'],
  ['out', '   "allin_per_share_usd_1k": 350.3913, "cost_bps_1k": 30.51, …},'],
  ['out', '  {"symbol": "GOOGLB", "issuer": "bStocks", "chain_id": 56,'],
  ['out', '   "allin_per_share_usd_1k": 351.1796, "cost_bps_1k": 50.56, …},'],
  ['note', '  …'],
  ['out', '  {"key": "8453/0xb2000000000000000000002d0ba3164cc74f58b7",'],
  ['out', '   "symbol": "GOOGLc", "issuer": "Coinbase", "chain_id": 8453,'],
  ['out', '   "allin_per_share_usd_1k": 350.8326, "cost_bps_1k": 30.21, …},'],
  ['note', '  … 10 versions in all, each with its cost or the reason it has none'],
];
const PREPARE = [
  ['call', 'tnega_prepare_buy {"query": "8453/0xb2000000000000000000002d0ba3164cc74f58b7",'],
  ['call', '  "usd_amount": 10, "pay_with": "USDC",'],
  ['call', '  "wallet": "0x000000000000000000000000000000000000dEaD"}'],
  ['out', '"chosen": {"symbol": "GOOGLc", "issuer": "Coinbase", "chain": "Base"},'],
  ['out', '"quote": {"source": "LI.FI quote", "quoted_at": "2026-10-01T13:04:59Z",'],
  ['out', '  "to_amount_expected": "0.02852552", "to_amount_min": "0.02838289",'],
  ['out', '  "route": ["1inch", "LI.FI\'s fee step"], "gas_usd": 0.008, …},'],
  ['out', '"approval": {"token_symbol": "USDC", "amount": "10", "unlimited": false,'],
  ['out', '  "spender": "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae", …},'],
  ['out', '"value_check": {"ok": true, "loss_on_minimum": 0.00388, "limit_pct": 2.0, …},'],
  ['out', '"sign_url": "https://www.tnega.app/sign/eyJhIjoiMTAiLCJi…"'],
];

function Example() {
  return (
    <section className="bg-surface border border-line rounded-xl p-4 md:p-6" aria-labelledby="example-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Use case</div>
          <h2 id="example-title" className="mt-1 text-[18px] font-semibold text-fg">Example: connecting Tnega MCP to your assistant</h2>
          <p className="mt-1 text-[13px] text-muted">Claude Code in a terminal, asking about Alphabet (GOOGL). Real answers from the server, taken {TAKEN_AT}, trimmed.</p>
        </div>
      </div>

      <ol className="mt-5 space-y-6">
        <Step n={1} icon={TerminalIcon} title="Add the server in your terminal">
          <Terminal title="terminal" lines={[
            ['cmd', MCP_ADD_COMMAND],
            ['cmd', 'claude mcp list'],
          ]} />
          <p><code className="font-mono text-fg">claude mcp list</code> shows <code className="font-mono text-fg">tnega</code> once it is added; inside a session, <code className="font-mono text-fg">/mcp</code> shows its status.</p>
        </Step>

        <Step n={2} icon={MessageSquare} title="Ask in plain words">
          <Terminal title="claude" lines={[
            ['ask', 'Which tokenized GOOGL versions can I buy, and what does each cost?'],
            ['ask', 'Prepare a $10 buy of GOOGL on Base, paying with USDC,'],
            ['ask', 'for wallet 0x000000000000000000000000000000000000dEaD.'],
          ]} />
        </Step>

        <Step n={3} icon={FileJson} title="What the assistant gets back">
          <Terminal title={`tnega · ${TAKEN_AT}`} lines={RESOLVE} />
          <Terminal title={`tnega · ${TAKEN_AT}`} lines={GET} />
          <p>For the buy, the assistant passes the Base version&apos;s key from the answer above.</p>
          <Terminal title={`tnega · ${TAKEN_AT}`} lines={PREPARE} />
        </Step>

        <Step n={4} icon={PenLine} title="You sign in your own wallet">
          <p>
            The <code className="font-mono text-fg">sign_url</code> opens on tnega.app/sign: the order in full, a fresh LI.FI quote checked
            against Tnega&apos;s measured price, an approval for exactly 10 USDC, then the swap. Nothing is signed or sent until you sign it.
            A link works for 10 minutes.
          </p>
          <a href="/docs/buy-with-your-assistant" className="inline-flex items-center gap-1 text-[13px] font-semibold text-fg hover:underline">
            Buy a tokenized stock through your assistant, step by step <ArrowRight size={14} aria-hidden="true" />
          </a>
        </Step>
      </ol>

      <p className="mt-5 pt-4 border-t border-line text-[12px] text-muted">
        The same server works the same way in the other MCP clients listed above; only the way you add it differs.
      </p>
    </section>
  );
}

export default function UseWithAi({ layout = 'web', onNavigate = null }) {
  const compact = layout === 'mobile';
  return (
    <PageFrame layout={layout} title="Use with AI" sub="Connect your assistant to Tnega. No key, no account." right={<GuideLink id="use-with-ai" onNavigate={onNavigate} />}>
      <section className="bg-surface border border-line rounded-xl p-4 md:p-6" aria-labelledby="mcp-title">
        <div className="flex items-start gap-3">
          <span className="p-2 rounded-lg bg-inset shrink-0">
            <img src={fendiUrl} alt="" width={22} height={22} className="object-contain" style={{ width: 22, height: 22 }} />
          </span>
          <div className="min-w-0">
            <h2 id="mcp-title" className="text-[18px] font-semibold text-fg flex items-center gap-1.5">
              {MCP_TITLE}
              <Tip label="About the server" align="left">
                <span className="block">{MCP_LINE}</span>
                <span className="block">Every tool is read-only in the protocol itself. The two prepare tools return a tnega.app/sign link; Tnega never signs, and never holds funds or keys.</span>
              </Tip>
            </h2>
            <p className="text-[13px] text-muted mt-0.5">Read every measurement here from your own assistant.</p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-fg mb-1.5">Endpoint</div>
            <CodeBlock text={MCP_ENDPOINT} label="the endpoint" />
          </div>
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-fg mb-1.5">Claude Code, one line</div>
            <CodeBlock text={MCP_ADD_COMMAND} label="the command" />
            <p className="mt-1.5 text-[12px] text-muted">Or <code className="font-mono text-fg">{MCP_NPX_COMMAND}</code>, which runs the same command for you.</p>
          </div>
        </div>

        <div className="mt-5">
          <div className="text-[12px] font-semibold text-fg mb-1.5 flex items-center gap-1.5">
            Works with
            <Tip label="About the client list" align="left">
              <span className="block">Each client checked against its own documentation for remote MCP servers over HTTP. How to add the server in each is in the guide.</span>
            </Tip>
          </div>
          <McpFront small={compact} flush note={false} />
        </div>
      </section>

      <section className="bg-surface border border-line rounded-xl p-4 md:p-6" aria-labelledby="tools-title">
        <h2 id="tools-title" className="text-[15px] font-semibold text-fg">The {MCP_TOOLS.length} tools</h2>
        <ul className="mt-3 grid gap-x-6 gap-y-3 md:grid-cols-3">
          {MCP_TOOLS.map((t) => (
            <li key={t.name} className="min-w-0">
              <code className="text-[12px] font-mono font-semibold text-fg break-all">{t.name}</code>
              <div className="text-[12px] text-muted" title={t.line}>{firstSentence(t.line)}</div>
            </li>
          ))}
        </ul>
      </section>

      <Example />
    </PageFrame>
  );
}
