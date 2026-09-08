# commerce/ -- multi-agent commerce pipeline.
#
# Six agents behind one orchestrator, coordinating through a shared TaskState
# with per-stage provenance, so a wrong result names the stage that produced
# it rather than arriving as one anonymous blob.
#
# Where each stage stands, stated plainly so nothing here reads as more
# finished than it is:
#
#   Profile  Built, model-backed. Extracts only what the request states and
#            asks for the rest. It never guesses a size or a budget.
#
#   Context  Not built. Returns not_implemented and no invented output.
#
#   Search   Built, but narrow. It resolves product URLs into priced
#            candidates by reading the merchant's own structured data. It
#            cannot search the web, and search.py records the three routes
#            to that which were measured and found closed. It never invents
#            a candidate, because Styling would price one and Payment could
#            buy it.
#
#   Styling  Built and deterministic. Picks a set inside the budget using
#            integer arithmetic only. It applies no exchange rate, so a
#            price in a currency the cart cannot compare is refused rather
#            than converted.
#
#   QA       Built and deterministic, so it works with no model key. A
#            rejection checklist, not an approval one.
#
#   Payment  Built, behind a pluggable rail interface. Handoff always works,
#            B402 settles on BSC, Crossmint is paused pending answers on
#            Agent Checkouts.
#
# Not built against MoonPay or PayBox: partner onboarding was rejected on
# country and industry grounds and nothing in this repo evidences that
# changing. See docs/future-tnega-paybox.md.
