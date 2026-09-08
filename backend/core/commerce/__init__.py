# commerce/ -- multi-agent commerce pipeline.
#
# Six agents behind one orchestrator, coordinating through a shared TaskState
# with per-stage provenance, so a wrong result names the stage that produced
# it rather than arriving as one anonymous blob.
#
# What is in this pass, stated plainly so nothing here reads as more
# finished than it is:
# Profile REAL (model-backed)
#   Context  stub -- returns not_implemented, never invented output
#   Search   stub -- ditto; inventing a catalogue would be the worst
#            possible failure here, since downstream stages would price and
#            buy against it
#   Styling  stub
# QA REAL (deterministic; needs no model, so it works with no key)
# Payment REAL, over a pluggable rail interface
#
# Deliberately NOT built against MoonPay or PayBox: partner onboarding was
# rejected on country/industry grounds and nothing in this repo evidences
# that changing. See docs/future-tnega-paybox.md.
