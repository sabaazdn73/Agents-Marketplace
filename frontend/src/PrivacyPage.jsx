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
// Every claim below has a line of code behind it, and the built package was
// checked against this list rather than the other way round. If a future
// build stops matching it, this page is what has to be renegotiated, not
// quietly left behind.
//
//   reads the identifier from the URL   extension/shared.js, subjectFromUrl
//   reads element text to place the     extension/panels/hyperliquid.js,
//     panel, on app.hyperliquid.xyz     insertionPoint. Nowhere else.
//     only, and sends none of it
//   asks only about addresses that      extension/filter.js, member()
//     pass a local membership test
//   downloads that list on a schedule   extension/sw.js, chrome.alarms
//   stores the list and nothing else    chrome.storage.local, base64
//   sends an address or an agent id     extension/shared.js, fetchSubject
//   no cookies on those requests        credentials: "omit", same function
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
import { ArrowLeft } from 'lucide-react';

const UPDATED = '18 September 2026';
const API = 'https://agents-marketplace-q3k4.onrender.com';
const CONTACT = 'sabaazad93@gmail.com';

// The sites the extension is loaded on, written out rather than summarised.
// A policy that says "block explorers" is asking to be trusted about which
// ones; a list can be checked against the manifest in a minute.
const SITES = [
  ['app.hyperliquid.xyz', 'address pages'],
  ['etherscan.io', 'address pages'],
  ['bscscan.com', 'address pages'],
  ['basescan.org', 'address pages'],
  ['arbiscan.io', 'address pages'],
  ['monadscan.com', 'address pages'],
  ['hyperevmscan.io', 'address pages'],
  ['robinhoodchain.blockscout.com', 'address pages'],
  ['8004scan.io', 'agent and owner pages'],
];

