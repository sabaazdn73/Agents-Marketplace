"""What the model is told, and the checks that do not depend on it obeying.

THE PROBLEM THIS FILE EXISTS FOR
A model asked about a marketplace will answer about a marketplace whether or
not it read anything. It knows what an ERC-8004 agent is, it knows what people
usually mean by "verified", and both of those are exactly the kind of knowledge
that produces a fluent answer this project cannot stand behind. So the prompt
says, in the first rule, that a sentence has to trace to a tool result in this
turn, and the loop carries the tool results and their arguments back to the
caller so that a claim can be checked instead of trusted.

Instructions are necessary and not sufficient. Two things here are enforced in
code after the model has written its answer:

  the evidence floor   an answer that rests on no tool result at all is
                       replaced with a refusal, whatever it said.

  the ranking guard    a question shaped like "which one should I hire" gets
                       the measured limits of the verified tier appended if the
                       answer left them out. The numbers are in
                       docs/what-verified-can-mean.md and are not reachable
                       through the six tools, which is why they are stated here
                       rather than fetched.

The register is enforced the same way: em dashes and asterisk emphasis are
removed from the answer rather than merely discouraged in the prompt.
"""

from __future__ import annotations

import json
import re

# ── the measured record ──────────────────────────────────────────────────────
#
# Quoted from docs/what-verified-can-mean.md, measured 2026-09-16, against the
# complete ERC-8183 job index rather than a sample. The store wide figures were
# re-checked live on 2026-09-17: providers_with_external_delivery 61,
# providers_self_funded_only 13, jobs indexed 56,789.
#
# These sit in the prompt on every question, not only on the ones that ask
# about ranking, because the failure they prevent is a model treating a badge
# as a quality score in passing while answering something else.
RECORD_SOURCE = "docs/what-verified-can-mean.md"
RECORD_MEASURED_ON = "2026-09-16"

STANDING_CORRECTIONS = """\
Verified means at least one on-chain job from a buyer other than the agent's
own owner reached SUBMITTED or COMPLETED. It records that delivery happened at
least once. It is not a quality ranking and must never be presented as one.
Measured against the complete job index on 2026-09-16: 27 verified agents on
BNB Chain, held by 24 owner addresses, with 17 distinct client wallets funding
every delivery behind the entire set and about 8 units of value ever paid to
it. 14 of the 27 have a largest external payment of 0.0001 or less. One wallet
confers the tier on six identically named agents held by six different owners,
one job each, and another is a test hire bot that verifies four.
That count describes the served slice, which is roughly 15,000 agents, not the
whole store. Store wide, 61 owner addresses have delivered to somebody other
than themselves and 13 have delivered only to themselves.
score is 8004scan's total_score carried through unchanged. The whole verified
set sits between 12.02 and 12.10, so it does not discriminate between agents
and is not a ranking of quality."""

# The paragraph the ranking guard appends when the answer left the limits out.
# It is the same record, written as one block a reader can act on.
RANKING_CORRECTION = (
    "On picking one: nothing measured here supports a best agent. The verified "
    "tier records that one job from a buyer other than the agent's own owner "
    "reached SUBMITTED or COMPLETED. Measured on 2026-09-16, 17 distinct client "
    "wallets funded every delivery behind the whole verified set and about 8 "
    "units of value have ever been paid to it, and 14 of the 27 agents verified "
    "that day had a largest external payment of 0.0001 or less. The count moves "
    "as the served slice moves, and it covers a "
    "served slice of roughly 15,000 agents, while 61 owner addresses store wide "
    "have delivered to somebody other than themselves. "
    "docs/what-verified-can-mean.md is the record."
)

REFUSAL_NO_EVIDENCE = (
    "Nothing was read for this question, so there is nothing to answer it with. "
    "No tool result was gathered in this turn, which is a fact about this call "
    "rather than about the data. Try again in a moment."
)

_RANKING_QUESTION = re.compile(
    r"\b(best|top|which agents?|which one|which .{0,24}agents?|"
    r"should i (hire|use|pick|choose|trust)|recommend|recommendation|"
    r"most (reliable|trustworthy|profitable|successful|hired|active)|"
    r"safest|worth hiring|good agent)\b", re.I)

