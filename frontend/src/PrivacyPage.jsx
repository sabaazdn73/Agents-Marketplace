// PrivacyPage.jsx
//
// The privacy policy for the Chrome extension, at /privacy.
//
// The Web Store requires a hosted policy and will not accept one that
// describes a different product, so this is written from the extension's own
// source rather than from a template. Every claim below has a line of code
// behind it:
//
//   reads the address from the URL      extension/shared.js, addressFromUrl
//   reads element text to place the      extension/content.js, insertionPoint
//     panel, and sends none of it
//   sends it to one endpoint            extension/shared.js, fetchAddress
//   no cookies on that request          credentials: "omit", same function
//   stores nothing                      no chrome.storage, no localStorage,
//                                       no cookies anywhere in extension/
//   no background worker                no "background" key in the manifest
//   touches no other site               content_scripts matches, one entry
//   two Chrome APIs in total            chrome.runtime.getURL in content.js,
//                                       chrome.tabs.query in popup.js
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

const UPDATED = '15 September 2026';
const ENDPOINT = 'https://agents-marketplace-q3k4.onrender.com/api/hyperliquid/address/';
const CONTACT = 'sabaazad93@gmail.com';

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
          <ArrowLeft size={16} /> Back to Agents and Bots House
        </button>

        <h1 className="text-2xl font-bold mb-1">Privacy</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">
          For the Chrome extension, Tnega for Hyperliquid. Last updated {UPDATED}.
        </p>

        <Section title="What the extension is">
          <p>
            Tnega for Hyperliquid adds one panel to address pages on app.hyperliquid.xyz. The
            panel shows the post-only rejection rate measured for that address, or the reason no
            rate is being shown. It is a display surface. It decides nothing and computes
            nothing.
          </p>
        </Section>

        <Section title="What it reads">
          <p>
            The address in the page URL. On a route like /explorer/address/0x… the address is
            already there, so the extension never has to look for it in the page.
          </p>
          <p>
            It does read text in the page, for one purpose: to decide where to put the panel it
            looks through the page&apos;s elements for the one whose text is that same address, and
            then walks up from it to find the container to insert before. Nothing it reads that way
            is sent anywhere, stored, or used for anything except positioning. It does not read form
            fields, balances, wallet state, private keys, or anything a wallet extension would hold,
            and the only thing that leaves your browser is the address that was already in the URL.
          </p>
          <p>
            When you click the toolbar icon, the popup reads the current tab&apos;s URL to find
            an address there. Chrome grants that through the activeTab permission, which applies
            to the tab you clicked on and only because you clicked. The extension does not hold
            the tabs permission and cannot see your other tabs.
          </p>
        </Section>

        <Section title="What it sends, and where">
          <p>
            One request, to one place. For the address on screen it calls:
          </p>
          <p className="font-mono text-xs break-all text-gray-500 dark:text-gray-400">
            GET {ENDPOINT}&lt;address&gt;
          </p>
          <p>
            The request carries the address and nothing else. It is sent with credentials
            omitted, so no cookies go with it. There is no account, no sign-in, no device
            identifier, and no key in the extension. The server replies with the stored
            measurements for that address, and the panel renders the reply.
          </p>
          <p>
            Like any web server, ours receives the connection metadata that comes with an HTTP
            request: a source IP address, a user agent string, and the time. Nothing in the
            service reads those or writes them anywhere. Our hosting providers, Render and
            Cloudflare, keep their own short-lived request logs, which is true of every site you
            visit. We do not query them, join them to anything, or build a profile from them.
          </p>
        </Section>

        <Section title="What it stores">
          <p>
            Nothing. There is no chrome.storage call, no localStorage, no sessionStorage, no
            IndexedDB, and no cookie set by the extension. There is no background service worker
            and no process that keeps running when the page is closed. Close the tab and the
            extension has kept nothing, on your machine or off it.
          </p>
        </Section>

        <Section title="Where it runs">
          <p>
            On app.hyperliquid.xyz only. That is the single entry in the manifest&apos;s content
            script matches, which is what Chrome enforces: on any other site the extension is
            not loaded and no code of ours runs. It has no permission for your browsing history
            or for other sites.
          </p>
        </Section>

        <Section title="What it does not do">
          <p>
            No analytics, no telemetry, no advertising, no tracking pixels, and no third-party
            scripts. Nothing is loaded from a CDN at runtime; every file the extension executes
            ships inside the package and is reviewable in the source. No data is sold, rented,
            or shared with anyone, and none of it is used for creditworthiness or lending.
          </p>
        </Section>

        <Section title="Where the numbers come from">
          <p>
            The measurements the panel displays are collected on a schedule from Hyperliquid&apos;s
            public API, for a set of addresses chosen for their trading activity, not for who is
            looking at them. Asking for an address does not add it to that set. What you are
            shown was measured before you asked, and your request does not change what is
            collected.
          </p>
        </Section>

        <Section title="Permissions, and why each one exists">
          <p>
            <b className="text-gray-900 dark:text-white">activeTab</b>: so the popup can read the
            URL of the tab you clicked on, to find the address there. Chosen instead of the tabs
            permission, which would grant the same reading for every tab all the time.
          </p>
          <p>
            <b className="text-gray-900 dark:text-white">
              Host access to agents-marketplace-q3k4.onrender.com
            </b>
            : the one endpoint the panel and popup fetch measurements from.
          </p>
          <p>
            <b className="text-gray-900 dark:text-white">
              Content script on app.hyperliquid.xyz
            </b>
            : the panel is drawn on that site&apos;s address pages, which is the whole feature.
          </p>
          <p>
            There are no other permissions. The extension holds no storage, scripting, cookies,
            webRequest, or history permission.
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
            If the extension starts doing something this page does not describe, this page
            changes in the same release. The date at the top says when it was last edited.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions about this policy, or about what the extension does, go to{' '}
            <a href={`mailto:${CONTACT}`} className="text-indigo-500 hover:underline">
              {CONTACT}
            </a>
            . The extension&apos;s source is in the public repository linked in the site footer,
            so any claim here can be checked against the code rather than taken on trust.
          </p>
        </Section>
      </div>
    </div>
  );
}
