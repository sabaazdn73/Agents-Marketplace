// ConnectPage.jsx
//
// The Connect tab: every way into this site's measurements that is not the
// site itself.
//
// SHARED ON PURPOSE
// -----------------
// One component, rendered by both AgentMarketplaceApp.web.jsx and
// AgentMarketplaceApp.mobile.jsx, in the manner of SiteLinks.jsx and
// ChainViewTabs.jsx. The two apps are deliberately separate components and
// have drifted before; four sections of prose maintained twice would drift
// again on the first correction. `variant` changes type sizes and nothing
// else, because a phone has less width, not less to say.
//
// WHAT EACH SECTION HAS TO CARRY
// ------------------------------
// Written for a reader who has used none of these. The MCP section states the
// endpoint and the six tools rather than explaining the protocol's design;
// mcp/DESIGN.md holds the reasoning and a visitor does not need it. The
// Telegram section says the bot does not exist, in the same shape as the
// extension's withheld reasons (extension/shared.js): what the situation is,
// then what exists and what does not. "Coming soon" is a promise nobody has
// made.
//
// The ask-the-agent section is written against an endpoint another agent is
// building. It probes POST /api/ask once on mount and reads the answer:
// a 404 means the route is not deployed and the section says the feature is
// not available yet; anything else means the route is there. A failed fetch
// is a third state and says so rather than being reported as absence, which
// is the same rule the rest of this site follows about an unreachable source.
// The ask UI itself is not here: it sits at the top of the listing, where a
// visitor meets it first, in AskTnega.jsx. This section documents the
// endpoint for somebody who wants to call it from their own code.

import React, { useEffect, useState } from 'react';
import {
  Plug, Terminal, Chrome, Send, MessageCircleQuestion,
  ExternalLink, Copy, Check, Loader2,
} from 'lucide-react';
import { CHROME_EXTENSION_URL, CHROME_EXTENSION_NAME } from './extensionLink';

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || 'http://localhost:8000';

/** The same address, but absolute, for printing in a command a reader copies.
 *
 *  VITE_API_BASE_URL is deliberately allowed to be the empty string for a
 *  same-origin deploy (.env.example says so), and the fetches above are
 *  correct with it. A printed `curl -s /api/ask` is not a command: it is a
 *  path with a curl in front of it. So anything a reader is asked to paste
 *  falls back to this page's own origin. */
const API_DISPLAY_URL =
  import.meta.env?.VITE_API_BASE_URL
  || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8000');

// The deployed backend, which is also where the MCP server is mounted
// (backend/mcp_server/router.py mounts it into the same process). Written out
// rather than derived from API_BASE_URL: a local dev build would otherwise
// print http://localhost:8000/mcp on a page whose whole job is to give a
// reader an address they can paste.
const MCP_ENDPOINT = 'https://agents-marketplace-q3k4.onrender.com/mcp';

// The six tools, one line each, in the order a caller meets them. Taken from
// the manifest in backend/mcp_server/tools.py, shortened to what a reader
// needs to decide whether to call one.
const MCP_TOOLS = [
  {
    name: 'tnega_catalogue',
    line: 'Every dataset this server holds, what each one measures, the keys it accepts and how current it is. Takes no arguments. Call it first.',
  },
  {
    name: 'tnega_resolve',
    line: 'Turns one string, an address or a token id or an agent id or a chain view name, into the datasets that accept it. Up to five candidates, from stored data only.',
  },
  {
    name: 'tnega_get',
    line: 'One record in full from one dataset: an agent, a Hyperliquid address, a provider’s job record, a budget record, a chain view.',
  },
  {
    name: 'tnega_list',
    line: 'A filtered page of compact rows from one dataset, up to 50 at a time, with a cursor for the next page. Rows, not whole records.',
  },
  {
    name: 'tnega_summary',
    line: 'One aggregate over one dataset, counts and totals and breakdowns, with the coverage behind it. Never a list of records.',
  },
  {
    name: 'tnega_series',
    line: 'One measurement over time, newest first. Today that is Hyperliquid post-only rejection in 10 second buckets for one address.',
  },
];

