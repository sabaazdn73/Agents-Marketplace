# ETHGlobal Online 2026 — what was built during the hackathon

**Window:** 17:00 Lisbon (16:00 UTC) on 4 September 2026, the moment ETHGlobal Online opened, to the present.

Tnega is a live, mainnet-only agent marketplace on BNB Smart Chain ([tnega.app](https://tnega.app)): it discovers ERC-8004 agents, evaluates them on independent signals, and hires them through ERC-8183 escrow. It existed before this hackathon. This page covers **only** what was committed inside the window above, so a reviewer can see exactly what the hackathon period produced rather than the project as a whole.

## The boundary, stated precisely

Commits in this repository are timestamped in Lisbon local time (`+01:00`, WEST). The cutoff falls cleanly between two commits:

| Commit | Local timestamp | |
|---|---|---|
| `755dc2e` | 2026-09-04 **16:16:31** +01:00 | 44 minutes **before** the start — not counted |
| `69b7b04` | 2026-09-04 **17:09:10** +01:00 | 9 minutes **after** the start — first hackathon commit |

**Eight commits** fall inside the window.

Work done earlier the same day is deliberately excluded, including the largest feature of the day: the Binance **B402** payments integration (x402 settled natively on BSC, `89f122a`, 13:56 local). It is genuinely good work and it is genuinely not hackathon work. Counting it here would be the easiest way to inflate this page, so it is named and left out.

## What was built

### 1. Fixed a crash that made every agent unopenable

**`7129356`** — user-facing bug, the most severe item here.

Clicking anywhere on an agent card produced a **white screen**. Only the "Hire agent" button worked. The marketplace's entire detail view (verification tier, delivery record, escrow compatibility, corroboration signals) was unreachable by the normal path.

Cause: the detail panel's render condition tested one variable while the prop passed a second one that React only updated inside a `useEffect`. Effects run *after* render, so on the first render following a click the prop was still the previous value (`null`), and the detail component crashed on it. The Hire button was unaffected because it never rendered that component.

Fixed by removing the offending indirection entirely rather than patching the timing: the condition and the prop are now the same value, so the failure is structurally impossible rather than merely unlikely.

### 2. Made browser Back behave like an application

**`7129356`** — new shared module `frontend/src/useViewHistory.js`.

Pressing Back jumped all the way out to the initial page load instead of returning one screen. Two independent causes:

- Tab changes *did* push a history entry, but the app only read the incoming route in a `useState` initialiser, which runs once, at mount. A `popstate` therefore moved the address bar while the view stayed put, and repeated Backs eventually walked off the site.
- Opening an agent pushed **no** history entry at all, so Back from a detail view skipped the list entirely.

Now each meaningful view is a real history entry. The in-app back control routes through `history.back()` so it and the browser button unwind the same entry rather than drifting apart. Implemented once and shared by both the web and mobile apps, since navigation silently diverging between them is exactly the class of bug this codebase keeps shared logic to avoid.

### 3. Cut the marketplace API's memory cost without dropping any data

**Net outcome of `7bd4c84` → `0a1b468` → `5943c80`.**

The backend was being **OOM-killed at its 512 MiB ceiling roughly every 9–11 hours**, taking the site down with it. The marketplace showed "0 Agents Listed" and "Failed to fetch" while it restarted. Confirmed from the host's own events (three `oomKilled` events) and its memory curve: ~247 MB after a restart, climbing to 466 MB, then killed.

Measured cause: `GET /api/agents` served every field of every agent (**16,162 agents × 31 fields ≈ 16.75 MB**) and FastAPI re-encoded that whole response from cached dictionaries on *every* request:

| | |
|---|---|
| Cached list of dicts, held one hour | **54.3 MB** |
| Serialized JSON body | 16.8 MB |
| Peak extra memory per concurrent request | **33.6 MB** |

Three or four concurrent calls therefore added 100–134 MB of pure transient churn on top of the resident baseline.

**An honest detour:** the first attempt (`7bd4c84`) cut the payload by trimming the response from 31 fields to 17. It shipped, and it was wrong: the retained set had been derived by grepping a single render range of a single file, which missed evaluation signals consumed by badge, warning and tier components, by derived computations, and by the mobile app's own paths. The marketplace still listed agents but had lost the data that gives the listing its point. It was reverted within 17 minutes (`0a1b468`) and the full 31 fields restored, descriptions uncapped.

A proper audit followed: every field's identifier grepped across every `.js`/`.jsx` file in both apps. `owner_address` alone is consumed in **21 files**. Of 31 fields exactly **one** (`last_seen_at`, worth 0.55 MB) has no frontend consumer, so field-trimming was simply exhausted as an approach.

The fix that survived (`5943c80`) attacks cost rather than content: the agent list is encoded **once per hourly refresh** instead of once per request, and the encoded bytes are streamed. Resident drops from 54.3 MB of dictionaries to 16.8 MB of bytes, and the 33.6 MB per-request encode disappears. **Nothing was removed**, verified byte-for-byte: the same records through FastAPI's own encoder and through the new path both produce **15,761,964 bytes**, identical.

### 4. Stopped the ingestion pipeline doing everything twice

**`69b7b04`** — infrastructure.

An audit of every automation found the scheduled workflow and the always-on background worker running the same three jobs: registry ingestion, analysis, and the escrow-compatibility audit. The workflow's two duplicated steps were removed, leaving it responsible only for the four jobs nothing else covers (job index, health check, Solana scan, and the five additional chains).

The worker is the better home for a specific reason rather than an arbitrary choice: it is a long-running loop with no HTTP timeout over it, and it has real backlog pacing the workflow path has no equivalent of. The removed ingest step had in fact been failing consistently for exactly that structural reason. Upstream deep-offset degradation sends the backend into exponential backoff that outlives the workflow's 300-second `curl` limit, while the worker meets the same slow upstream and simply keeps going.

The trade is stated plainly: this removes redundancy, and the worker is now the only driver of those three jobs.

### 5. Rebuilt the mobile navigation

**`7129356`, `419641d`.**

The bottom bar carried **eight** tabs on a phone, leaving each roughly 40 px wide under a 10 px label. It now carries **three** primary destinations (Market, Native Agents, My Agents), with the other five (Skills, Report, Learn, Build, Sell) moved into the menu sheet the header already had, as a labelled grid. Nothing became unreachable; it simply stopped competing for thumb space.

The bar was then restyled as frosted glass, and the first attempt did not render as glass at all. The cause was a layout one, not a CSS one: the blur was compiling and applying correctly, but the bar was a flex *sibling* below the scroll container, so page content was clipped at that container's edge and **nothing was ever painted behind the bar**. `backdrop-filter` samples what is genuinely behind an element; with an empty backdrop it renders as a flat translucent panel. More blur would never have fixed it. The bar now overlays the scroll area so content passes underneath, with saturation alongside the blur (blur alone reads as grey haze), and separate tint, border and highlight treatments for light and dark.

Two latent bugs surfaced while fixing it, both of which would have undermined the result anyway:

- `pb-safe` and `pt-safe` were used on the header and bottom bar but **were never defined**: no plugin, nothing in the Tailwind config, confirmed absent from the built CSS. They silently did nothing, so on a notched device the bar's bottom row could sit under the home indicator.
- The viewport meta lacked `viewport-fit=cover`, without which `env(safe-area-inset-*)` resolves to **0 on iOS**, so even a correct `pb-safe` would have added nothing.

### 6. Made the app installable

**`c9702fd`.**

There was no `manifest.json` at all, so an Android "Add to home screen" fell back to the bare icon tags: no app name, no theme colour, no standalone display, no maskable icon.

The maskable icon is a separately generated file for a real reason: Android applies its own mask (circle, squircle, teardrop, depending on launcher) and only guarantees the centre 80% survives. The existing icon is a full-bleed rounded rect, so declaring it maskable would have let the launcher crop both its corners and part of the mark. The variant keeps identical artwork inset into the safe zone with the background extended full-bleed behind it, generated from the original so the two cannot drift. Theme and background colours match the app's real default appearance rather than being chosen for looks, so the launch splash does not flash a colour the app never shows.

### 7. Removed a login that promised what a web app cannot do

**`1ad996c`** — honesty fix.

Three surfaces offered "Face ID" login (mobile wallet sheet, mobile splash, and the web wallet panel). They worked, but they advertised biometrics and actually opened a passkey/email modal. The thing that label implies, an OS-level biometric unlock of the app itself, is not something a web app can do at all, so the honest fix was to stop offering it rather than reword it into something technically accurate but still oversold.

A user-facing string that survived the buttons was also corrected: the web hire flow told users to use a control that no longer existed.

The underlying auth provider was deliberately **not** ripped out. Existing authenticated users still have their session read and can still log out; only the log-in entry points are gone. Removing the provider would strand anyone already holding an embedded wallet.

## Honest summary of the mix

Of the eight commits: **two fixed user-facing bugs** (the card-click crash, Back navigation), **two were infrastructure** (memory, pipeline deduplication), **three were mobile/PWA work** (nav restructure, glass bar, installability), and **one was a revert** of a regression introduced inside the same window.

There is no new protocol integration or new on-chain capability in this window. The B402 payments work that would qualify landed before the start and is excluded above. What this window contains is the less glamorous half of shipping something real: a crash that made the product's core view unreachable, a service that fell over twice a day, navigation that did not behave like an application, and a mobile experience that had accumulated eight tabs and three silently-dead CSS utilities.

## Commits in the window

| Commit | Local time | What it is |
|---|---|---|
| `69b7b04` | 17:09 | Infrastructure — remove duplicated pipeline steps |
| `7bd4c84` | 17:52 | *(regression — reverted below)* |
| `0a1b468` | 18:09 | Revert — restore the 31-field marketplace payload |
| `5943c80` | 19:34 | Infrastructure — encode the agent list once per refresh |
| `7129356` | 19:45 | Bug fixes — card-click crash, Back navigation; mobile nav trim |
| `c9702fd` | 20:04 | Feature — web app manifest and maskable icon |
| `1ad996c` | 20:08 | UX honesty — remove the Face ID login surfaces |
| `419641d` | 20:13 | Fix — frosted-glass bar, plus two latent CSS bugs |

## Verification notes

Everything above was measured rather than estimated: memory figures come from the host's own metrics API, payload sizes from the live response, the byte-identical check from encoding the same records through both code paths, and the field-consumer counts from grepping every source file in both apps. Where a number is cited it was observed at the time of the commit that cites it.

One limitation is worth stating: the visual results (the glass bar, the maskable icon on a home screen) are verified structurally and in the emitted CSS, not visually on a device.