function Section({ title, children }) {
  return (
    <section className="mb-8">
      <h2 className="text-base font-semibold mb-2">{title}</h2>
      <div className="text-sm text-gray-600 dark:text-gray-300 space-y-3 leading-relaxed">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPage({ onBack }) {
  return (
    <div className="min-h-screen bg-[#F4F5F8] dark:bg-[#0F172A] text-gray-900 dark:text-white">
      <div className="max-w-2xl mx-auto px-6 py-10">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors mb-8"
        >
          <ArrowLeft size={16} /> Back to Explore
        </button>

        <h1 className="text-2xl font-bold mb-1">Privacy</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">
          For the Chrome extension, Tnega. Last updated {UPDATED}.
        </p>

        <Section title="What the extension is">
          <p>
            Tnega adds one panel to a page you are already looking at, when that page is about
            something this project has measured. There are two subjects. On a block explorer or on
            8004scan, the panel is about a registered ERC-8004 agent: whether its service answers,
            what on-chain jobs name it, who paid for the work it delivered, and whether a
            budget funded to it through this project's own escrow was ever drawn against. On app.hyperliquid.xyz, the panel is about post-only
            order behaviour: how often that address&apos;s post-only orders are refused before they
            rest on the book, or the reason no rate can be stated.
          </p>
          <p>
            It runs one computation, and only one: a membership test against a list it keeps on
            your machine, to decide whether to ask the server about an address at all. It computes
            no rate, no score, no ranking and no verdict. Those are measured on the server and
            rendered here as sent.
          </p>
        </Section>

        <Section title="Where it runs">
          <p>
            On these nine sites and no others. This is the content script match list from the manifest,
            which is what Chrome enforces: anywhere else the extension is not loaded and no code of
            ours runs.
          </p>
          <ul className="list-none space-y-1 font-mono text-xs text-gray-500 dark:text-gray-400">
            {SITES.map(([host, where]) => (
              <li key={host}>
                {host}
                <span className="font-sans text-gray-400 dark:text-gray-500"> · {where}</span>
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
            which is what that site puts in the URL instead of an address.
          </p>
          <p>
            On app.hyperliquid.xyz, and only there, it also reads text in the page, for one purpose:
            to decide where to put the panel it looks through the page&apos;s elements for the one
            whose text is that same address, and walks up from it to find the container to insert
            before. That site renders its content after the script runs and gives its elements
            generated class names, so there is nothing stable to anchor to and the text is the
            anchor. Nothing it reads that way is sent anywhere, stored, or used for anything except
            positioning.
          </p>
          <p>
            On every other site it reads no page text at all. Those pages carry the identifier in
            the URL and offer an element with a fixed name to insert beside, so there is nothing to
            search the page for.
          </p>
          <p>
            Nowhere does it read form fields, balances, wallet state, private keys, or anything a
            wallet extension would hold, and it modifies nothing that was already on the page.
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
            Two things, and the second one is the reason this section is longer than it used to be.
          </p>
          <p className="font-semibold text-gray-900 dark:text-white">
            One. A scheduled download, which is telemetry.
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
            that an install exists and roughly when it is active. We do not record it, join it to
            anything, or build a profile from it, and it is not wired to any analytics product. But
            an earlier version of this page said the extension sends no telemetry, and a call home
            from every install on a timer is telemetry whatever else it is. It is named here rather
            than argued about.
          </p>
          <p>
            If that is not a trade you want, the extension is not for you, and uninstalling stops it
            completely. There is no setting that keeps the panel and stops the download, because the
            download is what lets the panel exist without sending us every address you look at.
          </p>
          <p className="font-semibold text-gray-900 dark:text-white">
            Two. One identifier, only when the list says we have measured it.
          </p>
          <p>
            When the page you are on is about an address or an agent that is in that list, the
            extension asks our server for what was measured:
          </p>
          <p className="font-mono text-xs break-all text-gray-500 dark:text-gray-400">
            GET {API}/api/extension/subject/&lt;identifier&gt;
          </p>
          <p>
            The identifier is either an address that was already in the page URL, or a chain name
            and agent number that were already in the page URL. Nothing else goes with it. The
            request is sent with credentials omitted, so no cookies travel with it. There is no
            account, no sign-in, no device identifier and no key in the extension.
          </p>
          <p>
            When the page is about something not in that list, which is the usual case on a block
            explorer, nothing is sent and no panel appears. This is the point of the whole
            arrangement: we do not learn which pages you visit, because the test that decides
            happens on your machine and most of the time its answer is no.
          </p>
          <p className="font-semibold text-gray-900 dark:text-white">
            Three. An address you type into the toolbar popup.
          </p>
          <p>
            The popup has a box you can paste an address into, and what you paste is sent to the
            same endpoint. The local list is deliberately not consulted first here. Typing an
            address into a box is asking us about it, which is a different act from visiting a page
            that happens to mention it, and checking the list first would mean the popup could not
            answer for an address registered since the list was last built. So that address reaches
            us whether or not we have measured it.
          </p>
          <p>
            What we do learn is the other half of that sentence, and it is worth stating plainly:
            for the addresses we have measured, we learn that somebody looked at one, and when. The
            list is not a filter that hides the interesting lookups. It is a filter that stops the
            uninteresting ones being sent at all.
          </p>
          <p>
            Like any web server, ours receives the connection metadata that comes with an HTTP
            request: a source IP address, a user agent string, and the time. Nothing in the service
            reads those or writes them anywhere. Our hosting providers, Render and Cloudflare, keep
            their own short-lived request logs, which is true of every site you visit. We do not
            query them, join them to anything, or build a profile from them.
          </p>
        </Section>

        <Section title="What it stores">
          <p>
            The list, and nothing else about you. It is held in chrome.storage.local, which is
            storage private to this extension on this machine, and it is about 1 MB. It is stored
            as text rather than as raw bytes because Chrome measures that storage by the size of
            the JSON it would write, and raw bytes cost more than ten times as much there.
          </p>
          <p>
            Beside it the extension keeps the date the list was built, so it knows when to fetch the
            next one. If you dismiss a panel it also keeps a note that you dismissed it, so it stays
            dismissed.
          </p>
          <p>
            That is the whole of it. No browsing history, no addresses you looked at, no page
            content, no cookie set by the extension, no localStorage, no sessionStorage and no
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
            It reads. It cannot spend anything, sign anything, or hire anyone.
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
            <b className="text-gray-900 dark:text-white">activeTab</b>: so the popup can read the
            URL of the tab you clicked on, to find the identifier there. Chosen instead of the tabs
            permission, which would grant the same reading for every tab all the time.
          </p>
          <p>
            <b className="text-gray-900 dark:text-white">storage</b>: to keep the downloaded list
            between page loads. Without it the list would be fetched again on every page, which
            would be worse for you and for us.
          </p>
          <p>
            <b className="text-gray-900 dark:text-white">alarms</b>: to schedule the daily refresh.
            Chrome shuts down an idle background worker, so a timer inside it would not survive, and
            this is the mechanism Chrome provides instead.
          </p>
          <p>
            <b className="text-gray-900 dark:text-white">
              Host access to agents-marketplace-q3k4.onrender.com
            </b>
            : the one server the extension contacts, for the list and for the measurements. No other
            host is contacted.
          </p>
          <p>
            <b className="text-gray-900 dark:text-white">Content scripts</b> on the eight sites
            listed under &quot;Where it runs&quot;: drawing the panel on those pages is the whole
            feature.
          </p>
          <p>
            There are no other permissions. The extension holds no scripting, cookies, webRequest,
            history, bookmarks, downloads or clipboard permission, and it does not request access to
            all sites.
          </p>
        </Section>

        <Section title="Children">
          <p>
            The extension is not directed at children and collects nothing that could identify
            anyone, of any age.
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
            <a href={`mailto:${CONTACT}`} className="text-indigo-500 hover:underline">
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