# Markers that show the answer already declined to rank, or already carried the
# limits. Deliberately generous: the guard is here to catch an answer that
# recommended somebody on evidence that will not carry it, not to grade wording.
#
# It was narrower and produced a false positive worth keeping as the reason it
# is not: asked whether Solana revenue was tracked and who the top earner was,
# the answer correctly said neither is held anywhere in the surface, and the
# word "top" in the question pulled a paragraph about the verified tier onto
# the end of a refusal that had nothing to do with it.
_LIMITS_PRESENT = re.compile(
    r"\b(17|seventeen|not a (quality )?ranking|"
    r"(do|does|can)(es)? not (rank|mean|track|hold|carry|measure|tell)|"
    r"cannot (tell|rank|say which)|no (ranking|best agent)|"
    r"nothing[^.]{0,40}(supports|ranks)|"
    r"what-verified-can-mean|0\.0001|served slice|61)\b", re.I)


def is_ranking_question(question: str) -> bool:
    return bool(_RANKING_QUESTION.search(question or ""))


SCHEMA_HINT = json.dumps({
    "thought": "one short sentence on what you still need, or why you can answer",
    "tool": "one of the six tool names, or null when you are answering",
    "arguments": {"": "the arguments for that tool, or null when you are answering"},
    "answer": "the answer for the visitor, or null when you are calling a tool",
    "answered": "true when the tools carried the answer, false when they did not",
}, indent=2)


def system_rules() -> str:
    return f"""\
You are the assistant on Tnega, a site that measures ERC-8004 agents on several
chains, ERC-8183 on-chain jobs, Hyperliquid post-only rejection, and budget
escrow. How many chains, and how many of anything else, is a question for the
tools rather than for this sentence: tnega_catalogue carries the current
coverage of every dataset and these rules carry no counts on purpose.
Somebody has typed a question into the box on the front page.
You answer it from the measurements this site holds, using the tools below, and
from nothing else.

You work one step at a time. Each step you return one JSON object: either a
tool call, or the final answer. Tool results from earlier steps of this same
turn are shown to you below.

THE RULES, IN ORDER OF PRECEDENCE

1. Every sentence you write has to be supported by a tool result already in
   this turn, or by the measured record quoted at the end of these rules. If
   the tools do not carry the answer, then saying so is the answer. Name the
   tool you tried and what it returned, set answered to false, and stop. Do not
   fill the gap from what you know about crypto, agents, ERC standards, or this
   project. An answer that sounds right and was not read here is the one
   failure this endpoint exists to prevent.

2. A withheld_reason is an answer, not a failure. Report it in the words the
   response uses: not_tracked, too_few_polls, stale_data, no_post_only_orders,
   no_jobs_indexed, no_matches, not_found, unrecognised_identifier. Never turn
   an absence into a zero, and never turn a zero into an absence. "No rate is
   published for that address because only two polls have been recorded, and
   five are needed" is a good answer. "0%" for the same address is a wrong one.
   Set answered to false whenever what you write is an absence or a withheld
   reason rather than the figure the question asked for.

3. coverage says what a number was computed over. A rate does not travel
   without its denominator and its window. If coverage.partial is true, say so
   in the same breath as the number and say what was unreadable.

4. A caveat belongs beside the number it qualifies, in the same sentence, not
   at the end of the answer. A caveat two lines away from a figure does not
   undo how the figure reads.

5. Where the data leaves a question open, say that it is open. Do not resolve
   it with a guess, and do not present a partial view as a complete one.

6. Never tell somebody which agent to hire as though the measurements ranked
   agents. They do not. If you are asked which agent is best, answer with what
   the evidence supports and what it does not, using the measured record below.

7. The measured record below is dated. Its counts were true on the day they
   were measured and the served slice moves: the verified count read 27 on
   2026-09-16 and tnega_summary read 21 on 2026-09-17. When a tool gives you a
   current count, that is the number to state, and the record is what you cite
   for what the tier can and cannot mean. Never put the two counts side by side
   as though they disagreed.

REGISTER
The answer is prose for a person who is reading the site, so it is sentences
and never a bare field name, code or token. A withheld_reason goes inside a
sentence that says what it means for their question: "that address is not one
of the 66 being polled, so no rate exists for it" rather than "not_tracked".
Plain sentences. No em dashes, no asterisk emphasis, no bullet lists unless the
answer is genuinely a list. Do not use the words "real" or "honest" as
intensifiers. Under 150 words unless the question needs more. Write for
somebody who arrived on the site a minute ago and has not read anything.

THE MEASURED RECORD, from {RECORD_SOURCE}, which you may cite by name

{STANDING_CORRECTIONS}
"""


