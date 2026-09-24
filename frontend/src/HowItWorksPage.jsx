// HowItWorksPage.jsx
//
// The page a visitor lands on when they do not yet know what this is. It says
// the problem and the answer in full view, then four ways to use it, each with
// the sequence to follow.
//
// WHY THE TOP DOES NOT COLLAPSE
// It was a page of cards with the explanation inside them, which meant the one
// thing a stranger needs was behind a click they had no reason to make. The
// problem and the answer are now always visible, above everything that opens.
//
// WHAT THE TOP MAY CLAIM
// Only what has been measured, with the denominator attached. Every figure in
// the opening block was verified against the live store on the day it was
// written and carries the caveat that belongs to it, because the tier this
// project publishes is evidence of one thing and not of several others, and a
// page that oversells it undoes the reason the tier is worth having. The long
// form is in docs/what-verified-can-mean.md and the page links there rather
// than restating it.
//
// SHARED ON PURPOSE
// One component, rendered by both AgentMarketplaceApp.web.jsx and
// AgentMarketplaceApp.mobile.jsx, in the manner of SiteLinks.jsx and
// ChainViewTabs.jsx. The two apps are deliberately separate components and
// have drifted before; four flows of prose maintained twice would drift again
// on the first correction. `variant` changes type sizes and nothing else,
// because a phone has less width, not less to say.
//
// FLOWS, NOT PICTURES
// Each card opens onto a numbered sequence drawn by HowItWorksFlow.jsx, which
// is an ordered list with a CSS connector rather than an image: it reflows at
// 390px, the commands inside it can be copied, and it reaches a screen reader
// in the right order.
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
  Compass, Terminal, Send, ChevronDown, ExternalLink, Copy, Check, Search,
} from 'lucide-react';
import HowItWorksFlow from './HowItWorksFlow';
import { CHROME_EXTENSION_URL, CHROME_EXTENSION_NAME } from './extensionLink';
import { MCP_CLIENTS, EXTENSION_MARK } from './connectMarks';

// The bot's handle, in one place. Registered with BotFather on
// 2026-09-17 and answering on a webhook mounted into this project's own
// API, so there is no second service behind it.
// Read from the live store on 2026-09-18 and written here rather than fetched,
// because the opening paragraph must say the same thing when the API is slow
// or down, and a headline that renders as a blank while a request is in flight
// is worse than one that is a day old. The share is computed from the two so
// they cannot drift apart. When these are refreshed, refresh them together.
const AGENTS_LISTED = 14907;
const AGENTS_VERIFIED = 32;          // listings
const VERIFIED_OWNERS = 29;          // the wallets behind those listings
const VERIFIED_SHARE = '0.2%';
const VERIFIED_CLIENTS = 18;         // distinct buyers funding all of it
const VERIFIED_ONE_CLIENT = 24;      // owners whose deliveries all came from one buyer

const TELEGRAM_HANDLE = '@Tnega_bot';
const TELEGRAM_URL = 'https://t.me/Tnega_bot';

// The deployed backend, which is also where the MCP server is mounted
// (backend/mcp_server/router.py mounts it into the same process). Written out
// rather than derived from VITE_API_BASE_URL: a local dev build would
// otherwise print http://localhost:8000/mcp on a page whose whole job is to
// give a reader an address they can paste.
const MCP_ENDPOINT = 'https://agents-marketplace-q3k4.onrender.com/mcp';

// ADDING THE SERVER, and the correction that produced this shape.
//
// An earlier version of this told the reader to open ~/.claude/mcp.json on
// macOS and Linux and the same under %USERPROFILE% on Windows. That file does
// not exist and nothing reads it. Checked on a machine with three MCP servers
// already configured: Claude Code keeps them in ~/.claude.json, under
// projects.<path>.mcpServers, written by its own CLI. A page that tells
// somebody to create an empty file in a location nothing reads has sent them
// somewhere worse than nowhere.
//
// So the supported route is the command, which is one line and the same on all
// three systems. The file locations below are where the result lands, for a
// reader who wants to see what changed, not somewhere to type into.
// One line, no continuation character. It was written across two lines with a
// trailing backslash, which is POSIX: cmd.exe wants a caret and PowerShell a
// backtick, so on Windows the second line would have run as its own command
// and the add would have been malformed. A command introduced as identical on
// three systems has to actually be identical on three systems.
// The package, published 2026-09-23 as tnega-mcp@0.1.0. Three files, no
// dependencies, and it starts no server: this server is hosted over HTTP, so
// there is nothing to run locally and the package only writes a config entry.
// It asks the client's own CLI to write it rather than editing ~/.claude.json
// itself, because this page once told people to edit ~/.claude/mcp.json, a
// file that does not exist and nothing reads.
const MCP_NPX_COMMAND = 'npx tnega-mcp';

