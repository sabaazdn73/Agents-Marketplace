# Chrome Web Store listing: Tnega 0.2.0

Replaces listing.md when 0.2.0 is packaged and submitted. Until then listing.md
is the live listing and this is the draft, for the same reason
PrivacyPage.next.jsx is a second file: a listing that describes a build nobody
has is the same defect as one that understates the build, pointed the other way.

Everything here is ready to paste. Field names match the Developer Dashboard at
chrome.google.com/webstore/devconsole. Nothing in this file is aspirational once
0.2.0 is built: each claim is one the code supports, and the section at the end
says which of them a reviewer can check in a minute. Every claim that the code
does not yet support is a specification for the build, not a promise to the
store, and this file goes nowhere near the dashboard until they agree.

Package: extension-store/tnega-0.2.0.zip
Icon: extension-store/icon-128.png
Screenshots: extension-store/screenshot-1-rate.png, extension-store/screenshot-2-no-rate.png,
plus two to be taken on an agent page before submission
Promo tile: extension-store/promo-440x280.png
Privacy policy: https://www.tnega.app/privacy

Item id is unchanged: dimmedbfoejeemojaenbknpcmjgomipk. A rename updates the
same item. Creating a second item would start from zero installs and a separate
review.

---

## Item name

Tnega

Was "Tnega for Hyperliquid". The rename is not cosmetic: the extension now
covers ERC-8004 agents as well, and a third party's trademark in the title of a
product they have not endorsed is a risk the policy on impersonation and
intellectual property names directly. Dropping it removes that risk and stops
the title from describing half the item.

## Summary (132 characters, taken from the manifest, shown under the name)

Shows what this project has measured about the agent or address on the page you are looking at, or why it cannot say.

## Category

Tools. Second choice, Developer Tools. It is not a wallet and should not be listed
as one.

## Language

English (United States)

---

## Single purpose description

This field is read by a reviewer, not by a user. Paste it as is.

Rewritten rather than extended. The old text defined the purpose by one site and
one number, so every host added to it would have read as a feature bolted on.
The purpose is the subject, which is what the policy's own first definition of
single purpose allows: "a single purpose limited to a narrow focus area or
subject matter".

> The extension has one purpose: when a page is about an on-chain address or a
> registered ERC-8004 agent, it shows what this project has already measured
> about that address or agent, or the reason it has nothing to show.
>
> It is one behaviour on every site it runs on. The identifier comes out of the
> page URL, which already contains it: an address on a block explorer address
> page, and a chain name plus an agent number on an 8004scan agent page. The
> extension looks that identifier up in a list it keeps locally, and only if it
> is in that list does it request the measurements from one server,
> https://agents-marketplace-q3k4.onrender.com, and render the reply as a panel.
> If the identifier is not in the list, nothing is requested and no panel
> appears.
>
> What is measured differs by subject because the subjects differ, not because
> the extension does several things. For an agent it is whether the service
> endpoint the agent published answers, and what on-chain jobs name it. For a
> Hyperliquid address it is the share of its post-only orders the matching
> engine refused. Both are the same sentence: here is what was measured about
> the thing on this page, with the number of observations behind it.
>
> Page text is read on one site only, app.hyperliquid.xyz, and for one purpose:
> that site renders after the script runs and gives its elements generated class
> names, so to position the panel the script looks for the element whose text is
> the address it already has, and walks up to the container. None of what it
> reads that way is transmitted or stored. On the other seven sites no page text
> is read at all, because those pages carry a stable element to insert beside.
>
> The extension stores one thing, the list described above, in
> chrome.storage.local. It has a background service worker whose only job is to
> download that list on a daily alarm, hold it, and answer membership questions
> from the content scripts. It computes nothing else: no rate, no score and no
> ranking is calculated in the extension, all of them are measured on the server
> and rendered as sent.
>
> The toolbar popup serves the two cases the panel cannot: looking up an
> address while not on its page, and showing whether the server answered, so
> that a connection failure is distinguishable from a subject with nothing to
> report. It calls the same endpoint the panels call and returns both readings
> for whatever address it is given, each with its own stated reason where there
> is nothing behind it. An address typed into the popup is sent without the
> local list being consulted first, because asking about an address is a
> different act from viewing a page that mentions one; this is stated in the
> privacy policy.

---

## Permission justifications

The dashboard asks for one justification per permission. These are the fields
under Privacy practices.

### activeTab

> Used by the toolbar popup to read the URL of the tab the user clicked on, so it
> can take the address out of that URL and look it up, and so the popup can say
> which kind of page the user is on. Chrome
> grants activeTab only for the tab where the user invoked the extension and only
> for that invocation. The broader "tabs" permission was deliberately not
> requested, because it would grant the same reading for every tab at all times,
> and the feature does not need that.

