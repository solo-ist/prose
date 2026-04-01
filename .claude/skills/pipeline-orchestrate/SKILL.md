---
name: pipeline-orchestrate
description: Merge scorer and PE signals to route PRs. Applies routing matrix (auto-fix / auto-fix-verify / hitl-light / hitl-full) based on score thresholds and risk levels.
---

# Pipeline Orchestrator

Merges scorer and PE analysis signals to determine the final routing verdict for a PR.

## Usage

```
/pipeline-orchestrate <pr-number>
```

## Routing Matrix

Source of truth: `run-orchestrator.mjs` `route()` function.

| Score (1-10) | PE Risk | Route | Action |
|--------------|---------|-------|--------|
| 1-3 | LOW | `auto-fix` | Claude Code pushes fix commit |
| 1-3 | MEDIUM+ | `hitl-light` | Post analyses, label `needs-review` |
| 4-6 | LOW | `auto-fix-verify` | Fix + request human verification |
| 4-6 | MEDIUM+ | `hitl-full` | Full analyses, assign human |
| 7+ | Any | `hitl-full` | Label `complex`, full human review |
| Any | CRITICAL | `hitl-full` | Always escalate |
| Any | privileged | `hitl-full` | Security hard gate — always escalate |

### Label Mapping

| Verdict | Labels Applied |
|---------|---------------|
| `auto-fix` | `auto-fix-queued` |
| `auto-fix-verify` | `auto-fix-queued`, `needs-review` |
| `hitl-light` | `needs-review` |
| `hitl-full` | `complex`, `needs-review` |

## Security Hard Gate

PRs touching privilege-boundary paths auto-route to `hitl-full` regardless of score:
- `src/main/**` — full system access
- `src/preload/**` — context bridge / attack surface
- `electron-builder.*`, `electron.vite.config.*` — build/packaging config

With the security-gate short-circuit (383-2), these PRs skip scorer+PE entirely — the `pipeline-triage.yml` `security-gate-check` job detects `[SECURITY GATE]` in the review and posts `hitl-full` directly.

## Workflow

1. Read scorer and PE comments from the PR
2. Parse sentinel JSON from both (`<!-- scorer-output: {...} -->` and `<!-- pe-output: {...} -->`)
3. Apply routing matrix
4. Post verdict comment with `<!-- orchestrator-verdict: auto-fix|auto-fix-verify|hitl-light|hitl-full -->`
5. Apply GitHub labels per the label mapping table
6. If verdict is `auto-fix` or `auto-fix-verify`, dispatch `pipeline-fix.yml`

## Decision Trace Example

Given a PR that touches `src/renderer/components/editor/Editor.tsx` only:
- Scorer returns: `{"score": 4, "threshold": "review"}`
- PE returns: `{"risk": "LOW", "privileged": false, "concerns": 1}`
- Path: score 4 >= 4, risk LOW → `auto-fix-verify`
- Labels: `auto-fix-queued`, `needs-review`
- Pipeline dispatches `pipeline-fix.yml`, then requests human verification

If the same PR also touched `src/main/ipc.ts`:
- PE returns: `{"risk": "MEDIUM", "privileged": true, "concerns": 2}`
- Path: privileged = true → immediate `hitl-full` (score doesn't matter)
- Labels: `complex`, `needs-review`
- No auto-fix dispatched

## Output Format

Machine-readable sentinel:
`<!-- orchestrator-verdict: auto-fix|auto-fix-verify|hitl-light|hitl-full -->`

Human-readable summary with routing rationale referencing scorer dimensions and PE risk assessment.