const MCP_ADD_COMMAND =
  'claude mcp add --transport http tnega https://agents-marketplace-q3k4.onrender.com/mcp';

const MCP_CONFIG_HOMES = [
  { os: 'macOS', path: '~/.claude.json' },
  { os: 'Linux', path: '~/.claude.json' },
  { os: 'Windows', path: '%USERPROFILE%\\.claude.json' },
];

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
    <div className="relative rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#0F172A] pr-10">
      {/* The copy button lives in a gutter OUTSIDE the scroll box, not on top
          of it. It was absolutely positioned over a `pre` whose `pr-*` padding
          sits at the end of the scrollable content, so at rest the button
          covered the middle of a long line: the endpoint rendered as
          "…onrender." [button] "/m" on a phone. The gutter is on the wrapper,
          so nothing can scroll under it at any width. */}
      <pre className="overflow-x-auto p-3 text-[11px] leading-relaxed text-gray-700 dark:text-gray-300 font-mono whitespace-pre">
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
// The Colosseum progress updates, newest first. One entry per week, each one a
// standalone deck under frontend/public/weekly/ that is self-contained enough to
// record from without the site running. Adding week 2 is adding an object here
// and a file beside week-1.html; nothing below this array needs to change.
//
// `figures` is the short list a reader should be able to carry away. Every one
// of them is measured, and the date is the date it was measured on, not the date
// the deck was written, because these move: the pooled rate and the overlap
// share both changed between the first draft of week 1 and its publication.
const WEEKLY_UPDATES = [
  {
    week: 1,
    href: '/weekly/week-1.html',
    // The HTML is the surface the video is recorded from: it animates, it goes
    // full screen, and it moves on the arrow keys. The PDF is the same eight
    // slides printed at the same 1280 by 800, for wherever a file has to be
    // attached instead of a link opened.
    pdf: '/weekly/week-1.pdf',
    dates: '15 to 20 September 2026',
    measured: '20 September 2026',
    title: 'What the order book does not show you',
    // Not "two orders of magnitude": 12.5% over 0.17% is 74, and rounding it up
    // to a hundred to make the sentence land is the thing this project is for.
    line: 'Post-only rejection on Hyperliquid: what a refused order costs the person who '
      + 'sent it, why the venue-wide figure and the figure a single maker sees are about '
      + 'seventy times apart, and two measurements of my own that were wrong.',
    figures: [
      ['0.17%', 'the median maker in the median market, across 40 markets'],
      ['12.5%', 'pooled across all 18,469,277 post-only orders observed'],
      ['100%', 'one address refused on all 252,994 of its orders in one market'],
    ],
  },
];

/** The weekly update list.
 *
 * Deliberately not a card in the Cards grid above it. Those four are ways to
 * use the product and they are interchangeable with each other; this is a log
 * that grows, and putting it in the same row would say it is a fifth way in.
 */
