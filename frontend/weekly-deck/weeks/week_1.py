"""Week 1 of the Colosseum progress updates.

Every figure was read from the live store on 20 September 2026 and is written
here rather than fetched, so the deck says the same thing with the API down.
When a figure is refreshed, refresh the date at the top with it: these move,
and the pooled rate and the overlap share both changed between this deck's
first draft and its publication.

Sources, so the next person can re-read them rather than trust this file:
  0.17% / 12.5% / 40 markets      service.maker_markets()
  100% of 252,994, xyz:SP500      service.maker_markets(), worst single pair
  88x, BTC 58.4% vs 0.66%         same, 2 of 23 makers place most of the orders
  31,550,761 / 7,888,530 / 25.0%  service overlap accounting
  32 addresses / 16,244 polls     the collector's tracked set and poll store
  51.3% / 87.9%                   docs/hyperliquid-provenance.md
  nine sites                      extension/manifest.json content_scripts
"""

TITLE = 'Tnega weekly, week 1: what the order book does not show you'
DESCRIPTION = (
    'Week 1 of the Tnega progress updates. Post-only rejection on Hyperliquid, '
    'measured: what it is, who it affects, and what the measurements say.'
)

from deckassets import RATE_B64  # noqa: F401  (used in the slide below)

SLIDES = []


def S(kind, body):
    SLIDES.append((kind, body))


S("title", '''
  <p class="kicker">Tnega &middot; Hyperliquid</p>
  <h1 class="hand">What the order book<br>does not show you</h1>
  <p class="sub">Week 1. Post-only rejection, measured on 32 addresses over 16,244 polls.</p>
  <p class="foot">Every figure here was measured on 20 September 2026. Where a number is
  not measured, it is not shown.</p>
''')

S("plain", '''
  <p class="kicker">The problem</p>
  <h2 class="hand">A refused order leaves no trace</h2>
  <div class="cols">
    <div>
      <p>A maker sends a post-only order. It is meant to rest on the book and wait.
      If it would cross the spread, the matching engine refuses it instead.</p>
      <p>That refusal is invisible. No fill. No volume. No depth. The order never
      existed anywhere a person looks, and the book it was meant to join is
      thinner than the screen says.</p>
    </div>
    <div class="note-card">
      <p class="note-h">What is visible</p>
      <p>Fills. Volume. Depth.</p>
      <p class="note-h">What is not</p>
      <p>Every order the engine turned away before it rested.</p>
    </div>
  </div>
''')

S("plain", '''
  <p class="kicker">Who has this problem</p>
  <h2 class="hand">The same number, two opposite meanings</h2>
  <div class="cols">
    <div class="who">
      <p class="who-h">A trader reading the book</p>
      <p>The depth shown is not the depth available. Orders that were refused
      never arrived, so the quote is built on liquidity that was turned away.</p>
      <p class="who-t">A high rate means the book is thinner than it appears.</p>
    </div>
    <div class="who">
      <p class="who-h">A protocol routing a user's order</p>
      <p>You send someone else's order through a builder code. A refused
      post-only did not rest and did not fill. The user got nothing.</p>
      <p class="who-t">A high rate means your users are being dropped.</p>
    </div>
  </div>
  <p class="aside">For the maker the refusal is the mechanism working, saving it a
  taker fee. For the person whose order it was, it is a failure. That distinction
  is the reading this project adds.</p>
''')

S("figures", '''
  <p class="kicker">Where it shows up</p>
  <h2 class="hand">Measured, not asserted</h2>
  <div class="figs">
    <div class="fig">
      <div class="fig-n">0.17%</div>
      <div class="fig-l">the median maker in the median market</div>
      <div class="fig-s">across 40 markets carrying 50,000 post-only orders or more</div>
    </div>
    <div class="fig">
      <div class="fig-n">100%</div>
      <div class="fig-l">one address, one market, 252,994 orders</div>
      <div class="fig-s">refused every time in xyz:SP500, while its rate across all
      markets reads 27.23%</div>
    </div>
    <div class="fig">
      <div class="fig-n">88&times;</div>
      <div class="fig-l">BTC pooled against BTC median</div>
      <div class="fig-s">58.4% pooled, 0.66% for the median maker, because 2 of 23
      makers place most of the orders</div>
    </div>
  </div>
''')

