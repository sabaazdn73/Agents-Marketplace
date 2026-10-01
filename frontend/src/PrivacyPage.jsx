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

import React, { useEffect } from 'react';
import StandaloneBar from './shell/StandaloneBar';
import { BUY_LIVE } from './trade/buyLive';
import { TRADE_CHAIN_IDS } from './trade/tradeLive';
import { BUY_CHAINS } from './trade/chains';

// The buy flow's paragraph, and the three chains it adds to sign-in, exist
// only while the Buy panel is shown (trade/buyLive.js).
const BUY_SHOWN = BUY_LIVE;
// The Buy and Sell tabs on a stock's page, on the chains switched on in
// trade/tradeLive.js, named from the same list.
// In the order the site lists chains elsewhere, not by number.
const TRADE_ORDER = [1, 8453, 42161, 56, 4663, 999];
const TRADE_IDS = TRADE_ORDER.filter((id) => TRADE_CHAIN_IDS.includes(id));
const TRADE_CHAIN_NAMES = TRADE_IDS.map((id) => BUY_CHAINS[id]?.name).filter(Boolean);
// Who the tabs' reads go to on each chain: the endpoint lists in wagmiConfig.js
// (ETHEREUM_RPCS, BASE_READ_RPCS, ARBITRUM_RPCS, the BNB Chain transport in
// rpcTransport.js, ROBINHOOD_RPCS, HYPEREVM_RPCS), in the order they are asked.
const TRADE_RPC_WORDS = {
  1: 'on Ethereum, PublicNode (ethereum-rpc.publicnode.com), with eth.merkle.io as a backup',
  8453: 'on Base, Base\'s public endpoint, then, when it fails or turns a request away (for example when it is rate limited), PublicNode, dRPC (base.drpc.org), 1RPC (1rpc.io) and Blast (base-mainnet.public.blastapi.io) in that order, the whole list tried up to three more times if all five fail',
  42161: 'on Arbitrum, Arbitrum\'s public endpoint (arb1.arbitrum.io), with dRPC (arbitrum.drpc.org) as a backup',
  56: 'on BNB Chain, bloXroute, with Infura as a backup where it is configured',
  4663: 'on Robinhood Chain, Robinhood Chain\'s public endpoint, with PublicNode as a backup',
  999: 'on HyperEVM, Hyperliquid\'s public endpoint (rpc.hyperliquid.xyz), with no backup',
};
const TRADE_RPC_LIST = TRADE_IDS.map((id) => TRADE_RPC_WORDS[id]).filter(Boolean);
/** "a, b and c". */
const listText = (xs, sep = ', ') => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(sep)}${sep === ', ' ? ' and ' : '; and '}${xs[xs.length - 1]}`);

const UPDATED = '1 October 2026';
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

function Section({ title, id, children }) {
  return (
    <section id={id} className="mb-8 scroll-mt-6">
      <h2 className="text-base font-semibold mb-2">{title}</h2>
      <div className="text-sm text-muted space-y-3 leading-relaxed">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPage({ onBack }) {
  // A link to one section (/privacy#website) opens at that section.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView();
  }, []);
  return (
    <div className="min-h-screen bg-page text-fg">
      <div className="max-w-[1400px] mx-auto px-6 py-10">
        <StandaloneBar onBack={onBack} />

        <h1 className="text-2xl font-bold mb-1">Privacy</h1>
        <p className="text-sm text-muted mb-8">
          For the website, tnega.app, and for the Chrome extension, Tnega. Last updated {UPDATED}.
        </p>

        <Section id="website" title="The website">
          <p>
            There is no account, no email address and no password. The site sets no cookies of its
            own and runs no analytics or advertising script.
          </p>
          <p>
            The pages are served by Vercel, which receives each request as any web host does. The
            figures come from our server at {API}, hosted on Render behind Cloudflare. Your browser
            asks it for lists and measurements; those requests carry nothing about you beyond what
            any request carries (your IP address and browser). Three routes receive your wallet
            address, and only when you connect one; pages about an agent send that agent&apos;s public
            address. Both are described under &quot;Your wallet address on the website&quot;, below.
          </p>
          <p>
            Our server limits how often one network address may call it: a burst of 120 requests,
            then two a second. To count, it keeps the address (an IPv6 address by its /64) and one
            number, the time its allowance is full again, in memory only. The table is bounded, the
            least recently seen address is dropped first, and nothing is written to disk or kept
            after a restart.
          </p>
          <p>
            Fonts are served from this site. No page loads a font from a font service: the wallet
            window&apos;s own request for a Google font is removed when the site is built, and it
            uses our font instead.
          </p>
          <p>
            Wallet sign-in uses RainbowKit and WalletConnect. When a page loads, WalletConnect&apos;s
            library asks WalletConnect&apos;s servers (api.web3modal.org) for the list of wallets and
            sends its own usage events (pulse.walletconnect.org); like any request, these carry your
            IP address, and they carry this site&apos;s WalletConnect project identifier. If you
            connect a phone wallet through WalletConnect, the connection between this page and your
            wallet passes through WalletConnect&apos;s relay, which then carries your wallet&apos;s
            address and the requests you approve. Connecting a browser wallet such as MetaMask does
            not use the relay. What the site does with a connected address is under &quot;Your wallet
            address on the website&quot;.
          </p>
                  <p>
            Four routes on our server receive your connected wallet&apos;s address, always in the
            body of the request, never in the web address: My Agents (POST /api/my-jobs), the
            Hyperliquid costs read (POST /api/wallet/habits), the holdings read
            (POST /api/wallet/holdings) and the trades read (POST /api/wallet/trades). Each is described under &quot;Your wallet address on the
            website&quot;. Pages about an agent also put that agent&apos;s public owner address, not
            yours, in the web address of the requests that fetch its figures; they are listed
            there too.
          </p>
          <p>
            Some pages show other companies&apos; logos, loaded from each company&apos;s own site,
            so your browser asks that site for the image and it receives your IP address. Use with
            AI (/ai): cursor.com, code.visualstudio.com, zed.dev and cline.bot. Explore agents
            (/market, /chain/..., agent pages): app.hyperliquid.xyz and solana.com, and on some
            chains each agent&apos;s picture from api.8004scan.io or blob.8004scan.app. Data sources:
            zerion.io, storage.thegraph.com and app.hyperliquid.xyz. Hackathon partners (/partners):
            termix.ai and docs.altana.network. Two of these, zed.dev and zerion.io, answer with a
            Cloudflare cookie (__cf_bm) of their own; it is theirs, set on their domain. The home
            page, the Dashboard, sign-in and this page load no image from anyone else.
          </p>
          <p>
            What is kept in your browser, and by whom. Ours: tnega_theme (the theme you pick),
            tnega_welcomed (on a phone, that the welcome screen was shown, for this session only),
            tnega_signin_v1:&lt;address&gt; (a signed sign-in message, for 24 hours),
            tnega_lifi_q_v1 (the times of the LI.FI quotes this browser asked for in the last two
            hours, to stay inside LI.FI&apos;s limit), on a signing link or a stock page&apos;s Buy and Sell tabs tnega_tokmeta_v2:... in
            this tab&apos;s session storage (a token&apos;s decimals, read once from the chain, gone
            when the tab closes), and the list of
            your agent hires and their notifications (aam_notifications_v2, aam_tracked_jobs_v1 and
            aam_notifications_migrated_v1_to_v2).
            The wallet libraries, as they are written: wagmi.store and wagmi.recentConnectorId
            (wagmi, the wallet you connected), and on a signing link tnega-sign.store and
            tnega-sign.recentConnectorId (the same, for the wallet connected there, kept apart from
            the rest of the site), rk-version (RainbowKit), @appkit/active_namespace,
            @appkit/active_caip_network_id and @appkit/connection_status (WalletConnect&apos;s
            AppKit), base-acc-sdk.store (Coinbase&apos;s Base Account SDK), a key named after this
            site&apos;s address, written when a wallet connects, and two IndexedDB databases,
            WALLET_CONNECT_V2_INDEXED_DB (WalletConnect) and base-acc-sdk. None of it is sent to
            our server. Clearing this site&apos;s data in your browser removes all of it.
          </p>
        </Section>

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

        <Section id="website-wallet" title="Your wallet address on the website">
          <p>
            Four routes on our server receive the address of a wallet you connect to the website:
            POST /api/my-jobs, POST /api/wallet/habits, POST /api/wallet/holdings and
            POST /api/wallet/trades. All four take
            it in the body of the request, never in the web address, so it does not appear in our
            server&apos;s access log, which records the path and not the body. One more request can
            identify your wallet: when you hire an agent whose seller asks for proof of who funded the
            job, POST /api/agents/notify-funded carries your wallet&apos;s signature over that job
            (from which your address can be worked out), in the body; our server passes it to the
            agent&apos;s own endpoint and keeps nothing. No other request from the website carries
            your connected address to our server.
          </p>
          <p>
            My Agents, on the Explore agents pages, sends your connected wallet&apos;s address
            (POST /api/my-jobs) to list the agents you have hired. It is used for that one request
            and is not stored. The Dashboard does not call it.
          </p>
          <p>
            The wallet trading-costs route receives a wallet address and reads that address&apos;s
            public record on Hyperliquid: holdings, fills and fees, funding, and orders. To do that it
            sends the address to Hyperliquid&apos;s public API, in the body of the request. The address
            is not written to any database or to any log by our code, and it is not returned in the
            answer. The computed answer is kept in the server&apos;s memory for up to five minutes,
            looked up by the address, so that a second view in that time does not read Hyperliquid
            again. It is not written to disk, and it is gone when the server restarts.
          </p>
          <p>
            The Dashboard (/dashboard) calls that route when you open it with a wallet connected, for
            the connected address, and again when you press Read again. Opening the page again
            within five minutes reuses the answer it already has instead of asking. A connected
            wallet that has not signed in triggers it too: signing in changes only whether the page
            calls the address your wallet, not what is read. With no wallet connected, the page
            sends nothing.
          </p>
          <p>
            The Dashboard also sends the connected address to the holdings route
            (POST /api/wallet/holdings) when you open it with a wallet connected, and again when you
            press Read again. That route reads which of the tokenized stocks and ETFs Tnega lists the
            address holds on Ethereum, Base, Arbitrum, BNB Chain, Robinhood Chain and HyperEVM, and on
            the same chains its balance of each chain&apos;s own coin and of a named list of
            stablecoins (USDC, USDT, USDG, USD1, U, USD₮0 and USDe). To do that our server sends the
            address, inside each balance request, to each chain&apos;s RPC provider: PublicNode, with MEV Blocker as a backup, on Ethereum; on Base, the Base
            endpoint set in our server&apos;s configuration when there is one, then Base&apos;s
            public endpoint, Blast API, Tenderly, dRPC and PublicNode; Arbitrum&apos;s public
            endpoint, with PublicNode as a backup; bloXroute, with PublicNode as a backup, on BNB
            Chain; Robinhood Chain&apos;s public endpoint; and dRPC on HyperEVM. The address is not written to any database or to any log by our
            code, and it is not returned in the answer. The answer is kept in the server&apos;s memory
            for up to one minute, looked up by the address, so that a second view in that time does
            not read the chains again; it is not written to disk, and it is gone when the server
            restarts. To share its limited reads fairly, the route also counts, in memory for one
            minute, how many new reads each network address started (the same key as the request
            limit above); that count holds no wallet address. The coin prices it uses are read from
            on-chain pools and carry no address. The Vaults section sends no address: it reads the
            public vault list, which is the same for everyone. The Dashboard reads no balance from
            your browser directly and sends your address nowhere else than these routes.
          </p>
          <p>
            The Dashboard also sends the connected address to the trades route
            (POST /api/wallet/trades) when you open it with a wallet connected, again while that
            read is still going on, and when you press Read trades again. That route finds the
            address&apos;s buys and sells of the tokenized stocks and ETFs Tnega lists, to show the
            buy-in and profit or loss. To do that our server sends the address to each chain&apos;s
            RPC provider: as a filter in requests for the token transfers to and from it, and in
            requests for its balances and its count of sent transactions at past blocks. The
            providers are MEV Blocker on Ethereum; on Base, the Base endpoint set in our
            server&apos;s configuration when there is one, then Base&apos;s public endpoint, Blast
            API, Tenderly and dRPC; Arbitrum&apos;s public endpoint; Robinhood Chain&apos;s public
            endpoint; and dRPC on HyperEVM. Trades on BNB Chain are not read. The address is not
            written to any database or to any log by our code, and it is not returned in the answer.
            What the read has found so far (the transfers, their transactions and how far back it has
            read) is kept in the server&apos;s memory for at most thirty minutes after your last
            request, looked up by the address (a timer clears it every minute, whether or not
            anyone asks again), so that the read can go on where it stopped and a second view does
            not read the chains again; it is not written to disk, and it is gone when the server
            restarts. Like the holdings route, it counts in memory for one minute how many new reads
            each network address started, which holds no wallet address, and how many steps each
            wallet&apos;s read started, so that one long history cannot take the whole budget. That
            count is filed under a keyed digest of the address: the key is random, made when the
            server starts, and never stored or sent anywhere, so the digest cannot be matched
            against an address from outside the server; a timer clears each count once it is a
            minute old, checking every fifteen seconds. A wallet with more than 2,000 transfers of
            listed tokens on one chain (a pool or a router, not an ordinary wallet) is not read on
            that chain, and what was read there is dropped at once.
          </p>
          <p>
            Pages about an agent (Explore agents, and an agent&apos;s page) fetch its figures with
            that agent&apos;s owner address in the web address, so our access log records it: GET
            /api/agents/performance, /api/agents/revenue, /api/agents/pnl-summary,
            /api/agents/onchain-performance, /api/agents/termix-performance,
            /api/agents/wallet-portfolio, /api/agents/onchain-history and
            /api/agents/escrow-compatibility, each ?owner_address=&lt;address&gt;;
            /api/chain-agent/&lt;chain&gt;/&lt;id&gt;/evaluation?owner=&lt;address&gt;;
            /api/budget-mode/status?owner=&lt;address&gt;; and, only when you open a job&apos;s agent
            activity, /api/agents/activity?owner_address=&lt;address&gt;. That is the public address of
            the agent you are looking at, not yours. The Dashboard calls none of these with an
            address; it does ask /api/budget-mode/status with no address, the same request for
            everyone.
          </p>
          {/* Shown while the Buy panel is (home/sections.js, dataLive.js). */}
          {BUY_SHOWN && (<p>
            Buying a tokenized stock, from the Buy panel on a stock&apos;s page, happens between your
            browser, your wallet and LI.FI (li.quest). When you press the button for a quote, your
            browser sends LI.FI your wallet address, the chains, the two tokens and the amount; LI.FI
            answers with a route and the transaction for your wallet to sign. Nothing is sent to
            LI.FI before you press it. Before the quote, your browser reads your stablecoin balances,
            and after it your allowance to LI.FI&apos;s contract, from the chain&apos;s public RPC
            provider named below. After you sign, your browser asks LI.FI for the transaction&apos;s
            status by its hash. None of this goes to our server. Your browser keeps a count of the
            quotes it asked for in the last two hours (to stay inside LI.FI&apos;s limit) and a list
            of the buys it sent (the transaction hash, the chains, the token and the time), in its
            own storage only.
          </p>)}
          {TRADE_CHAIN_NAMES.length > 0 && (<p>
            Buying or selling a tokenized stock from the Buy and Sell tabs on a stock&apos;s page
            (on {listText(TRADE_CHAIN_NAMES)}) happens between your browser, your wallet and
            LI.FI (li.quest). When you press the button for a quote, your browser first reads our
            own stored measurements for that stock from our server, which sends no address, then
            sends LI.FI your wallet address, the chain, the two tokens and the amount; LI.FI answers
            with a route and the transaction for your wallet to sign. Nothing is sent to LI.FI
            before you press it. Your browser reads both tokens&apos; decimals, which sends no
            address, and your balance and your allowance to LI.FI&apos;s contract, which send your
            wallet address, from the public RPC providers of the stock&apos;s chain, and only while
            a Buy or Sell tab for that chain is open: {listText(TRADE_RPC_LIST, '; ')}. A backup
            receives the same request when the ones before it do not answer. The stock
            token&apos;s decimals are read a second time to check the first reading (and the
            stablecoin&apos;s, when its first reading disagrees with this site&apos;s list), which
            sends no address: where a chain has a backup, that request starts at the second
            provider and goes down the same list, with the first one last; on BNB Chain and
            HyperEVM it goes where the first reading went. A version with no measured pool price
            reads nothing and asks LI.FI nothing. After you sign, your browser asks LI.FI for the
            transaction&apos;s status by its hash. None of this goes to our server. Your browser
            keeps a count of the quotes it asked for in the last two hours, in its own storage only.
          </p>)}
          {/* The signing page (sign/SignOrderPage.jsx) is live whatever the
              Buy switch says, so this paragraph always shows. */}
          <p>
            A signing link (tnega.app/sign/...) is made by Tnega&apos;s MCP server when a tool you use
            prepares an order there. The link itself carries the order: the token, the chain, the
            amount, the wallet address and when it expires, signed by our server so it cannot be
            changed. It is encoded, not hidden: anyone who has the link can read the wallet address
            in it. Opening it sends the link to our server, which checks it and answers with the
            order. Unlike the routes above, the address is in the web address itself, so our
            server&apos;s access log records it with the path; the server writes the order nowhere
            else. From there, when you press the button for a quote, your browser sends LI.FI
            (li.quest) the wallet address, the chain, the two tokens and the amount. It reads both
            tokens&apos; decimals, which sends no address, and the wallet&apos;s balance and
            allowance, which sends the wallet address, from the chain&apos;s RPC provider: PublicNode on Ethereum, with eth.merkle.io as
            a backup; Base&apos;s public endpoint on Base, with PublicNode, dRPC
            (base.drpc.org), 1RPC (1rpc.io) and Blast (base-mainnet.public.blastapi.io) as
            backups, in that order, each asked only when the ones before it do not answer;
            Arbitrum&apos;s public endpoint on Arbitrum, with dRPC as a backup; bloXroute on BNB
            Chain, with Infura as a backup where it is configured; Robinhood Chain&apos;s public
            endpoint, with PublicNode as a backup; and Hyperliquid&apos;s public endpoint on
            HyperEVM; and your
            wallet signs; after you sign, it asks LI.FI for the transaction&apos;s status by its hash.
            None of that goes to our server. After you sign the swap, your
            browser sends our server the transaction hash with the link, so the link cannot be used
            twice; the server keeps that in memory only, and forgets it when it restarts.
          </p>
          <p>
            Signing in on the website is a signature from your wallet over a short message that
            moves no funds and approves nothing. For an ordinary wallet, such as MetaMask, it is
            checked in your browser and the signature is not sent anywhere. A contract wallet (a
            smart account or a multisig) can only be checked by its contract, so for one of those the
            address, the message and the signature are sent to the public RPC provider of the chain
            the message names: bloXroute on BNB Chain, with Infura as a backup where it is
            configured; Arbitrum&apos;s public endpoint on Arbitrum, with dRPC as a backup; and
            Robinhood Chain&apos;s public endpoint on Robinhood Chain, with PublicNode as a
            backup{BUY_SHOWN ? <>; PublicNode on Ethereum, with eth.merkle.io as a backup;
            Base&apos;s public endpoint on Base, with PublicNode as a backup; and Hyperliquid&apos;s
            public endpoint on HyperEVM</> : null}. A backup receives the same request when the first provider does not answer. If a signature
            does not match, the browser asks that provider whether the address is a contract,
            sending the address alone.
          </p>
          <p>
            The signed message is kept in your browser&apos;s own storage for 24 hours, or until you
            sign out, disconnect or switch account. It is not sent to our server, and there is no
            account, email address or password, and no login provider holding anything about you.
            Signing changes only how the site describes the address, as your wallet rather than this
            address; everything it shows for an address is public and readable without signing.
          </p>
        </Section>

        <Section title="The BNB price">
          <p>
            The US dollar value shown beside a BNB balance is read on BNB Chain by our server: the
            30-minute average price of the PancakeSwap v3 WBNB/USDT pool, taken from the pool&apos;s
            own oracle, in USDT counted as one US dollar. Your browser asks our server for the figure
            and sends nothing about you to do so; no market data provider is involved.
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