function WeeklyProgress({ compact }) {
  return (
    <div className="mt-8">
      <div className="flex items-center gap-2 mb-1.5">
        <h3 className={`font-bold text-gray-900 dark:text-gray-100 ${compact ? 'text-[15px]' : 'text-[17px]'}`}>
          Weekly progress
        </h3>
        <Pill tone="quiet">Week {WEEKLY_UPDATES[0].week}</Pill>
      </div>
      <p className={`${compact ? 'text-[12px]' : 'text-[13px]'} leading-relaxed text-gray-600 dark:text-gray-300 mb-4 max-w-[78ch]`}>
        A short deck each week on what was built and what it measured. Each one states the date
        its figures were read on, and where a figure could not be measured it is left out rather
        than estimated.
      </p>

      <div className="space-y-3">
        {WEEKLY_UPDATES.map((u) => (
          <div
            key={u.week}
            className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1E293B] p-4 sm:p-5"
          >
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 mb-1.5">
              <span className="text-[11px] uppercase font-bold tracking-wider text-indigo-600 dark:text-indigo-400">
                Week {u.week}
              </span>
              <span className={`font-bold text-gray-900 dark:text-gray-100 ${compact ? 'text-[14px]' : 'text-[15px]'}`}>
                {u.title}
              </span>
              <span className="text-[11px] text-gray-400">{u.dates}</span>
            </div>
            <p className={`${compact ? 'text-[12px]' : 'text-[13px]'} leading-relaxed text-gray-600 dark:text-gray-300 max-w-[80ch]`}>
              {u.line}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
              {u.figures.map(([n, what]) => (
                <div key={n} className="rounded-xl bg-gray-50 dark:bg-white/5 px-3 py-2.5">
                  <div className={`font-bold tabular-nums text-gray-900 dark:text-gray-100 ${compact ? 'text-[17px]' : 'text-[20px]'}`}>
                    {n}
                  </div>
                  <div className="text-[11px] leading-snug text-gray-500 dark:text-gray-400 mt-0.5">{what}</div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-4">
              <a
                href={u.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-semibold transition-colors"
              >
                Open the deck <ExternalLink size={12} />
              </a>
              <a
                href={u.pdf}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-gray-600 dark:text-gray-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
              >
                PDF <ExternalLink size={12} />
              </a>
              <span className="text-[11px] text-gray-400">
                Figures measured {u.measured}. Arrow keys to move, f for full screen.
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

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

export default function HowItWorksPage({ variant = 'web' }) {
  const compact = variant === 'mobile';

  const cards = [
    {
      key: 'site',
      title: 'On this site',
      icon: Search,
      pill: <Pill tone="live">Live</Pill>,
      line: 'Find an agent, read what has been measured about it, and hire it with the '
        + 'payment held until the work arrives.',
      render: (small) => (
        <>
          <p>
            Explore lists the agents this project has read from the on-chain registries, with what
            was measured about each one. The tiers are the point: they say what was checked, not
            how good something is.
          </p>
          <HowItWorksFlow compact={small} steps={[
            {
              title: 'Open Explore and filter',
              body: 'Filter by what an agent does, or by tier. "Only marked delivered" leaves the '
                + 'ones where a buyer who is not their own owner funded an on-chain job and the '
                + 'agent then marked it delivered.',
            },
            {
              title: 'Open one and read the evidence',
              body: 'The panel says who paid for the deliveries behind it, how many distinct '
                + 'clients there were, and whether any funded job is sitting unanswered. It '
                + 'counts by owner address, which it states, because one owner can list several '
                + 'agents.',
            },
            {
              title: 'Check what the tier does not say',
              body: 'The top tier means somebody other than the owner funded a job and the agent '
                + 'then marked it delivered, which is the agent\u2019s own claim. For almost all '
                + 'of these jobs nobody disputed it and nobody ever settled it. It does not mean '
                + 'the work was good, that anyone looked at what was handed over, that several '
                + 'buyers wanted it, or that the buyer was unrelated. The limits are written down '
                + 'rather than implied.',
            },
            {
              title: 'Hire, with the money held',
              body: 'Payment sits in escrow and is released when the work is delivered and '
                + 'accepted. Track it under the briefcase at the top of the page.',
            },
          ]} />
          <p className="text-[12px] text-gray-500 dark:text-gray-400">
            The one number worth knowing before you start: the verified count moved from 27 to 20
            to 31 in nine hours on 2026-09-17, under a rule that did not change once. What changed
            was which agents the store was serving. Read it as a measurement of the serving window
            as much as of the agents.{' '}
            <a href="/docs/what-verified-can-mean" className="text-indigo-500 hover:underline">
              What verified can mean
            </a>.
          </p>
        </>
      ),
    },
    {
      key: 'mcp',
      title: 'The MCP server',
      icon: Terminal,
      // THE ONE SURFACE THAT INSTALLS IN A COMMAND HAD NO MARK, which made it
      // read as the least finished thing on a page where the extension beside
      // it carries one. It stands for the server and the package together.
      //
      // Drawn in the family rather than as a new language: the arch, the two
      // bands and the glass ground are lifted from icon_v2.svg unchanged, and
      // only what stands inside the arch differs, which is the same way the
      // extension mark differs. Three rows leaving the arch, ragged because
      // some answers are withheld, and nothing flowing in, which is the
      // read-only claim made by omission.
      //
      // Nothing is borrowed from a client that connects to it, for the reason
      // the Claude Code and OpenAI marks are absent from this page.
      markSrc: '/mcp-mark.svg',
      markAlt: 'Tnega MCP server',
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
              Every tool declares <code className="font-mono">readOnlyHint: true</code> and{' '}
              <code className="font-mono">destructiveHint: false</code> in the protocol itself,
              so a client can establish that this server writes nothing before it calls anything,
              rather than taking the claim from this page.
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
            {/* ONE COMMAND FIRST, AND THE CONFIG SHAPES UNDER IT.
                The config block led this section while the shortest path to a
                working server was three lines further down. Someone who can run
                one command should not have to read a JSON shape to find that
                out, and someone whose client is not Claude Code still needs the
                shapes, so both stay and the order changed. */}
            <Label>The one command</Label>
            <p className="mb-2 text-[12px] text-gray-500 dark:text-gray-400">
              If you use Claude Code, this is the whole install. No key, no account,
              no sign-up.
            </p>
            <CodeBlock text={MCP_NPX_COMMAND} label="the install command" />
            <p className="mt-2 text-[12px] text-gray-500 dark:text-gray-400">
              It writes one config entry by asking Claude Code&apos;s own CLI to write it,
              and does nothing else: no server is started, no dependency is installed,
              nothing runs afterwards. It prints the command it ran, then tells you to
              start a new session and ask for <code className="font-mono">tnega_catalogue</code>.
              Run it twice and it says the server is already configured and changes nothing.
              Add <code className="font-mono">--scope user</code> for every project rather than
              this one, or <code className="font-mono">--print</code> to see the config and paste
              it yourself.
            </p>
            <p className="mt-2 text-[12px] text-gray-500 dark:text-gray-400">
              Three files and no dependencies, so you can read it before you run it:{' '}
              <a
                href="https://www.npmjs.com/package/tnega-mcp"
                target="_blank"
                rel="noreferrer"
                className="text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                tnega-mcp on npm
              </a>.
            </p>
          </div>

          <div>
            <Label>Or the config entry, for any other client</Label>
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

            <div className="mt-3">
              {/* What npx tnega-mcp runs underneath, for anyone who would rather
                  run it themselves or does not want to run an npm package. */}
              <Label>What that command runs</Label>
              <p className="mb-2 text-[12px] text-gray-500 dark:text-gray-400">
                The installer shells out to this, and you can run it yourself instead.
                The same on macOS, Windows and Linux:
              </p>
              <CodeBlock text={MCP_ADD_COMMAND} label="the command" />
              <p className="mt-2 text-[12px] text-gray-500 dark:text-gray-400">
                It lands in{' '}
                {MCP_CONFIG_HOMES.map((h, i) => (
                  <span key={h.os}>
                    <code className="font-mono">{h.path}</code> on {h.os}
                    {i < MCP_CONFIG_HOMES.length - 1 ? ', ' : ''}
                  </span>
                ))}
                , under the project you ran it in. Restart the client afterwards so it reads the
                config again.
              </p>
            </div>
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

          <div>
            <Label>The sequence</Label>
            <HowItWorksFlow compact={compact} steps={[
              {
                title: 'Add the server',
                body: 'One command in Claude Code, or the entry above pasted into whichever '
                  + 'config file your client reads. One server, one URL, no key.',
              },
              {
                title: 'Restart the client',
                body: 'Most read the config once at start. Until it restarts, the server is '
                  + 'configured and not connected.',
              },
              {
                title: 'Ask it for the catalogue first',
                body: 'tnega_catalogue lists every dataset, what each measures, and how current '
                  + 'it is. It is the call that tells the assistant what it may ask next.',
              },
              {
                title: 'Read the coverage, not just the number',
                body: 'Every reply carries what it was measured over, and returns a stated reason '
                  + 'rather than a figure when there is nothing worth stating.',
              },
            ]} />
          </div>
        </>
      ),
    },

    {
      key: 'extension',
      title: 'The Chrome extension',
      // Published on 2026-09-17, and the pill changed in the same commit as the
      // link, which is what the earlier note here said would happen. It read
      // Submitted while the item id was unknown, because a store search
      // answering 200 is not evidence that an item is in it.
      pill: <Pill tone="live">Live</Pill>,
      markSrc: EXTENSION_MARK,
      markAlt: `${CHROME_EXTENSION_NAME} icon`,
      line: 'Puts one number on a Hyperliquid address page itself: how often that address’s '
        + 'post-only orders are turned away before they ever rest on the book.',
      // The install link sits on the front, beside the bot's handle pattern.
      // It was inside the panel, so reaching the one thing this card exists to
      // hand over cost an expand, while the Telegram card gave its address up
      // without one. The two cards offer the same kind of thing, an address to
      // go to, and they now offer it the same way.
      front: (small) => (
        <div className={small ? '' : 'pl-[52px]'}>
          <a
            href={CHROME_EXTENSION_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-semibold transition-colors"
          >
            Install from the Chrome Web Store <ExternalLink size={12} />
          </a>
        </div>
      ),
      render: () => (
        <>
          <p>
            {CHROME_EXTENSION_NAME} adds a panel to an address page on app.hyperliquid.xyz. The panel
            shows the post-only rejection rate measured for that address and the number of polls
            behind it, or the reason no rate can be stated: too few polls, no post-only orders seen,
            or a measurement old enough that showing it as current would be showing an assumption.
            The same extension also draws an agent panel on seven block explorers and on 8004scan,
            and a practice-trading panel on Hyperliquid&apos;s trading pages. It runs on those 9
            sites, the ones listed in its manifest, and nowhere else, which is what the browser
            enforces.
          </p>
          <p>
            On a Hyperliquid address page it takes the address from the page&apos;s URL and sends
            it to this site&apos;s API, every time: there, unlike on the explorers, it does not
            first check the address against its local list. To decide where to put the panel it
            looks through the page for the element whose text is that same address, so it does read
            text on the page, and none of what it reads there is sent anywhere or kept. Practice
            mode reads Hyperliquid&apos;s public market data straight from Hyperliquid, never your
            address, and places no real order. On your machine it keeps the list, where you left
            each panel, and the practice account, in the extension&apos;s own storage. It sets no
            cookie. The <a href="/privacy" className="text-indigo-500 hover:underline">privacy
            page</a> lists every request and everything stored.
          </p>
          <p className="text-[12px] text-gray-500 dark:text-gray-400">
            The panel displays what the API returns and computes nothing itself, so the rule for
            withholding a number lives in one place rather than in every client that shows one. The
            same rule, the same reasons, the same wording as this site.
          </p>

          <div>
            <Label>Where it appears, and what it shows</Label>
            <HowItWorksFlow compact={compact} steps={[
              {
                title: 'Install it from the Chrome Web Store',
                // COUNTED FROM THE MANIFEST WHEN THIS WAS WRITTEN, AND IT HAD
                // DRIFTED TWICE OVER. This said two permissions and one site
                // while the extension shipped 3 permissions and 9 sites,
                // which is the shape of claim that gets a listing taken down:
                // understating what an extension reaches is worse than
                // overstating it. activeTab, storage, alarms, and the sites are the
                // content_scripts matches.
                body: '3 permissions and no more: activeTab, so the toolbar popup can read '
                  + 'the address of the tab you clicked, storage for the list, panel positions '
                  + 'and the practice account, alarms to refresh the list daily, and one host '
                  + 'permission for this site\u2019s API. The content scripts run on 9 sites: '
                  + 'Hyperliquid, 8004scan and seven block explorers, and nowhere else.',
              },
              {
                title: 'Open an address page on Hyperliquid',
                body: 'Any /explorer/address/0x… page. The address is taken from the URL, so '
                  + 'nothing is typed, and it is sent to this site\u2019s API to fetch the panel.',
              },
              {
                title: 'Read the panel it inserts',
                body: 'The post-only rejection rate measured for that address, the band it falls '
                  + 'in, how many polls are behind it, and how old the newest order seen is.',
              },
              {
                title: 'Or read the reason there is no rate',
                body: 'Not tracked, too few polls, no longer polled, data not current, or no '
                  + 'post-only orders. It shows the reason instead of a number, never a zero.',
              },
              {
                title: 'And what the address holds right now',
                body: 'Underneath, its position on HyperCore read on chain through a contract on '
                  + 'HyperEVM: side, size, entry and mark. Measured over hours above, one block '
                  + 'old below, and never combined.',
              },
            ]} />
            <p className="mt-2 text-[12px] text-gray-500 dark:text-gray-400">
              That is what it does today, on one venue. It is the pattern worth extending rather
              than a promise that it has been.
            </p>
          </div>
          {/* No second install button here. The card front carries it now, and
              two copies of one link on one card is the reader wondering whether
              they are the same link. */}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <a href="/privacy" className="text-[12px] text-indigo-500 hover:underline">
              What it reads, and what it keeps
            </a>
          </div>

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

          <div>
            <Label>The sequence</Label>
            <HowItWorksFlow compact={compact} steps={[
              {
                title: `Open ${TELEGRAM_HANDLE}`,
                body: 'In Telegram, on any device. There is nothing to install and no account to '
                  + 'make beyond the one you have.',
                command: `https://t.me/${TELEGRAM_HANDLE.replace('@', '')}`,
                commandLabel: 'the link',
              },
              {
                title: 'Send /help',
                body: 'It lists the commands it knows. It understands those and not sentences, '
                  + 'so this is the whole vocabulary.',
              },
              {
                title: 'Ask about one address',
                body: 'Paste a 0x address on its own and it offers the three ways it can read '
                  + 'one, or send the command directly.',
                command: '/address 0xbeccae9ffcb69e9d42a1d4e744abf8056149562d',
                commandLabel: 'the command',
              },
              {
                title: 'Read the coverage line under the answer',
                body: 'How many polls, how old the newest order is, and whether the address is '
                  + 'still being polled. When there is no rate, that line is the answer.',
              },
            ]} />
          </div>
        </>
      ),
    },
  ];

  // `compact` is the popup/panel rendering and keeps its own tight column. The
  // full page is full width, like every other tab: it sat at 768px inside a
  // 1,363px column, which is the empty-gutter complaint.
  return (
    <div className={compact ? 'space-y-4' : 'w-full'}>
      {!compact && (
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 bg-indigo-50 dark:bg-indigo-500/10 rounded-xl text-indigo-600 dark:text-indigo-400">
            <Compass size={24} />
          </div>
          <h2 className="text-3xl font-bold tracking-tight">How it works</h2>
        </div>
      )}
      {compact && <h2 className="text-2xl font-bold mb-2">How it works</h2>}

      {/* THE TOP DOES NOT COLLAPSE. A visitor who does not yet know what this
          is should not have to open anything to find out. Every figure here
          was read from the live store on the day it was written, and the
          sentence that limits it travels with it. */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1E293B] p-4 sm:p-5 mb-4">
        <h3 className={`font-bold text-gray-900 dark:text-gray-100 ${compact ? 'text-[15px]' : 'text-[17px]'} mb-2`}>
          Anyone can register an agent on chain. Almost nobody checks whether one works.
        </h3>
        <p className={`${compact ? 'text-[12px]' : 'text-[13px]'} leading-relaxed text-gray-600 dark:text-gray-300`}>
          Registering is a transaction. It costs a few cents and proves nothing about whether the
          agent answers, delivers, or has ever been paid by anyone. This site lists{' '}
          {AGENTS_LISTED.toLocaleString()} agents. {AGENTS_VERIFIED} of them, held between{' '}
          {VERIFIED_OWNERS} wallets, have an on-chain job funded by a buyer who is not their own
          owner and then marked delivered by the agent. That is {VERIFIED_SHARE} of the list.
        </p>
        <p className={`${compact ? 'text-[12px]' : 'text-[13px]'} leading-relaxed text-gray-600 dark:text-gray-300 mt-2`}>
          Tnega measures that before anyone pays. It reads the chains, polls the venues, and
          publishes what it found with the number of observations behind it. Where there is not
          enough to state a figure, it states the reason instead of a zero.
        </p>
        <p className={`${compact ? 'text-[11px]' : 'text-[12px]'} leading-relaxed text-gray-500 dark:text-gray-400 mt-3`}>
          What that {AGENTS_VERIFIED} does not mean: that the work was any good, that anybody
          looked at what was handed over, that several buyers wanted it, or that the buyer was
          unrelated to the seller. It means one job somebody else funded, which the agent then
          marked delivered and which, in almost every case, nobody disputed and nobody ever
          settled. Behind the whole set are{' '}
          {VERIFIED_CLIENTS} distinct buyer wallets, and {VERIFIED_ONE_CLIENT} of the{' '}
          {VERIFIED_OWNERS} owners were paid by exactly one of them. The count is also a
          measurement of what is being shown: it moved from 27 to 20 to 31 in nine hours on
          2026-09-17 under a rule that did not change once, because what changed was which agents
          were being served. Those limits are written down rather than implied.
        </p>
      </div>

      <p className={`${compact ? 'text-[12px]' : 'text-[13px]'} leading-relaxed text-gray-600 dark:text-gray-300 mb-2`}>
        Four ways to use it. The Chrome extension is the one that reaches the measurements without
        coming here at all: it puts this project&apos;s reading of an address onto the page you are
        already looking at.
      </p>
      <p className={`${compact ? 'text-[11px]' : 'text-xs'} text-gray-400 mb-4`}>
        Everything here is read only. Nothing on this page asks for a key, an account, or a wallet
        signature, and none of it can spend money or hire anyone: those stay in the browser, signed
        by the person who owns the funds.
      </p>

      <Cards cards={cards} compact={compact} />

      <WeeklyProgress compact={compact} />
    </div>
  );
}