def build_prompt(question: str, steps: list[dict], *, calls_left: int) -> str:
    """The rules, the tools, the question, and everything read so far."""
    from mcp_server import tools as mcp_tools

    manifest = json.dumps(
        [{"name": t["name"], "description": t["description"],
          "inputSchema": t["inputSchema"]} for t in mcp_tools.manifest()],
        indent=1)

    parts = [system_rules(), "\nTHE TOOLS\n", manifest, "\n"]

    if steps:
        parts.append("\nWHAT HAS BEEN READ IN THIS TURN\n")
        for s in steps:
            parts.append(
                f"\nstep {s['step']}: {s['tool']} "
                f"{json.dumps(s['arguments'], separators=(',', ':'))}\n"
                f"{s['body']}\n")
    else:
        parts.append("\nNothing has been read yet in this turn.\n")

    if calls_left <= 0:
        parts.append(
            "\nNO TOOL CALLS ARE LEFT. Answer from what is above, or say that "
            "what was read does not carry the answer and set answered to false. "
            "Return answer, not tool.\n")
    else:
        parts.append(f"\nYou may make {calls_left} more tool call(s) this turn.\n")

    parts.append(f"\nTHE QUESTION\n{question}\n")
    return "".join(parts)


# ── the checks that run after the model has written ──────────────────────────

_EM_DASH = re.compile(r"\s*[—–]\s*")
_EMPHASIS = re.compile(r"\*{1,3}(?=\S)|(?<=\S)\*{1,3}")


def apply_register(text: str) -> tuple[str, bool]:
    """Remove em dashes and asterisk emphasis from anything a visitor reads.

    The prompt asks for this and models produce them anyway. A house rule that
    is only in a prompt is a house rule that holds most of the time.
    """
    out = _EM_DASH.sub(", ", text or "")
    out = _EMPHASIS.sub("", out)
    return out, out != (text or "")


_BARE = re.compile(r"^[a-z0-9_.]+$")


def _bare_answer(answer: str, evidence: list[dict]) -> str | None:
    """A field value handed back where a sentence was asked for.

    Measured: asked whether an untracked Hyperliquid address was a good market
    maker, a Flash model called tnega_get, read withheld_reason not_tracked,
    and answered with the two words "not_tracked". The tool call was right and
    the answer was unreadable. Rather than write a second copy of what each
    reason means, this says where the reason came from and leaves the reason in
    the words the surface uses.
    """
    text = (answer or "").strip()
    if len(text) >= 25 and not _BARE.match(text):
        return None
    reasons = [(e.get("withheld_reason"), e.get("tool"), e.get("measured"))
               for e in evidence if e.get("withheld_reason")]
    if reasons and (_BARE.match(text) or not text):
        reason, tool, measured = reasons[-1]
        return (f"The tools answered with a reason rather than a number here: "
                f"{reason}, from {tool} on {measured or 'this question'}. The "
                f"evidence below carries the response that reason came from.")
    return (f"No usable answer was written for this question, though "
            f"{len(evidence)} tool result(s) were read. The evidence below is "
            f"what they said.")


def guard(question: str, answer: str, *, evidence: list[dict]) -> tuple[str, list[str]]:
    """The checks that do not depend on the model having obeyed."""
    fired: list[str] = []
    usable = [e for e in evidence if "failed" not in e]

    if not usable:
        return REFUSAL_NO_EVIDENCE, ["no_evidence"]

    replaced = _bare_answer(answer, usable)
    if replaced is not None:
        answer = replaced
        fired.append("bare_answer")

    if is_ranking_question(question) and not _LIMITS_PRESENT.search(answer or ""):
        answer = f"{(answer or '').rstrip()}\n\n{RANKING_CORRECTION}"
        fired.append("ranking_without_limits")

    answer, changed = apply_register(answer)
    if changed:
        fired.append("register")
    return answer, fired
