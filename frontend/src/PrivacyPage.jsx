// PrivacyPage.jsx
//
// The privacy policy for version 0.2.0 of the extension, which covers more
// than one site and is called Tnega rather than Tnega for Hyperliquid.
//
// THIS WAS PrivacyPage.next.jsx UNTIL 0.2.0 WAS PACKAGED
// It was held as a separate file on purpose while 0.1.0 was the published
// build: putting a policy on the internet describing storage, a background
// worker and nine hosts that no shipped build had would have been the same
// defect as a policy claiming less than the code does, pointed the other way.
// It replaced the 0.1.0 page by `git mv` in the commit that packaged 0.2.0,
// and the 0.1.0 page was deleted in the same commit rather than kept beside
// it, because two privacy pages in a tree is how the wrong one gets routed.
//
// Every claim below has a line of code behind it. Re-checked on 2026-09-24
// against extension-store/tnega-0.2.0.zip, the package that shipped, rather
// than against extension/, which has moved on since in shared.js, content.js
// and paper.js. The storage keys, hosts and request paths are the same in both.
//
//   reads the identifier from the URL   shared.js, subjectFromUrl and
//                                       addressFromUrl; paper.js,
//                                       paperCoinFromUrl (/trade/<coin>)
//   reads page text to place panels,    content.js, place(); paper.js,
//     app.hyperliquid.xyz only,         findTheirItem() ("Available to
//     and sends none of it              Trade", "Spread")
//   explorer and 8004scan panels ask    explorer.js and scan8004.js,
//     only after the membership test    askMembership() before fetchSubject
//   Hyperliquid address panel asks      content.js, sync() -> render() ->
//     for EVERY address page            fetchAddress(), no membership test
//   popup asks without the test for     popup.js, show() for a URL address
//     an address; agent ids are tested    and the typed box; diagnose() for
//                                       an agent id, after askMembership()
//   downloads the list on a schedule    sw.js, chrome.alarms
//   practice mode polls Hyperliquid     paperSim.js, hlInfo(), POST
//                                       api.hyperliquid.xyz/info; paper.js
//                                       setInterval(tick, 4000)
//   stores, in chrome.storage.local     tnega_filter_v1 (sw.js),
//                                       tnega_collapsed, tnega_positions
//                                       (shared.js), tnega_paper_v1
//                                       (paperSim.js), tnega_paper_open,
//                                       tnega_paper_others_open (paper.js)
//   no cookies on any request           credentials: "omit" in shared.js,
//                                       sw.js and paperSim.js
//   nine content-script sites           manifest.json content_scripts
//
// If the extension ever does more than this, this page is wrong and has to
// change in the same commit. A policy that claims less than the code does is
// as wrong as one that claims more.
//
// Rendered as a standalone route, like /status and /data-sources, so it is
// reachable without the app shell and can be linked from the Web Store
// listing. Web and mobile share it: App.jsx returns this component for
// /privacy before it picks between the two app shells, and the footer entry
// lives in SiteLinks, which both apps render.

import React from 'react';
import StandaloneBar from './shell/StandaloneBar';

const UPDATED = '25 September 2026';
const API = 'https://agents-marketplace-q3k4.onrender.com';
const CONTACT = 'sabaazad93@gmail.com';

// The sites the extension is loaded on, written out rather than summarised.
// A policy that says "block explorers" is asking to be trusted about which
// ones; a list can be checked against the manifest in a minute.
const SITES = [
  ['app.hyperliquid.xyz', 'address pages and trade pages'],
  ['etherscan.io', 'address pages'],
  ['bscscan.com', 'address pages'],
  ['basescan.org', 'address pages'],
  ['arbiscan.io', 'address pages'],
  ['monadscan.com', 'address pages'],
  ['hyperevmscan.io', 'address pages'],
  ['robinhoodchain.blockscout.com', 'every page'],
  ['8004scan.io', 'agent and owner pages'],
];

