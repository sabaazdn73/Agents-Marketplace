# Submitting this to the Chrome Web Store

Written for the first submission and kept current. It says what to upload
where, what was checked before submitting rather than after, and what can be
changed later without going through review again.

The filename above is the one thing here that goes stale silently. It named the
0.1.0 package for a day after 0.2.0 was built, with both zips sitting in this
folder, and the older one is the file a reader reaches for first because it is
the one this document points at. build.py writes tnega-<version>.zip from the
manifest, so the name changes whenever the version does, and this line has to
change with it.

## What is in this folder

    tnega-0.2.0.zip                   the package to upload
    icon-128.png                      store icon, 128x128
    screenshot-1-rate.png             1280x800, the panel showing a rate
    screenshot-2-no-rate.png          1280x800, the panel on an address outside
                                        the measured set, showing the venue's
                                        own record instead
    screenshot-3-popup.png            1280x800, the toolbar popup, both subjects
    promo-440x280.png                 small promo tile
    promo-1400x560.png                marquee promo tile
    listing.md                        every text field, ready to paste
    build.py                          rebuilds and re-checks the zip
    capture.py                        re-takes the screenshots from a live page
    icons.py                          rebuilds every Tnega image from one master

Rebuild the package with `python3 extension-store/build.py`. It refuses to write
a zip if any check fails, so a passing run is the evidence, not a promise.

The mark lives in one file, extension/icons/tnega-128.png. Change it there, run
`python3 extension-store/icons.py`, then rebuild. That regenerates the three
toolbar sizes, the store icon and the promo tile together, so the icon on the
toolbar and the icon on the listing cannot come from different versions of the
logo.

## Before you start

The one-time 5 dollar registration fee has to be paid and the account's contact
email verified, or the Submit button is not available. Both are under Account in
the dashboard sidebar, not on the item.

## Filling the form

1. Dashboard, Items, Add new item. Upload the zip. Name, version and the short
   summary come from the manifest, so those three fields fill themselves.

2. Store listing tab.
   - Detailed description: the block under "Detailed description" in listing.md.
   - Category: Tools.
   - Language: English (United States).
   - Store icon: icon-128.png.
   - Screenshots: both PNGs. Put screenshot-1-rate.png first, since it is the
     one that shows the product doing its job. At least one is required and five
     are allowed.
   - Small promo tile: promo-440x280.png.
   - Marquee tile, 1400x560: optional, and only used if the item is ever
     featured. Skip it.
   - Support URL: https://www.tnega.app/chain/hyperliquid

3. Privacy tab. This is the tab that decides how long the review takes.
   - Single purpose: the block in listing.md.
   - Permission justification: one field per permission. All three are in
     listing.md, and each one has to name a feature a reviewer can see, not a
     principle.
   - Remote code: No.
   - Data usage: tick Web history, then the three certifications. The reasoning
     for that answer is in listing.md, in case it is queried.
   - Privacy policy URL: https://www.tnega.app/privacy

4. Distribution tab. Public, all regions, free.

5. Submit for review. Expect a day or two. A first submission from a new
   developer account can take longer, and there is nothing to do in the meantime
   but wait; resubmitting does not speed it up and resets the queue position.

## The four common rejection causes, and where this stands

Permissions without a demonstrable active use.
  The package requests activeTab and one host permission. Both are used on the
  first run: activeTab by popup.js to read the current tab's URL, the host
  permission by the one fetch in shared.js. There is no storage, scripting,
  tabs, cookies, webRequest or history permission to justify, because none is
  requested. `build.py` prints the full permission set on every build, so the
  list in the listing cannot drift from the list in the manifest.

Missing or incomplete privacy disclosure.
  The policy is at https://www.tnega.app/privacy and is written from the source,
  not from a template. It names the endpoint, says cookies are omitted, says
  nothing is stored, says there is no background worker, and says the extension
  touches no other site. Each of those maps to a line of code, listed in the
  header comment of frontend/src/PrivacyPage.jsx. The disclosure on the Privacy
  tab has to agree with that page, which is the pair reviewers actually check.

Secrets in the bundle.
  There are none. The only credential-shaped thing an extension like this could
  carry is an API key, and the backend endpoint is unauthenticated, so there was
  never one to include. `build.py` greps the shipped files for key-shaped
  strings and assigned credentials on every build and refuses to package if it
  finds any.

Dependencies loaded from a CDN at runtime.
  There are none. The extension has no dependencies at all. The package is
  twelve files: a manifest, three JavaScript files, two stylesheets, one HTML
  popup and five icons, all of them written or generated here. No framework,
  no bundler, no fonts or scripts from a third party. `build.py` fails the
  build on a remote script tag, a remote CSS import, importScripts, eval or
  new Function, and on any host in the source outside the three the extension
  is supposed to name.

One more worth knowing about, since it is not on your list. The name contains
"Hyperliquid". Descriptive use of another product's name is allowed, and "Tnega
for Hyperliquid" is the form that reads as description rather than as
affiliation. What would not survive is their mascot as the item's identity,
which is why Hypurr appears only inside the panel, on their own site, describing
their own data, and every surface that identifies the software is Tnega's mark:
the toolbar icon, the popup header, the store icon, the promo tile.

## What you can change later without a new review

The privacy policy page itself. It is on tnega.app, so editing it is a deploy,
not a store submission. The URL has to keep resolving and keep describing this
extension truthfully.

What the panel says about any given address. The measurements come from the
backend, so a number changing, a band changing, or a new address entering the
tracked set involves no store action at all. This is the reason the extension
renders the backend's answer instead of computing anything: the part that
changes often lives where changing it is free.

## What triggers a review

Any change inside the zip. All of it: JavaScript, CSS, wording in the panel,
icons. Bump the version in the manifest, rebuild, upload to the same item, and
submit. Uploading a package with a version that is not higher than the published
one is rejected before review starts.

Changes to the store listing text, screenshots, tiles, category or support links.
These need no new package and no version bump, but publishing them is still a
submission and goes through review. It is usually quick.

Changes to the Privacy tab: the single purpose, a permission justification, or
the data usage answers. Same as above, and these get read more carefully than
the listing text.

Adding a permission or a host permission. This is the expensive one. It goes
through a longer review, and for everyone who already has the extension Chrome
disables it until they accept the new permissions by hand. Removing a permission
does neither. If a future feature needs a second host, it is worth deciding
whether it belongs in this extension at all before it costs the installed base.

Two things that are not reviews but behave like one. The item ID is assigned on
the first upload and never changes, so every future update goes to this same
item; creating a second item starts from zero installs and a separate review.
And a published item can be taken down after the fact if the code and the
disclosures stop agreeing, which is the failure mode worth guarding against
long after the first review is over.