const MCP_CONFIG_SNIPPET = `{
  "mcpServers": {
    "tnega": {
      "type": "http",
      "url": "${MCP_ENDPOINT}"
    }
  }
}`;

const MCP_CURL_SNIPPET = `curl -s ${MCP_ENDPOINT} \\
  -H 'Content-Type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`;

/** Is the ask endpoint deployed?
 *
 *  GET /api/ask/readiness first. It is mounted by the same router as the POST
 *  route (backend/ask/router.py), it exists to answer exactly this question,
 *  and a GET costs the backend nothing.
 *
 *  A 404 there is confirmed against POST /api/ask before this page tells a
 *  reader the feature is absent, so a readiness route that is retired later
 *  cannot make a working endpoint look missing. An empty question is the
 *  cheap way to ask: the route's own validation refuses it before any work.
 *
 *  404 from both is absence. A validation error, a 405, a 500 all mean
 *  something is mounted at that path. A fetch that never lands is neither,
 *  and gets its own state rather than being reported as absence. */
function useAskEndpoint() {
  // 'checking' | 'live' | 'absent' | 'unreachable'
  const [state, setState] = useState('checking');
  useEffect(() => {
    const ctl = new AbortController();
    const giveUp = setTimeout(() => ctl.abort(), 8000);
    fetch(`${API_BASE_URL}/api/ask/readiness`, { signal: ctl.signal })
      .then((r) => {
        if (r.status !== 404) return 'live';
        return fetch(`${API_BASE_URL}/api/ask`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: '' }),
          signal: ctl.signal,
        }).then((p) => (p.status === 404 ? 'absent' : 'live'));
      })
      .then(setState)
      .catch(() => setState('unreachable'))
      .finally(() => clearTimeout(giveUp));
    return () => { clearTimeout(giveUp); ctl.abort(); };
  }, []);
  return state;
}

/** A copyable block. The address and the config are things a reader has to
 *  move somewhere else, and retyping an endpoint by hand is how a wrong one
 *  ends up in a config file. */
function CodeBlock({ text, label }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    // clipboard is unavailable on an insecure origin and in some embedded
    // browsers. Failing quietly leaves the text on screen to select by hand,
    // which still works.
    navigator.clipboard?.writeText(text)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); })
      .catch(() => {});
  };
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#0F172A] p-3 pr-11 text-[11px] leading-relaxed text-gray-700 dark:text-gray-300 font-mono whitespace-pre">
{text}
      </pre>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Copied' : `Copy ${label}`}
        title={copied ? 'Copied' : `Copy ${label}`}
        className="absolute top-2 right-2 p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1E293B] text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors"
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
}

/** A status word beside a section's title, so the state of a way in is next
 *  to its name rather than three paragraphs down. */
