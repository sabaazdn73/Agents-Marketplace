# GitHub activity as a trust signal — investigated, not built (2026-08-29)

## The real ask

Build an additional ranking/trust signal based on an agent developer's real GitHub activity (last commit date, stars, issue responsiveness), for agents with a real, verifiable GitHub repository link in their registered metadata — conditional on real prevalence actually justifying the UI space, per the task's own explicit requirement.

## Real prevalence, checked three independent ways before building anything

1. **Description text scan, curated marketplace** (`known_agents`, 16,079 real agents): **1** contains a `github.com` link.
2. **Description text scan, full BSC registry** (`full_agent_registry`, 64,821 real agents — a 4× larger, independent sample): the **same single agent**, no others.
3. **Live, rich 8004scan detail endpoint** (`fetch_agent_detail`, 20 random, diverse real agents — checked their entire JSON record, not just `description`: `services[]`, `raw_metadata`, everything): **zero** GitHub links found anywhere.

The one match isn't even a legitimate per-agent case: it links to `bnb-chain/bnbagent-studio`, the generic framework used to *build* agents on this platform, not that specific agent's own source repository.

## Real, honest conclusion

Effectively 0% of agents in this registry have a verifiable GitHub repository link in their registered metadata — not a small-but-real minority, close to genuinely none. Building the detection/GitHub-API/caching pipeline, the detail-page signal, or a sort-order factor would all be real, working code that essentially never triggers for any real agent today.

## Decision

Confirmed with the user directly rather than assumed: **skip this entirely**, not even the backend-only pipeline. Nothing was built. If registration patterns change in the future (agents start including real, per-agent repository links in their own metadata), this is worth re-checking — the same three-pronged check above (description scan on both collections, plus a live detail-endpoint sample) is cheap to re-run and would give an honest, current answer rather than relying on this snapshot.
