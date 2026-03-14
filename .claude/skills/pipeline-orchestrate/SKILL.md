---
name: pipeline-orchestrate
description: Merge scorer and PE signals to route PRs. Applies routing matrix (auto-fix / hitl-light / hitl-full) based on score thresholds and risk levels.
---

# Pipeline Orchestrator

Merges scorer and PE analysis signals to determine the final routing verdict for a PR.

## Usage

```
/pipeline-orchestrate <pr-number>
```

## Routing Matrix

| Score (1-10) | PE Risk | Route | Action |
|--------------|---------|-------|--------|
| 1-3 | LOW | Auto-fix | Claude Code pushes fix commit |
| 1-3 | MEDIUM+ | HitL-light | Post analyses, label `needs-review` |
| 4-6 | LOW | Auto-fix (verify) | Fix + request human verification |
| 4-6 | MEDIUM+ | HitL | Full analyses, assign human |
| 7+ | Any | HitL-full | Label `complex`, full human review |
| Any | CRITICAL | HitL-full | Always escalate |

## Security Hard Gate

PRs touching privilege-boundary paths auto-route to human review regardless of score:
- `src/main/**` — full system access
- `src/preload/**` — context bridge / attack surface
- `electron-builder.*`, `electron.vite.config.*` — build/packaging config

## Workflow

1. Read scorer and PE comments from the PR
2. Parse sentinel JSON from both (`<!-- scorer-output: {...} -->` and `<!-- pe-output: {...} -->`)
3. Apply routing matrix
4. Post verdict comment with `<!-- orchestrator-verdict: auto-fix|hitl-light|hitl-full -->`
5. Apply GitHub labels: `auto-fix-queued`, `needs-review`, `complex`, `security-gate`

## Output Format

Machine-readable sentinel:
`<!-- orchestrator-verdict: auto-fix|hitl-light|hitl-full -->`

Human-readable summary with routing rationale referencing scorer dimensions and PE risk assessment.