function Pill({ tone = 'quiet', children }) {
  const tones = {
    live: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    quiet: 'border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-400',
    none: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  };
  return (
    <span className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded-full border ${tones[tone] || tones.quiet}`}>
      {children}
    </span>
  );
}

function Section({ icon: Icon, title, pill, children, compact }) {
  return (
    <section className="bg-white dark:bg-[#1E293B] rounded-3xl border border-gray-200 dark:border-gray-800 p-4 sm:p-5 shadow-sm">
      <div className="flex items-center gap-2.5 flex-wrap mb-2">
        <div className="p-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
          <Icon size={compact ? 16 : 18} />
        </div>
        <h3 className={`${compact ? 'text-base' : 'text-lg'} font-bold text-gray-900 dark:text-gray-100`}>{title}</h3>
        {pill}
      </div>
      <div className="space-y-3 text-[13px] leading-relaxed text-gray-600 dark:text-gray-300">
        {children}
      </div>
    </section>
  );
}

export default function ConnectPage({ variant = 'web' }) {
  const compact = variant === 'mobile';
  const ask = useAskEndpoint();

  return (
    <div className={compact ? 'space-y-4' : 'max-w-3xl'}>
      {!compact && (
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-indigo-50 dark:bg-indigo-500/10 rounded-xl text-indigo-600 dark:text-indigo-400"><Plug size={24} /></div>
          <h2 className="text-3xl font-bold tracking-tight">Connect</h2>
        </div>
      )}
      {compact && <h2 className="text-2xl font-bold mb-1">Connect</h2>}

      <p className={`${compact ? 'text-sm' : 'text-gray-600 dark:text-gray-300 mb-2'} text-gray-600 dark:text-gray-300`}>
        Four ways to reach what this site has measured without opening this site. Three of them work
        today. One does not exist, and says so below.
      </p>
      <p className={`${compact ? 'text-[11px] text-gray-400' : 'text-xs text-gray-400 mb-8'}`}>
        Everything here is read only. Nothing on this page asks for a key, an account, or a wallet
        signature, and none of it can spend money or hire anyone: those stay in the browser, signed
        by the person who owns the funds.
      </p>

      <div className="space-y-4">

        {/* 1. The MCP server. */}
        <Section icon={Terminal} title="The MCP server" pill={<Pill tone="live">Live</Pill>} compact={compact}>
          <p>
            MCP is the protocol an AI assistant uses to call somebody else&apos;s tools. Pointing one at
            this server gives it the measurements behind this site, so it can answer from them
            instead of guessing.
          </p>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-500 mb-1.5">
              Endpoint
            </div>
            <CodeBlock text={MCP_ENDPOINT} label="the endpoint" />
            <p className="mt-2 text-[12px] text-gray-500 dark:text-gray-400">
              It speaks JSON-RPC over POST, with no authentication and no sign-up. There is no
              server-initiated stream: a GET returns 405 and says to POST instead. Every reply
              carries the coverage behind its number, and returns a stated reason rather than a
              figure when there is nothing worth stating.
            </p>
          </div>

          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-500 mb-1.5">
              The six tools
            </div>
            <ul className="space-y-2">
              {MCP_TOOLS.map((t) => (
                <li key={t.name} className="border-l-2 border-gray-200 dark:border-gray-700 pl-3">
                  <code className="text-[12px] font-mono font-semibold text-gray-900 dark:text-gray-100">{t.name}</code>
                  <div className="text-[12px] text-gray-600 dark:text-gray-400">{t.line}</div>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[12px] text-gray-500 dark:text-gray-400">
              The list is six and stays six. A new measurement becomes a row in
              {' '}<code className="font-mono">tnega_catalogue</code>, not a seventh tool, so a client
              that read this list a month ago is still correct.
            </p>
          </div>

          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-500 mb-1.5">
              Pointing an agent at it
            </div>
            <p className="mb-2 text-[12px] text-gray-500 dark:text-gray-400">
              Most MCP clients read a config file. Add one entry to it:
            </p>
            <CodeBlock text={MCP_CONFIG_SNIPPET} label="the config entry" />
            <p className="mt-2 mb-2 text-[12px] text-gray-500 dark:text-gray-400">
              Anything that can POST JSON can call it without a client at all. This asks the server
              what tools it has:
            </p>
            <CodeBlock text={MCP_CURL_SNIPPET} label="the request" />
          </div>
        </Section>

        {/* 2. The Chrome extension. */}
        {/* The pill says what is known. The listing was submitted; the Web
            Store assigns the item id at publication and that id is the only
            part of the URL nobody can guess, so the link below is the store's
            own search for the listing's exact name rather than the item page.
            Calling that "Published" would be reporting an assumption as a
            fact, which is the thing this site is about not doing. When the
            item URL is known, extensionLink.js takes it and this pill becomes
            Published in the same commit. */}
        <Section icon={Chrome} title="The Chrome extension" pill={<Pill tone="quiet">Submitted</Pill>} compact={compact}>
          <p>
            {CHROME_EXTENSION_NAME} adds a panel to an address page on app.hyperliquid.xyz. The panel
            shows how often that address&apos;s post-only orders are turned away before they ever rest
            on the book, or the reason no rate can be stated for it.
          </p>
          <p className="text-[12px] text-gray-500 dark:text-gray-400">
            It reads the address out of the page&apos;s own URL and sends that one address to this
            site&apos;s API. It does not read page text, balances, form fields or wallet state, and it
            stores nothing, on your machine or off it.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <a
              href={CHROME_EXTENSION_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-semibold transition-colors"
            >
              Find it on the Chrome Web Store <ExternalLink size={12} />
            </a>
            <a href="/privacy" className="text-[12px] text-indigo-500 hover:underline">
              What it reads, and what it keeps
            </a>
          </div>
          <p className="text-[12px] text-gray-500 dark:text-gray-400">
            That link is the store&apos;s search for the listing&apos;s exact name, not the
            listing&apos;s own page. The Web Store assigns an item its id at publication, and
            until that id is known here, a direct install link would be a guess.
          </p>
        </Section>

        {/* 3. The Telegram bot, which does not exist. */}
        <Section icon={Send} title="The Telegram bot" pill={<Pill tone="none">Not built</Pill>} compact={compact}>
          <p>
            There is no Telegram bot. Nothing has been written for it, no handle is registered, and
            no date is set, so there is nothing here to connect to.
          </p>
          <p className="text-[12px] text-gray-500 dark:text-gray-400">
            It is listed because a reader looking for a way in should find out here that this one is
            not among them, rather than searching Telegram for a bot that is not there. If it gets
            built, its handle appears in this section.
          </p>
        </Section>

        {/* 4. Asking the agent on this site. The section adjusts to whether
             POST /api/ask is deployed; see useAskEndpoint above. */}
        <Section
          icon={MessageCircleQuestion}
          title="Asking the agent directly"
          pill={
            ask === 'checking' ? <Pill>Checking</Pill>
              : ask === 'live' ? <Pill tone="live">Live</Pill>
                : ask === 'absent' ? <Pill tone="none">Not available yet</Pill>
                  : <Pill tone="none">Cannot tell</Pill>
          }
          compact={compact}
        >
          <p>
            One question in plain language, answered from the same measurements the MCP server
            serves, without choosing a tool or a dataset yourself. It is a POST to{' '}
            <code className="font-mono text-[12px]">/api/ask</code> on this site&apos;s API with the
            question as JSON.
          </p>

          {ask === 'checking' && (
            <p className="flex items-center gap-2 text-[12px] text-gray-500 dark:text-gray-400">
              <Loader2 size={13} className="animate-spin" />
              Checking whether the endpoint is answering.
            </p>
          )}

          {ask === 'absent' && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
              <div className="text-[13px] font-semibold text-amber-700 dark:text-amber-400">
                Not available yet
              </div>
              <div className="text-[12px] text-gray-600 dark:text-gray-400 mt-1">
                The endpoint returns 404, which means it is not deployed. It is being built now.
                This section checks on every visit and will describe how to use it, here, once it
                answers.
              </div>
            </div>
          )}

          {ask === 'live' && (
            <div className="space-y-2">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-[12px] text-gray-600 dark:text-gray-400">
                The endpoint is answering. Post a question to it and read the reply:
              </div>
              <CodeBlock
                text={`curl -s ${API_DISPLAY_URL}/api/ask \\\n  -H 'Content-Type: application/json' \\\n  -d '{"question":"Which tracked Hyperliquid makers are spraying?"}'`}
                label="the request"
              />
              <p className="text-[12px] text-gray-500 dark:text-gray-400">
                The answer carries the coverage behind it, the same as every other reply from this
                site, and states a reason rather than a number where there is nothing to state.
                {' '}<code className="font-mono">GET /api/ask/readiness</code> says what it can
                answer right now, and what it cannot.
              </p>
            </div>
          )}

          {ask === 'unreachable' && (
            <p className="text-[12px] text-gray-500 dark:text-gray-400">
              The API did not answer at all, so whether this endpoint exists is not known right now.
              That is a different thing from it being absent, and it is not being reported as
              absence. Reload once the API is reachable.
            </p>
          )}
        </Section>

      </div>
    </div>
  );
}
