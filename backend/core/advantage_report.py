"""
advantage_report.py

Chain-agnostic. Structures and validates the "Agent Advantage Report"
TermiX explicitly requires: at least 3 real tasks, each run both with
and without an agent, time/cost/quality compared, at least one task
from trading/stock/security.

This module does NOT generate fake numbers, it only validates that a
report you built from REAL runs is complete and well-formed. Filling
this with made-up numbers would defeat the entire point of the
"Proven agent advantage" judging criterion (30% of the TermiX score),
which is explicitly about measurement, not assertion.
"""

from dataclasses import dataclass, field

REQUIRED_HIGH_STAKES_CATEGORIES = {"Trading", "Stock", "Security"}
MIN_TASKS = 3


@dataclass
class TaskRun:
    time: str
    cost: str
    quality_notes: str


@dataclass
class AdvantageTask:
    task_description: str
    category: str  # e.g. "Trading", "Security", "Yield", "General"
    with_agent: TaskRun
    without_agent: TaskRun
    output_attachment_path: str | None = None  # TermiX wants "actual outputs attached"


@dataclass
class ValidationResult:
    valid: bool
    errors: list[str] = field(default_factory=list)


def validate_report(tasks: list[AdvantageTask]) -> ValidationResult:
    """Checks the report meets TermiX's stated requirements before
    it's submitted, catches an incomplete report early rather than
    losing 30% of the score to a technicality."""
    errors = []

    if len(tasks) < MIN_TASKS:
        errors.append(f"Need at least {MIN_TASKS} tasks, found {len(tasks)}.")

    has_high_stakes = any(t.category in REQUIRED_HIGH_STAKES_CATEGORIES for t in tasks)
    if not has_high_stakes:
        errors.append(
            f"At least one task must be from {REQUIRED_HIGH_STAKES_CATEGORIES}, "
            f"found categories: {[t.category for t in tasks]}"
        )

    for i, task in enumerate(tasks):
        if not task.output_attachment_path:
            errors.append(
                f"Task {i} ('{task.task_description}') has no attached output. "
                f"TermiX requires 'the actual outputs attached', not just a summary."
            )
        if not task.with_agent.quality_notes or not task.without_agent.quality_notes:
            errors.append(f"Task {i} is missing quality notes for one or both runs.")

    return ValidationResult(valid=len(errors) == 0, errors=errors)
