// ConnectPage.jsx
//
// The Connect tab: every way into this site's measurements that is not the
// site itself. Three cards, because there are three.
//
// SHARED ON PURPOSE
// One component, rendered by both AgentMarketplaceApp.web.jsx and
// AgentMarketplaceApp.mobile.jsx, in the manner of SiteLinks.jsx and
// ChainViewTabs.jsx. The two apps are deliberately separate components and
// have drifted before; three cards of prose maintained twice would drift again
// on the first correction. `variant` changes type sizes and nothing else,
// because a phone has less width, not less to say.
//
// CARDS, NOT A LIST
// This page is the front door for somebody arriving from outside, so it is
// built from the shapes the rest of the site already uses: the card, the pill
// and the expanding panel of the chain views and DeFiCategoryPanels.jsx,
// rather than the stacked prose of a documentation page. A card's front says
// enough to know whether it is the one you want; the detail sits behind it.
//
// PANEL BEHAVIOUR
// One open at a time, mounted on first open and never unmounted afterwards.
// Collapsing hides with CSS. The rule and its reasoning are documented in
// DeFiCategoryPanels.jsx: conditional rendering re-runs a panel's work on
// every reopen and throws away anything a reader had part-done inside it. It
// is reimplemented here rather than imported for the reason HyperliquidView
// gives for its own copy: that component paints its background from an inline
// `surface` colour, and this page carries its dark treatment in Tailwind
// variants like the chain views do.
//
// NOT EVERY CARD OPENS
// The Telegram card has nothing behind it, so it has no panel and no chevron.
// A card that opens onto one sentence teaches a reader that opening cards on
// this page is not worth the click.
//
// WHAT IS NOT HERE
// An on-site agent was here until 2026-09-17. It ran a bounded tool-calling
// loop over the same six tools this page documents, and it rested on a model
// quota that runs out, so nearly every turn ended in its refusal path. A way
// in that is unavailable most of the time is worse than one that is absent,
// and MCP is the better arrangement anyway: the caller brings their own model,
// so the cost of answering sits with whoever asked. It was removed rather than
// left to degrade, and this note is here so the removal reads as a decision
// rather than as something forgotten.

import React, { useCallback, useState } from 'react';
import {
  Plug, Terminal, Send, ChevronDown, ExternalLink, Copy, Check,
} from 'lucide-react';
import { CHROME_EXTENSION_URL, CHROME_EXTENSION_NAME } from './extensionLink';
import { MCP_CLIENTS, EXTENSION_MARK } from './connectMarks';

// The bot's handle, in one place. Registered with BotFather on
// 2026-09-17 and answering on a webhook mounted into this project's own
// API, so there is no second service behind it.
const TELEGRAM_HANDLE = '@Tnega_bot';
const TELEGRAM_URL = 'https://t.me/Tnega_bot';

// The deployed backend, which is also where the MCP server is mounted
// (backend/mcp_server/router.py mounts it into the same process). Written out
// rather than derived from VITE_API_BASE_URL: a local dev build would
// otherwise print http://localhost:8000/mcp on a page whose whole job is to
// give a reader an address they can paste.
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

/** A status word beside a card's title, so the state of a way in is next to
 *  its name rather than three paragraphs down. */
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

/** One client's mark, with its name beside it.
 *
 *  The image is the vendor's own asset from the vendor's own domain, which is
 *  the footing every mark on this site sits on; connectMarks.js carries each
 *  one's provenance and the terms it is shown under. If it fails to load the
 *  name stays: a missing image must not take a client off the list, because
 *  the list is the claim and the picture is decoration. */