### storage

> Holds one thing: a list of the addresses and agents this project has measured,
> downloaded from our own server, about 1 MB, stored as text. The extension
> checks a page against this local list before it asks our server anything, so
> that pages about addresses we have not measured are never reported to us. Also
> stored: the date the list was built, so the extension knows when to refresh it,
> and a record of any panel the user dismissed, so it stays dismissed. No
> browsing history, no visited addresses, and no page content are stored.

### alarms

> Schedules the daily check on that list. A Manifest V3 service worker is shut
> down when idle, so a timer inside it does not survive; chrome.alarms is the
> mechanism Chrome provides for this. It is used for exactly one alarm. The
> alarm fires a few-hundred-byte request for a version string, and the list
> itself is downloaded only when that version has changed.

### Host permission: https://agents-marketplace-q3k4.onrender.com/*

> The single server the extension contacts. Three requests are made to it. A
> daily GET for a version string, a few hundred bytes, carrying no address. A GET
> for the membership list described under "storage" when that version differs
> from the one already held, which carries no address and is the same file for
> every user. And a GET for one identifier when the local list says that
> identifier has been measured, which returns what was measured or the reason
> nothing can be stated. No other host is contacted and no data is sent anywhere
> else.

### Content script hosts

One justification covering all eight. Each is an exact hostname; no wildcard
subdomain patterns are requested. That is deliberate: testnet siblings of
several of these sites exist, such as sepolia.etherscan.io and
testnet.monadscan.com, and a wildcard would match them and show mainnet
measurements on a testnet page.

> https://app.hyperliquid.xyz/*
> https://etherscan.io/*
> https://bscscan.com/*
> https://basescan.org/*
> https://arbiscan.io/*
> https://monadscan.com/*
> https://hyperevmscan.io/*
> https://8004scan.io/*
>
> These are the pages where an on-chain address or a registered ERC-8004 agent is
> the subject of the page, which is the only place the panel has anything to say.
> On each one the content script reads the identifier from window.location and
> inserts one element into the page. It does not read form fields, balances,
> keys, or wallet state, and it modifies nothing that was already on the page.
>
> On seven of the eight it reads no page text at all: the identifier is in the
> URL and there is a stable element to insert beside. On app.hyperliquid.xyz it
> does read element text, for one purpose, to find where the panel goes: that
> site renders its content after the script runs and its class names are
> generated per build, so the script looks for the element whose text is the
> address it already has and walks up to the container. Nothing read that way is
> transmitted or stored.
>
> The extension is loaded on no other site. It does not request access to all
> URLs and holds no wildcard host pattern for any site it displays on.

### Remote code

> No. Every file the extension executes is contained in the package. Nothing is
> loaded from a CDN, no script is fetched at runtime, and there is no eval or new
> Function anywhere in the source. The extension does download one data file, the
> membership list, which is a binary set of hashes rendered as text. It is never
> executed, never parsed as code, never inserted as markup, and the code that
> reads it is a fixed membership test shipped in the package.

### Data usage certifications

All three can be certified truthfully:

- Not being sold to third parties.
- Not being used or transferred for purposes unrelated to the item's single purpose.
- Not being used or transferred to determine creditworthiness or for lending purposes.

### What to tick under "What user data do you collect?"

Tick "Web history", and nothing else. The reasoning is stronger than it was for
0.1.0, not weaker, and it has two parts now rather than one.

Chrome counts transmission off the device as collection, even when nothing is
retained. The extension transmits two things. The first is an identifier for a
page being viewed: an address, or a chain name and agent number, sent only when
the local list already contains it. That says which page is being looked at and
is closer to web history than to anything else on the list. The second is the
daily request for the list itself, which carries no identifier at all but does
reach our server from the user's IP on a schedule. That is not web history and
it is not any other category on Chrome's list either, but it is disclosed in the
privacy policy in plain words rather than left to be inferred from this form.

Nothing else on the list applies: no personally identifiable information, no
financial or payment information, no authentication information, no personal
communications, no location, no health data, no keystrokes or clicks, and no
page content. Element text is read on one site, to position the panel, and is
transmitted nowhere.

Undisclosed collection is one of the fastest ways to get pulled from the store,
and an over-disclosure is not, so the safer of the two readings is the one to
submit.

---

## Detailed description (the public listing text)

Paste from here to the end of this section.

Deliberately does not name the eight sites one by one. The spam policy asks a
description not to list more than five brands and suggests a link instead, and
naming six explorers plus 8004scan plus Hyperliquid would be eight. The list is
in the privacy policy, which is linked, and in the permissions Chrome shows at
install.