S("shot", f'''
  <p class="kicker">What it looks like in place</p>
  <h2 class="hand">On the page you were already reading</h2>
  <img class="shot-img" alt="The Tnega panel on a Hyperliquid address page, showing a
  1.4% post-only rejection rate, the last 49 hours as a line, the counts behind it,
  and the address's HyperCore positions read on chain."
  src="data:image/jpeg;base64,{RATE_B64}" />
  <p class="cap">The rate, the hours behind it, and what the address holds on
  HyperCore. Where a rate cannot be stated, the panel gives the reason instead of a
  number.</p>
''')

S("plain", '''
  <p class="kicker">What solving it changes</p>
  <h2 class="hand">Seventy times apart</h2>
  <div class="cols">
    <div>
      <p>Pooled across every order on the venue, the rejection rate is
      <b>12.5%</b>: 2,317,205 of 18,469,277 post-only orders.</p>
      <p>The median maker in the median market sees <b>0.17%</b>.</p>
      <p>Both are correct. They answer different questions. A protocol that reads
      the pooled figure and concludes its users will be refused one time in eight
      is wrong by a factor of roughly seventy, because its flow behaves like the
      median maker and not like the two addresses that dominate the pool.</p>
    </div>
    <div class="note-card">
      <p class="note-h">Pooled</p>
      <p>Every order on the book, counted together. Dominated by whoever submits
      most.</p>
      <p class="note-h">Median maker</p>
      <p>One value per address, then the middle one. What a participant like you
      actually sees.</p>
    </div>
  </div>
''')

S("stack", '''
  <p class="kicker">How it was built</p>
  <h2 class="hand">Four pieces</h2>
  <div class="stack">
    <div class="st"><p class="st-h">Collectors</p><p>A REST poller every 15 minutes
    over the tracked set, and a WebSocket worker bucketing order updates at ten
    seconds. 16,244 polls so far.</p></div>
    <div class="st"><p class="st-h">A reader contract</p><p>Deployed on HyperEVM,
    reading HyperCore through the precompiles, so positions and marks come off chain
    rather than from an API that could be wrong.</p></div>
    <div class="st"><p class="st-h">The panel</p><p>One rate, the hours behind it,
    and the counts. Where the observations are too few or the data has aged, the
    reason replaces the number.</p></div>
    <div class="st"><p class="st-h">The extension</p><p>The same reading injected on
    nine sites, so it reaches a reader on the page they were already on rather
    than requiring a visit here. Seven are block explorers; the other two are
    Hyperliquid's own app and the registry indexer.</p></div>
  </div>
''')

S("hard", '''
  <p class="kicker">What was hardest</p>
  <h2 class="hand">My own numbers were measuring<br>the wrong thing</h2>
  <div class="cols">
    <div class="who">
      <p class="who-h">A count inflated by 25%</p>
      <p>The venue returns a rolling window of recent orders and ignores the date
      range asked for. When an address is quiet, consecutive polls return the same
      records and each poll stored them again.</p>
      <p class="who-t">7,888,530 of 31,550,761 orders came from overlapping windows.
      The rates were unaffected, because numerator and denominator inflate together.
      The total was not.</p>
    </div>
    <div class="who">
      <p class="who-h">A profit finding withdrawn after publication</p>
      <p>I reported that the venue's leaderboard contradicted itself, on the grounds
      that month profit exceeded all-time profit on 51.3% of rows.</p>
      <p class="who-t">Profit is signed. An account down since it opened and up this
      month satisfies that comparison legitimately, and 87.9% of the rows I flagged
      had a negative all-time figure. The test detected a minus sign.</p>
    </div>
  </div>
  <p class="aside">Both are written up in the repository rather than quietly
  corrected, because a measurement project that hides its own corrections is
  asking for trust it has not earned.</p>
''')