function ClientMark({ client, compact }) {
  const [failed, setFailed] = useState(false);
  const size = compact ? 15 : 17;
  const box = { width: size, height: size };
  // A vendor that publishes a pair gets both, swapped by the theme the way the
  // vendor swaps them itself. Nothing is inverted or recoloured: a mark shown
  // in a colour its owner did not publish is an altered mark.
  const pair = Boolean(client.markDark);
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${client.mark ? 'pl-1.5' : 'pl-2'} pr-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-white/[0.03]`}
      title={client.support}
    >
      {client.mark && !failed && (
        <>
          <img
            src={client.mark}
            alt=""
            width={size}
            height={size}
            loading="lazy"
            onError={() => setFailed(true)}
            className={`shrink-0 object-contain ${pair ? 'dark:hidden' : ''}`}
            style={box}
          />
          {pair && (
            <img
              src={client.markDark}
              alt=""
              width={size}
              height={size}
              loading="lazy"
              className="shrink-0 object-contain hidden dark:block"
              style={box}
            />
          )}
        </>
      )}
      <span className={`${compact ? 'text-[10px]' : 'text-[11px]'} font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap`}>
        {client.name}
      </span>
    </span>
  );
}

/** The cards. One open at a time, mounted once, hidden with CSS.
 *
 *  A card with no `render` is not a button and gets no chevron: there is
 *  nothing behind it to open. */
function Cards({ cards, compact }) {
  // All collapsed on arrival, which is where this page differs from the chain
  // views and from DeFiCategoryPanels: there the panel is the content and the
  // titles are a way to switch between parts of it, so opening the first one
  // is right. Here the three fronts are the content. Opening one by default
  // would push the other two below the fold and hide the only question this
  // page has to answer, which is which of the three a reader wants.
  const [openKey, setOpenKey] = useState(null);
  // Every key ever opened. Only grows, so nothing already mounted unmounts.
  const [mounted, setMounted] = useState(() => new Set());
  const toggle = useCallback((key) => {
    setMounted((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
    setOpenKey((prev) => (prev === key ? null : key));
  }, []);

  return (
    <div className="space-y-3">
      {cards.map((card) => {
        const {
          key, title, icon: Icon, markSrc, markAlt, invertOnDark,
          line, pill, front, render,
        } = card;
        const isOpen = Boolean(render) && openKey === key;
        const head = (
          <>
            <span className="flex items-start gap-3 min-w-0">
              <span className="p-2 rounded-xl shrink-0 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                {markSrc
                  ? (
                    <img
                      src={markSrc}
                      alt={markAlt || ''}
                      width={compact ? 16 : 18}
                      height={compact ? 16 : 18}
                      className={`object-contain ${invertOnDark ? 'dark:invert' : ''}`}
                      style={{ width: compact ? 16 : 18, height: compact ? 16 : 18 }}
                    />
                  )
                  : <Icon size={compact ? 16 : 18} />}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-2 flex-wrap">
                  <span className={`font-bold text-gray-900 dark:text-gray-100 ${compact ? 'text-[14px]' : 'text-[15px]'}`}>
                    {title}
                  </span>
                  {pill}
                </span>
                <span className={`block ${compact ? 'text-[11px]' : 'text-[12px]'} leading-relaxed text-gray-600 dark:text-gray-400 mt-0.5`}>
                  {line}
                </span>
              </span>
            </span>
            {render && (
              <ChevronDown
                size={16}
                className={`shrink-0 mt-1 opacity-50 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
              />
            )}
          </>
        );

        return (
          <div
            key={key}
            className="bg-white dark:bg-[#1E293B] rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden"
          >
            {render ? (
              <button
                type="button"
                onClick={() => toggle(key)}
                aria-expanded={isOpen}
                aria-controls={`connect-panel-${key}`}
                className="w-full flex items-start justify-between gap-3 px-4 py-3.5 text-left hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors"
              >
                {head}
              </button>
            ) : (
              <div className="w-full flex items-start justify-between gap-3 px-4 py-3.5 text-left">
                {head}
              </div>
            )}

            {front && (
              <div className={`px-4 ${render ? 'pb-3' : 'pb-4'}`}>{front(compact)}</div>
            )}

            {render && mounted.has(key) && (
              <div
                id={`connect-panel-${key}`}
                hidden={!isOpen}
                className="px-4 pb-4 pt-3 border-t border-gray-100 dark:border-gray-800/60 space-y-4 text-[13px] leading-relaxed text-gray-600 dark:text-gray-300"
              >
                {render(compact)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Label({ children }) {
  return (
    <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-500 mb-1.5">
      {children}
    </div>
  );
}

export default function ConnectPage({ variant = 'web' }) {
  const compact = variant === 'mobile';

  const cards = [
    {
      key: 'mcp',
      title: 'The MCP server',
      icon: Terminal,
      pill: <Pill tone="live">Live</Pill>,
      line: 'Point your own assistant at this site and it can read every measurement here, '
        + 'with the coverage behind each one. No key, no account, no sign-up.',
      // The marks sit on the front, because "can the tool I already use read
      // this" is the question the card has to answer before it is opened.
      front: (small) => (
        <div className={small ? '' : 'pl-[52px]'}>
          <div className="flex flex-wrap gap-1.5">
            {MCP_CLIENTS.map((c) => <ClientMark key={c.name} client={c} compact={small} />)}
          </div>
          <p className={`${small ? 'text-[10px]' : 'text-[11px]'} text-gray-400 dark:text-gray-500 mt-1.5`}>
            Each one checked against its own documentation for remote servers over HTTP, because
            supporting MCP and reaching a server on the internet are not the same thing. A client
            missing from this list was either not checked or could not be confirmed against a
            server shaped like this one, and the two are not distinguished here. Some appear by
            name without a mark: either their trademark terms do not permit showing it here, or no
            asset of theirs could be verified.
          </p>
        </div>
      ),
      render: () => (
        <>
          <p>
            MCP is the protocol an assistant uses to call somebody else&apos;s tools. Pointing one at
            this server gives it the measurements behind this site, so it answers from them instead
            of guessing. The model stays yours: this server holds data and runs no model of its own.
          </p>

          <div>
            <Label>Endpoint</Label>
            <CodeBlock text={MCP_ENDPOINT} label="the endpoint" />
            <p className="mt-2 text-[12px] text-gray-500 dark:text-gray-400">
              It speaks JSON-RPC over POST, with no authentication and no sign-up. There is no
              server-initiated stream: a GET returns 405 and says to POST instead. Every reply
              carries the coverage behind its number, and returns a stated reason rather than a
              figure when there is nothing worth stating.
            </p>
          </div>

          <div>
            <Label>The six tools</Label>
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
            <Label>Adding it to a client</Label>
            {/* The shapes differ between clients by more than they look, and a
                key in the wrong place fails quietly. So the copyable block is
                labelled with the one client it is exactly right for, and every
                other client's own shape is in the list under it rather than
                left for the reader to assume. */}
            <p className="mb-2 text-[12px] text-gray-500 dark:text-gray-400">
              Most clients read a config file, and they do not agree on its shape. This is the
              entry Claude Code takes:
            </p>
            <CodeBlock text={MCP_CONFIG_SNIPPET} label="the Claude Code config entry" />
            <p className="mt-2 text-[12px] text-gray-500 dark:text-gray-400">
              The others differ, sometimes by one word. Each line below is that client&apos;s own
              shape, from its own documentation, with the date it was read.
            </p>
            <ul className="mt-3 space-y-1.5">
              {MCP_CLIENTS.map((c) => (
                <li key={c.name} className="text-[12px] text-gray-600 dark:text-gray-400">
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{c.name}</span>
                  {': '}{c.howTo}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <Label>Calling it without a client</Label>
            <p className="mb-2 text-[12px] text-gray-500 dark:text-gray-400">
              Anything that can POST JSON can call it. This asks the server what tools it has:
            </p>
            <CodeBlock text={MCP_CURL_SNIPPET} label="the request" />
          </div>
        </>
      ),
    },

    {
      key: 'extension',
      title: 'The Chrome extension',
      // The pill says what is known. The listing was submitted; the Web Store
      // assigns an item its id at publication and that id is the only part of
      // the URL nobody can guess, so the link is the store's own search for
      // the listing's exact name rather than the item page. Calling that
      // "Published" would be reporting an assumption as a fact. When the item
      // URL is known, extensionLink.js takes it and this pill changes in the
      // same commit.
      pill: <Pill tone="quiet">Submitted</Pill>,
      markSrc: EXTENSION_MARK,
      markAlt: `${CHROME_EXTENSION_NAME} icon`,
      line: 'Puts one number on a Hyperliquid address page itself: how often that address’s '
        + 'post-only orders are turned away before they ever rest on the book.',
      render: () => (
        <>
          <p>
            {CHROME_EXTENSION_NAME} adds a panel to an address page on app.hyperliquid.xyz. The panel
            shows the post-only rejection rate measured for that address and the number of polls
            behind it, or the reason no rate can be stated: too few polls, no post-only orders seen,
            or a measurement old enough that showing it as current would be showing an assumption.
          </p>
          <p>
            It takes the address from the page&apos;s URL, which already contains it, and sends that
            one address to this site&apos;s API. To decide where to put the panel it looks through
            the page for the element whose text is that same address, so it does read text on the
            page, and none of what it reads there is sent anywhere or kept: the address from the URL
            is the only thing that leaves the browser. It does not read form fields, balances or
            wallet state. It stores nothing, on your machine or off it: no cookie, no local storage,
            no background worker. It runs on app.hyperliquid.xyz and nowhere else, which is the
            single entry in its manifest and is what the browser enforces.
          </p>
          <p className="text-[12px] text-gray-500 dark:text-gray-400">
            The panel displays what the API returns and computes nothing itself, so the rule for
            withholding a number lives in one place rather than in every client that shows one. The
            same rule, the same reasons, the same wording as this site.
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
            listing&apos;s own page. The Web Store assigns an item its id at publication, and until
            that id is known here, a direct install link would be a guess.
          </p>
        </>
      ),
    },

    {
      key: 'telegram',
      title: 'The Telegram bot',
      icon: Send,
      pill: <Pill tone="live">Live</Pill>,
      line: 'Name one address or one agent in a chat and get back what this site has measured '
        + 'for it, carrying the same coverage line every other surface here carries.',
      front: (small) => (
        <div className={small ? '' : 'pl-[52px]'}>
          <a
            href={TELEGRAM_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-semibold transition-colors"
          >
            {TELEGRAM_HANDLE} <ExternalLink size={12} />
          </a>
        </div>
      ),
      render: () => (
        <>
          <p>
            Send it <code className="font-mono text-[12px]">/help</code> for the commands, or paste a{' '}
            <code className="font-mono text-[12px]">0x</code> address and it will offer the three
            ways it can read one: the Hyperliquid post-only rejection rate, the ERC-8183 jobs
            behind that provider, and the budgets funded to it.
          </p>
          <p className="text-[12px] text-gray-500 dark:text-gray-400">
            There is no model behind it. It runs the same fixed queries the MCP server exposes, so
            it understands commands rather than sentences, and it says so rather than guessing. A
            number that is not current is not shown: the reply carries the reason instead, in the
            same words the extension and this site use. An address that left the collector&apos;s
            set gets told that, and its stored counts are labelled as describing that earlier
            period rather than now.
          </p>
          <p className="text-[12px] text-gray-500 dark:text-gray-400">
            It answers one question at a time and refuses a second rather than queueing it, which
            is the same rule the MCP server holds. It reads; it cannot spend anything, sign
            anything or hire anyone.
          </p>
        </>
      ),
    },
  ];

  return (
    <div className={compact ? 'space-y-4' : 'max-w-3xl'}>
      {!compact && (
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-indigo-50 dark:bg-indigo-500/10 rounded-xl text-indigo-600 dark:text-indigo-400">
            <Plug size={24} />
          </div>
          <h2 className="text-3xl font-bold tracking-tight">Connect</h2>
        </div>
      )}
      {compact && <h2 className="text-2xl font-bold mb-1">Connect</h2>}

      <p className={`${compact ? 'text-sm' : 'mb-2'} text-gray-600 dark:text-gray-300`}>
        Three ways to reach what this site has measured without opening this site. Two work today
        and one is with the Chrome Web Store, not published yet. Each card says which it is.
      </p>
      <p className={`${compact ? 'text-[11px] text-gray-400' : 'text-xs text-gray-400 mb-6'}`}>
        Everything here is read only. Nothing on this page asks for a key, an account, or a wallet
        signature, and none of it can spend money or hire anyone: those stay in the browser, signed
        by the person who owns the funds.
      </p>

      <Cards cards={cards} compact={compact} />
    </div>
  );
}
