# Chrome Web Store listing: Tnega for Hyperliquid

Everything here is ready to paste. Field names match the Developer Dashboard at
chrome.google.com/webstore/devconsole. Nothing in this file is aspirational: each
claim is one the code supports, and the section at the end says which of them a
reviewer can check in a minute.

Package: extension-store/tnega-for-hyperliquid-0.1.0.zip
Icon: extension-store/icon-128.png
Screenshots: extension-store/screenshot-1-rate.png, extension-store/screenshot-2-no-rate.png
Promo tile: extension-store/promo-440x280.png
Privacy policy: https://www.tnega.app/privacy

---

## Item name

Tnega for Hyperliquid

## Summary (132 characters, taken from the manifest, shown under the name)

Shows how a Hyperliquid address behaves: its post-only rejection rate, or the reason there is no rate to show.

## Category

Tools. Second choice, Developer Tools. It is not a wallet and should not be listed
as one.

## Language

English (United States)

---

## Single purpose description

This field is read by a reviewer, not by a user. Paste it as is.

> The extension has one purpose: on an address page at app.hyperliquid.xyz, it
> displays the post-only rejection rate measured for that address, or the reason
> no rate is being shown.
>
> The address is taken from the page URL, which already contains it on the
> /explorer/address/0x... route. Page text is read for one purpose, to find
> where to insert the panel: the script looks for the element whose text is
> that same address and walks up to the container. None of what it reads that
> way is transmitted or stored. The address is sent
> to one endpoint, https://agents-marketplace-q3k4.onrender.com/api/hyperliquid/address/,
> which returns the stored measurements, and the panel renders that reply. The
> extension computes nothing, stores nothing, has no background service worker,
> and runs on no other site.
>
> The toolbar popup serves the two cases the panel cannot: looking up an address
> while not on its page, and showing whether the backend answered, so that a
> connection failure is distinguishable from an address with nothing to report.

---

## Permission justifications

The dashboard asks for one justification per permission. These are the fields
under Privacy practices.

### activeTab

> Used by the toolbar popup to read the URL of the tab the user clicked on, so it
> can take the Hyperliquid address out of that URL and look it up. Chrome grants
> activeTab only for the tab where the user invoked the extension and only for
> that invocation. The broader "tabs" permission was deliberately not requested,
> because it would grant the same reading for every tab at all times, and the
> feature does not need that.

### Host permission: https://agents-marketplace-q3k4.onrender.com/*

> The single backend the extension fetches measurements from. One GET request per
> address, returning the post-only rejection rate for that address or the reason
> it is being withheld. No other host is contacted, and no data is sent anywhere
> else.

### Content script host: https://app.hyperliquid.xyz/*

> The panel is drawn on Hyperliquid address pages, which is the entire feature.
> The content script reads the address from window.location and inserts one
> element into the page. To position that element it reads the text of elements
> on the page, looking for the one whose text is the address it already has;
> nothing it reads that way is transmitted or stored. It does not read form
> fields, balances, keys, or wallet state, and it modifies nothing that was
> already on the page.

### Remote code

> No. Every file the extension executes is contained in the package. Nothing is
> loaded from a CDN, no script is fetched at runtime, and there is no eval or new
> Function anywhere in the source. The only network call is a GET that returns
> JSON, which is rendered as text and numbers.

### Data usage certifications

All three can be certified truthfully:

- Not being sold to third parties.
- Not being used or transferred for purposes unrelated to the item's single purpose.
- Not being used or transferred to determine creditworthiness or for lending purposes.

### What to tick under "What user data do you collect?"

Tick "Web history", and nothing else.

The reasoning, in case a reviewer asks. Chrome counts transmission off the device
as collection, even when nothing is retained. The extension transmits one thing:
the address in the URL of the page being viewed, which says which page that is.
That is closer to web history than to any other category on the list, and nothing
else on the list applies: no personally identifiable information, no financial or
payment information, no authentication information, no personal communications,
no location, no health data, no keystrokes or clicks, and no page content: the
script reads element text to place the panel and transmits none of it. Ticking
nothing would be the other reading, since the address is public venue data and is
retained nowhere. Undisclosed collection is one of the fastest ways to get pulled
from the store, and an over-disclosure is not, so the safer of the two readings is
the one to submit.

---

## Detailed description (the public listing text)

Paste from here to the end of this section.

> Tnega for Hyperliquid adds one panel to address pages on app.hyperliquid.xyz.
>
> The panel shows the post-only rejection rate for that address: the share of its
> post-only orders that Hyperliquid's matching engine refused instead of resting
> on the book. A refused order never reaches the book, provides no liquidity, and
> leaves no trace in fills, so an address can carry a large volume figure while
> placing orders that mostly never rest. That is the gap this fills.
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
> rather than showing a blank, a zero, or a stale figure:
>
> Not tracked. The address is not in the collector's set, so nothing has been
> measured for it.
>
> Tracked, not yet polled. It is in the set but no poll has stored anything yet.
>
> Too few observations. Not enough polls behind it to state a rate that would mean
> anything.
>
> Data is not current. The most recent order seen is more than an hour old.
> Hyperliquid's order endpoint can return a full buffer of months-old records for
> an account that is trading today, so a rate computed from it would describe the
> past and look like the present.
>
> No post-only orders. The address has been observed but posts none, so there is
> no post-only rejection rate to compute. It is trading, not quoting.
>
> Every panel also carries what the number rests on: how many polls are stored,
> how old the newest order seen is, and how many post-only orders went into the
> figure. A number you cannot audit is a number you have to take on trust, and
> this one does not ask for that.
>
> What it does not do:
>
> There is no recommendation and no prediction. It does not tell you to quote, to
> wait, to follow an address or to avoid one. It describes what was measured and
> stops there.
>
> It reads the address from the URL, which already contains it, and reads text
> on the page only to work out where the panel goes. Nothing it reads there
> leaves your browser. It does not read form fields, balances, keys, or wallet
> state.
>
> It stores nothing, on your machine or off it. No background process, no cookies,
> no analytics, no third-party scripts, and no code loaded at runtime.
>
> It runs on app.hyperliquid.xyz and no other site.
>
> The measurements come from Hyperliquid's public API, collected on a schedule for
> a set of addresses chosen by trading activity. Opening an address does not add it
> to that set.
>
> Privacy policy: https://www.tnega.app/privacy
> More, including the whole tracked set and its coverage: https://www.tnega.app/chain/hyperliquid

---

## The rest of the form

Support URL: https://www.tnega.app/chain/hyperliquid
Homepage URL: https://www.tnega.app
Privacy policy URL: https://www.tnega.app/privacy
Mature content: No
Visibility: Public
Distribution: All regions
Pricing: Free

The contact email on the account has to be verified before a submission is
accepted. That is under Account in the left sidebar, not on the item.