function Section({ title, children }) {
  return (
    <section className="mb-8">
      <h2 className="text-base font-semibold mb-2">{title}</h2>
      <div className="text-sm text-muted space-y-3 leading-relaxed">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPage({ onBack }) {
  return (
    <div className="min-h-screen bg-page text-fg">
      <div className="max-w-[1400px] mx-auto px-6 py-10">
        <StandaloneBar onBack={onBack} />

        <h1 className="text-2xl font-bold mb-1">Privacy</h1>
        <p className="text-sm text-muted mb-8">
          For the Chrome extension, Tnega, and for the two routes on the website that receive your own wallet address. Last updated {UPDATED}.
        </p>

        <Section title="What the extension is">
          <p>
            Tnega adds a panel to a page you are already looking at. There are two subjects. On a
            block explorer or on 8004scan, the panel is about a registered ERC-8004 agent: whether
            its service answers, what on-chain jobs name it, who paid for the work it delivered,
            and whether a budget funded to it through this project&apos;s own AgentBudgetEscrow was
            ever drawn against. It appears there only when the address or agent is in the list
            described below. On an address page on app.hyperliquid.xyz, the panel is about post-only
            order behaviour: how often that address&apos;s post-only orders are refused before they
            rest on the book, or the reason no rate can be stated. That panel appears on every
            Hyperliquid address page, measured or not.
          </p>
          <p>
            The measurements are made on the server and rendered here as sent. The extension
            computes no rate, no score, no ranking and no verdict about an address or an agent.
            It runs a membership test against a list it keeps on your machine, to decide whether to
            ask the server about an address on a block explorer or on 8004scan at all.
          </p>
          <p>
            It also has a practice mode on Hyperliquid&apos;s trading pages: a panel where you can
            place pretend trades against Hyperliquid&apos;s live public prices, with a pretend
            balance, and see what they would have done. That part does compute, on your machine:
            fills, fees, funding and liquidation for the pretend positions. No order is sent to
            Hyperliquid, nothing is signed, and your real account is not touched.
          </p>
        </Section>

        <Section title="Where it runs">
          <p>
            On these nine sites and no others. This is the content script match list from the manifest,
            which is what Chrome enforces: anywhere else the extension is not loaded and no code of
            ours runs.
          </p>
          <ul className="list-none space-y-1 font-mono text-xs text-muted">
            {SITES.map(([host, where]) => (
              <li key={host}>
                {host}
                <span className="font-sans text-muted "> · {where}</span>
              </li>
            ))}
          </ul>
          <p>
            Each entry is an exact hostname. Testnet siblings of several of these sites exist, such
            as sepolia.etherscan.io and testnet.monadscan.com, and they are deliberately not matched:
            they are different chains, and mainnet measurements shown on a testnet page would be
            wrong rather than merely unhelpful.
          </p>
        </Section>

        <Section title="What it reads">
          <p>
            The identifier in the page URL. On an address page that is the address, which the URL
            already contains. On an 8004scan agent page it is a chain name and an agent number,
            which is what that site puts in the URL instead of an address. On a Hyperliquid trading
            page it is the market name, from a URL such as /trade/BTC, for practice mode.
          </p>
          <p>
            On app.hyperliquid.xyz, and only there, it also reads text in the page, for one purpose:
            deciding where to put what it draws. That site renders its content after the script
            runs and gives its elements generated class names, so there is nothing stable to anchor
            to and the text is the anchor. On an address page it looks for the element whose text
            is that same address. On a trading page, practice mode looks for Hyperliquid&apos;s own
            order form and order book by words that appear in them, such as &quot;Available to
            Trade&quot; and &quot;Spread&quot;, and reads the text of the surrounding block to
            confirm the match. That block can include figures Hyperliquid shows about your own
            account, such as the amount available to trade. What it reads this way is compared
            against a fixed list of words and then dropped: it is not sent anywhere, stored, or used
            for anything except positioning.
          </p>
          <p>
            On every other site it reads no page text at all. Those pages carry the identifier in
            the URL and offer an element with a fixed name to insert beside, so there is nothing to
            search the page for.
          </p>
          <p>
            It does not read what you type into Hyperliquid&apos;s forms, your wallet state, private
            keys, or anything a wallet extension would hold. It adds its own panels beside the
            page&apos;s content and does not change what was already there. The one thing it moves
            is the scroll position: opening the practice panel scrolls Hyperliquid&apos;s page so
            their order book stays in view, and closing it scrolls back.
          </p>
          <p>
            When you click the toolbar icon, the popup reads the current tab&apos;s URL to find an
            identifier there. Chrome grants that through the activeTab permission, which applies to
            the tab you clicked on and only because you clicked. The extension does not hold the
            tabs permission and cannot see your other tabs. The popup returns both readings for any
            address: the agents it holds and whether they answer, and the Hyperliquid rejection
            rate, each with its own reason where there is nothing behind it.
          </p>
        </Section>

        <Section title="What leaves your browser">
          <p>
            Five kinds of request, to two hosts: our server, and for practice mode only,
            Hyperliquid&apos;s public API. Every one is sent with credentials omitted, so no cookies
            travel with any of them. There is no account, no sign-in, no device identifier and no
            key in the extension.
          </p>
          <p className="font-semibold text-fg">
            One. A scheduled download from our server, which is telemetry.
          </p>
          <p>
            About once a day the extension asks our server whether the list has changed. That check
            is a few hundred bytes and returns a version string. Only when the version differs from
            the one it holds does it download the list itself, which is about 1 MB, so on most days
            nothing but the check happens. Neither request carries an address, an identifier, an
            account or a cookie, and the list is the same file for everybody.
          </p>
          <p>
            It still reaches our server from your IP address, on a schedule, whether or not you
            visited any of the sites above. That is a signal we did not have before. It tells us
            that an install exists and roughly when it is active. We do not join it to anything or
            build a profile from it, and it is not wired to any analytics product. But an earlier
            version of this page said the extension sends no telemetry, and a call home from every
            install on a timer is telemetry whatever else it is. It is named here rather than
            argued about.
          </p>
          <p>
            If that is not a trade you want, the extension is not for you, and uninstalling stops it
            completely. There is no setting that keeps the panel and stops the download, because the
            download is what lets the block explorer and 8004scan panels exist without sending us
            every address you look at there.
          </p>
          <p className="font-semibold text-fg">
            Two. On a block explorer or 8004scan, one identifier, only when the list says we have
            measured it.
          </p>
          <p>
            When the page you are on is about an address or an agent that is in that list, the
            extension asks our server for what was measured:
          </p>
          <p className="font-mono text-xs break-all text-muted">
            GET {API}/api/extension/subject/&lt;identifier&gt;
          </p>
          <p>
            The identifier is either an address that was already in the page URL, or a chain name
            and agent number that were already in the page URL. Nothing else goes with it. When the
            page is about something not in that list, which is the usual case on a block explorer,
            nothing is sent and no panel appears. On those sites we do not learn which pages you
            visit, because the test that decides happens on your machine and most of the time its
            answer is no.
          </p>
          <p className="font-semibold text-fg">
            Three. On a Hyperliquid address page, that address, every time.
          </p>
          <p>
            On app.hyperliquid.xyz the list is not consulted. Every address page, a URL of the form
            /explorer/address/0x…, sends its address to our server, measured or not:
          </p>
          <p className="font-mono text-xs break-all text-muted">
            GET {API}/api/hyperliquid/address/&lt;address&gt;
          </p>
          <p>
            So for Hyperliquid address pages we do learn which addresses are opened, and when. This
            is the one place the extension reports a page you merely visited.
          </p>
          <p className="font-semibold text-fg">
            Four. An address you ask about in the toolbar popup.
          </p>
          <p>
            The popup sends two things to the same endpoint as Two, without consulting the list: an
            address you paste into its box, and, when you open the popup on a page whose URL
            contains an address, that address. Opening the popup is asking us about the page, which
            is a different act from visiting a page that happens to mention something, and checking
            the list first would mean the popup could not answer for an address registered since
            the list was last built. So that address reaches us whether or not we have measured it.
            On an 8004scan agent page, whose URL names an agent rather than an address, the popup
            does check the list first and sends the agent only if it is there.
          </p>
          <p className="font-semibold text-fg">
            Five. Practice mode, to Hyperliquid rather than to us.
          </p>
          <p>
            On a Hyperliquid trading page, the practice-mode script asks Hyperliquid&apos;s public
            API for public market data:
          </p>
          <p className="font-mono text-xs break-all text-muted">
            POST https://api.hyperliquid.xyz/info
          </p>
          <p>
            It asks for the market&apos;s trading rules, current prices, funding rates and hourly
            candles, the fee schedule, and the order book while the practice panel is open. It does
            this about every four seconds for as long as a trading page is open, whether or not the
            practice panel is. The requests name a market and never your address: the fee schedule
            is asked for the zero address, so it is the same request for everybody. Hyperliquid
            receives these requests from your IP address, as it already receives the page you are
            on.
          </p>
          <p>
            What we learn from Two, Three and Four, stated plainly: that somebody looked at an
            address or agent, and when. On block explorers and 8004scan that is only for what we
            have measured. On Hyperliquid address pages and in the popup it is for anything.
          </p>
          <p>
            Like any web server, ours receives the connection metadata that comes with an HTTP
            request: a source IP address, a user agent string, and the time. The server&apos;s own
            access log writes one line per request into our hosting provider&apos;s log, which
            timestamps it: the request path, which for Two, Three and Four includes the
            identifier, and a client address that is either yours or our host&apos;s proxy,
            depending on a hosting setting. No code of ours reads your IP address or user agent
            from the extension&apos;s requests or stores them anywhere else. Render and Cloudflare
            also keep their own request logs, for as long as they choose to keep them, which is true
            of every site you visit. We do not query them, join them to anything, or build a
            profile from them.
          </p>
        </Section>

        <Section title="What it stores">
          <p>
            Everything it keeps is in chrome.storage.local, which is storage private to this
            extension on this machine. None of it is sent anywhere.
          </p>
          <p>
            The list, about 1 MB, with its version, the date it was built and when it was stored,
            so it knows when to fetch the next one. It is stored as text rather than as raw bytes
            because Chrome measures that storage by the size of the JSON it would write, and raw
            bytes cost more than ten times as much there.
          </p>
          <p>
            For each site where you collapse a panel or drag it somewhere, the site&apos;s hostname
            with that choice: collapsed, or the position you left it at. Nothing about which page on
            that site.
          </p>
          <p>
            For practice mode: the practice account, meaning its pretend balance, the pretend
            positions and resting orders it holds, the ones it has closed, and a log of its fills
            and refusals, with their times and the markets they were on. Also whether the practice
            panel, and its list of positions on other markets, were last left open. Nothing in it
            comes from your real Hyperliquid account or your wallet.
          </p>
          <p>
            That is the whole of it. No browsing history, no addresses you looked at, no page
            content, no cookie set by the extension, and nothing in localStorage, sessionStorage or
            IndexedDB. Removing the extension clears all of it.
          </p>
          <p>
            There is a background service worker. It exists to fetch the list, hold it, and answer
            the question &quot;is this address in it&quot; for whichever tab asks. It has no other
            job, it does not run while you browse a site the extension does not match, and Chrome
            shuts it down when it is idle.
          </p>
        </Section>

        <Section title="What it does not do">
          <p>
            No advertising, no tracking pixels, and no third-party scripts. Nothing is loaded from a
            CDN at runtime, and no code is fetched at runtime at all: every file the extension
            executes ships inside the package and is reviewable in the source. The list it downloads
            is data, never code, and nothing in it is executed or turned into markup.
          </p>
          <p>
            The scheduled download described above is the only thing that could be called analytics,
            and it is described above rather than denied here. No data is sold, rented, or shared
            with anyone, and none of it is used for creditworthiness or lending.
          </p>
          <p>
            It reads. It cannot spend anything, sign anything, or hire anyone, and practice mode
            places no real order.
          </p>
        </Section>

        <Section title="Where the numbers come from">
          <p>
            They are two different collections, gathered differently, and the panel says which one
            it is showing.
          </p>
          <p>
            The agent measurements come from reading the ERC-8004 registries on chain. That is an
            exhaustive ingest rather than a sample: every agent registered on a chain this project
            covers is read, not a set chosen for activity or for who is looking. Whether an
            agent&apos;s service answers is then checked by calling the endpoint the agent itself
            published, on a schedule, and each panel carries the date its check was made.
          </p>
          <p>
            The Hyperliquid measurements are collected on a schedule from Hyperliquid&apos;s public
            API, for a set of addresses chosen for their trading activity, not for who is looking at
            them.
          </p>
          <p>
            In both cases, asking for an address does not add it to anything. What you are shown was
            measured before you asked, and your request does not change what is collected.
          </p>
        </Section>

        <Section title="Permissions, and why each one exists">
          <p>
            <b className="text-fg">activeTab</b>: so the popup can read the
            URL of the tab you clicked on, to find the identifier there. Chosen instead of the tabs
            permission, which would grant the same reading for every tab all the time.
          </p>
          <p>
            <b className="text-fg">storage</b>: to keep what is listed under
            &quot;What it stores&quot; between page loads: the list, each site&apos;s panel
            position and collapsed state, and the practice account.
          </p>
          <p>
            <b className="text-fg">alarms</b>: to schedule the daily refresh.
            Chrome shuts down an idle background worker, so a timer inside it would not survive, and
            this is the mechanism Chrome provides instead.
          </p>
          <p>
            <b className="text-fg">
              Host access to agents-marketplace-q3k4.onrender.com
            </b>
            : our server, for the list and for the measurements.
          </p>
          <p>
            <b className="text-fg">Content scripts</b> on the nine sites
            listed under &quot;Where it runs&quot;: drawing the panels on those pages is the whole
            feature.
          </p>
          <p>
            Two hosts are contacted, and only two: our server, and api.hyperliquid.xyz for practice
            mode. The second needs no host permission, because Hyperliquid&apos;s API accepts
            requests from any site and the script making them runs on Hyperliquid&apos;s own page.
            It is listed here because a permission list alone would hide it.
          </p>
          <p>
            There are no other permissions. The extension holds no scripting, cookies, webRequest,
            history, bookmarks, downloads or clipboard permission, and it does not request access to
            all sites.
          </p>
        </Section>

        <Section title="Your wallet address on the website">
          <p>
            Two routes on our server receive the address of a wallet you connect to the website.
            Both take it in the body of the request, never in the web address, so it does not appear
            in our server&apos;s access log, which records the path and not the body.
          </p>
          <p>
            My Agents sends your connected wallet&apos;s address to list the agents you have hired. It
            is used for that one request and is not stored.
          </p>
          <p>
            The wallet trading-costs route receives a wallet address and reads that address&apos;s
            public record on Hyperliquid: holdings, fills and fees, funding, and orders. To do that it
            sends the address to Hyperliquid&apos;s public API, in the body of the request. The address
            is not written to any database or to any log by our code, and it is not returned in the
            answer. The computed answer is kept in the server&apos;s memory for up to five minutes,
            looked up by the address, so that a second view in that time does not read Hyperliquid
            again. It is not written to disk, and it is gone when the server restarts. The website
            page that will call this route is still being built; nothing on the site calls it yet.
          </p>
        </Section>

        <Section title="Children">
          <p>
            The extension is not directed at children. It asks nobody for a name, an email, an
            account or a sign-in. What reaches our server with each request, including the access
            log line, is described under &quot;What leaves your browser&quot;.
          </p>
        </Section>

        <Section title="Changes">
          <p>
            If the extension starts doing something this page does not describe, this page changes
            in the same release. The date at the top says when it was last edited.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions about this policy, or about what the extension does, go to{' '}
            <a href={`mailto:${CONTACT}`} className="text-accent hover:underline">
              {CONTACT}
            </a>
            . The extension&apos;s source is in the public repository linked in the site footer, so
            any claim here can be checked against the code rather than taken on trust.
          </p>
        </Section>
      </div>
    </div>
  );
}
