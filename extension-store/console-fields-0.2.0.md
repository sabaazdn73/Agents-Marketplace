# Developer Console, Privacy tab: the 0.2.0 fields

Paste-ready. Every field on that form caps at 1,000 characters and the versions
in listing.md are written for a reader rather than for a form, so they are two
to three times too long. These are the same claims inside the limit.

The count after each heading is what the form will show.

## Single purpose description

987 of 1000 characters.

```
When a page is about an on-chain address or a registered ERC-8004 agent, the extension shows what this project has already measured about it, or the reason it has nothing to show. That is one behaviour on every site it runs on.

The identifier comes from the page URL, which already contains it: an address on a block explorer address page, a chain and agent number on an 8004scan agent page. It is checked against a list held locally, and only if it is in that list does the extension request the measurements from one server, https://agents-marketplace-q3k4.onrender.com, and render the reply.

What is measured differs by subject because the subjects differ. For a Hyperliquid address it is the share of its post-only orders the matching engine refused. For an agent it is whether its published endpoint answers and what on-chain jobs name it. Both say the same thing: here is what was measured, and how much was observed.

The toolbar popup looks up an address while not on its page.
```

## activeTab justification

534 of 1000 characters.

```
Used by the toolbar popup to read the URL of the tab the user clicked on, so it can take the address out of that URL and look it up, and so the popup can say which kind of page the user is on.

Chrome grants activeTab only for the tab where the user invoked the extension, and only for that invocation. The broader "tabs" permission was deliberately not requested, because it would grant the same reading for every tab at all times and this feature does not need that.

No page content is read through activeTab. Only the URL is used.
```

## storage justification

716 of 1000 characters.

```
Holds one thing: a list of the addresses and agents this project has measured, downloaded from our own server, about 1 MB, stored as text in chrome.storage.local.

The extension checks a page against this local list before it asks our server anything, so pages about addresses we have not measured are never reported to us. This is a privacy measure, not a cache: without it every page view on a covered site would have to be sent somewhere to find out whether there was anything to say.

Also stored: the date the list was built, so the extension knows when to refresh it, and, per host, whether the user has collapsed the panel there, so it stays collapsed on that site and nowhere else.

No browsing history, no visited addresses and no page content are stored.
```

## alarms justification

521 of 1000 characters.

```
Schedules the daily check on the membership list described under storage.

A Manifest V3 service worker is shut down when idle, so a timer started inside it does not survive. chrome.alarms is the mechanism Chrome provides for work that has to happen on a schedule across those shutdowns. It is used for exactly one alarm, at a 24 hour period.

The alarm fires a request for a version string, a few hundred bytes, carrying no address. The list itself is downloaded only when that version differs from the one already held.
```

## Host permission justification

999 of 1000 characters.

```
https://agents-marketplace-q3k4.onrender.com is the single server the extension contacts. Three requests go to it: a daily GET for a version string carrying no address; a GET for the membership list when that version differs from the one held, which carries no address and is the same file for every user; and a GET for one identifier, sent only when the local list says it has been measured.

No other host is contacted and no data is sent anywhere else.

The nine content script hosts are exact hostnames with no wildcard subdomains. Testnet siblings such as sepolia.etherscan.io exist, and a wildcard would show mainnet measurements on a testnet page.

On eight of them no page text is read: the identifier is in the URL and there is a stable element to insert beside. On app.hyperliquid.xyz only, the script reads element text to find where the panel goes, since that site renders after the script runs and its class names are generated per build. Nothing read that way is transmitted or stored.
```

## Remote code

No, I am not using Remote code. The justification box stays empty; it is only
required for Yes.

## What user data do you collect

Web history, and nothing else.

Chrome counts transmission off the device as collection even when nothing is
retained. Two things are transmitted. An identifier for a page being viewed,
sent only when the local list already contains it, which says which page is
being looked at and is closer to web history than to anything else on the
list. And the daily request for the list, which carries no identifier but
reaches our server from the user's IP on a schedule; that is not web history
and is not any other category on the form either, so it is disclosed in the
privacy policy in words instead.

Nothing else applies: no personally identifiable information, no health data,
no financial or payment information, no authentication information, no
personal communications, no location, no user activity, and no website
content. Element text is read on one site, for placement, and is transmitted
nowhere.

Undisclosed collection is one of the fastest ways to be pulled from the store
and an over-disclosure is not, so the safer reading is the one to submit.

## The three certifications

All three are true and all three can be ticked: not sold or transferred to
third parties, not used or transferred for purposes unrelated to the single
purpose, and not used to determine creditworthiness or for lending.