> Tnega adds one panel to a page you are already looking at, when that page is
> about something this project has measured.
>
> On a block explorer, or on 8004scan, that is a registered ERC-8004 agent.
> Anyone can register an agent on chain. Registering is a transaction: it costs a
> few cents and proves nothing about whether the agent answers, delivers, or has
> ever been paid by anyone. The panel shows what was checked instead. Whether the
> service endpoint the agent published actually answers, and when that was last
> checked. What on-chain jobs name it, and how many reached delivery. Where
> something has not been checked, it says so rather than showing a zero.
>
> On app.hyperliquid.xyz, that is post-only order behaviour. The panel shows the
> share of an address's post-only orders that Hyperliquid's matching engine
> refused instead of resting on the book. A refused order never reaches the book,
> provides no liquidity, and leaves no trace in fills, so an address can carry a
> large volume figure while placing orders that mostly never rest. That is the
> gap this fills.
>
> Three bands, and what each one says:
>
> Quoting. Almost every post-only order rests on the book. This is what market
> making looks like.
>
> Mixed. A meaningful share of its post-only orders are refused before resting.
>
> Spraying. Most of its post-only orders never rest.
>
> When there is no number worth showing, the panel says which reason applies
> rather than showing a blank, a zero, or a stale figure. Not tracked. Tracked
> but not yet polled. Too few observations to state a rate that would mean
> anything. Data not current, because the most recent order seen is more than an
> hour old. No post-only orders, so there is no rate to compute. For agents: not
> yet health checked, or no on-chain jobs indexed for that address.
>
> Every panel also carries what the number rests on: how many observations are
> stored, how old the newest one is, and when the check was made. A number you
> cannot audit is a number you have to take on trust, and this one does not ask
> for that.
>
> What it does not do:
>
> There is no recommendation and no prediction. It does not tell you to quote, to
> wait, to buy, to hire, to follow an address or to avoid one. It describes what
> was measured and stops there.
>
> It reads the identifier from the page URL, which already contains it. On one
> site, app.hyperliquid.xyz, it also reads element text to work out where the
> panel goes, because that page has nothing stable to anchor to; nothing it reads
> there leaves your browser. On every other site it reads no page text. Nowhere
> does it read form fields, balances, keys, or wallet state.
>
> It keeps one thing on your machine: a list of the addresses and agents this
> project has measured, about 1 MB, checked daily and re-downloaded only when it
> has changed. That list is why the
> extension can put a panel on the right page without reporting every address you
> look at to us. When a page is not about something in that list, nothing is sent
> and no panel appears.
>
> That daily check does reach our server from your IP address on a schedule,
> whether or not you visited any of the sites it covers. That is
> telemetry, it is named as telemetry in the privacy policy, and the policy says
> exactly what it does and does not carry. There is no advertising, no tracking
> pixel, no third-party script, and no code loaded at runtime.
>
> It runs on eight sites and no others, listed in the privacy policy and shown by
> Chrome when you install it.
>
> It reads. It cannot spend anything, sign anything, or hire anyone.
>
> The agent measurements come from reading the ERC-8004 registries on chain,
> every agent rather than a sample, and from calling the endpoints those agents
> published. The Hyperliquid measurements come from Hyperliquid's public API,
> collected on a schedule for a set of addresses chosen by trading activity.
> Opening an address does not add it to anything.
>
> Privacy policy: https://www.tnega.app/privacy
> More, including everything measured and the coverage behind it: https://www.tnega.app/how-it-works

---

## The rest of the form

Support URL: https://www.tnega.app/how-it-works
Homepage URL: https://www.tnega.app
Privacy policy URL: https://www.tnega.app/privacy
Mature content: No
Visibility: Public
Distribution: All regions
Pricing: Free

Support URL changed from /chain/hyperliquid, which was a Hyperliquid-only page
for what is no longer a Hyperliquid-only extension. /how-it-works carries both
subjects and the install link.

The contact email on the account has to be verified before a submission is
accepted. That is under Account in the left sidebar, not on the item.

---

## What a reviewer can check in a minute

- The manifest has no wildcard host pattern, and `<all_urls>` appears nowhere.
- There is no eval, no new Function, and no script tag with a remote src.
- The only fetch calls are in one file and go to one origin.
- Element text is read in exactly one file, the Hyperliquid panel, and the
  variable it produces is used only to compute an insertion point.
- The membership list is read by a function that returns a boolean and nothing
  else.

## What changed from 0.1.0, for the reviewer who has seen both

The name, the subject count, seven content script hosts, the storage and alarms
permissions, and a background service worker. The single purpose description was
rewritten rather than amended, because the previous one defined the purpose by a
single site. Removed: the third-party trademark in the item name.
