---
name: pipeline-orchestrate
description: Merge scorer and PE signals to route PRs. Applies routing matrix (hitl-light / hitl-full) based on score thresholds and risk levels.
---

# Pipeline Orchestrator

> **Auto-fix retired (#737).** The pipeline reviews and triages; code mutation goes through a human or an Oz agent as a normal PR. All verdicts are `hitl-light` or `hitl-full` — no autonomous code changes.

Merges scorer and PE analysis signals to determine the final routing verdict for a PR.

## Usage

```
/pipeline-orchestrate <pr-number>
```

## Routing Matrix

Source of truth: `run-orchestrator.mjs` `route()` function.

| Score (1-10) | PE Risk | Route | Action |
|--------------|---------|-------|--------|
| 1-3 | Any | `hitl-light` | Post analyses, label `needs-review` |
| 4-6 | LOW | `hitl-light` | Post analyses, label `needs-review` |
| 4-6 | MEDIUM+ | `hitl-full` | Full analyses, label `complex`, `needs-review` |
| 7+ | Any | `hitl-full` | Label `complex`, full human review |
| Any | CRITICAL | `hitl-full` | Always escalate |
| Any | privileged | `hitl-full` | Security hard gate — always escalate |

### Label Mapping

| Verdict | Labels Applied |
|---------|---------------|
| `hitl-light` | `needs-review` |
| `hitl-full` | `complex`, `needs-review` |

## Security Hard Gate

PRs touching privilege-boundary paths auto-route to `hitl-full` regardless of score:
- `src/main/**` — full system access
- `src/preload/**` — context bridge / attack surface
- `electron-builder.*`, `electron.vite.config.*` — build/packaging config

With the security-gate short-circuit (383-2), these PRs skip scorer+PE entirely — the `pipeline-triage.yml` `security-gate-check` job detects the `<!-- security-gate: true -->` sentinel in the review and posts `hitl-full` directly.

## Workflow

1. Read scorer and PE comments from the PR
2. Parse sentinel JSON from both (`<!-- scorer-output: {...} -->` and `<!-- pe-output: {...} -->`)
3. Apply routing matrix
4. Post verdict comment with `<!-- orchestrator-verdict: hitl-light|hitl-full -->`
5. Apply GitHub labels per the label mapping table
6. Await human action — a human or Oz agent opens a fix PR if needed

## Decision Trace Example

Given a PR that touches `src/renderer/components/editor/Editor.tsx` only:
- Scorer returns: `{"score": 4, "threshold": "review"}`
- PE returns: `{"risk": "LOW", "privileged": false, "concerns": 1}`
- Path: score 4 >= 4, risk LOW → `hitl-light`
- Labels: `needs-review`
- Human (or Oz agent) reviews and decides on next steps

If the same PR also touched `src/main/ipc.ts`:
- PE returns: `{"risk": "MEDIUM", "privileged": true, "concerns": 2}`
- Path: privileged = true → immediate `hitl-full` (score doesn't matter)
- Labels: `complex`, `needs-review`

## Output Format

Machine-readable sentinel:
`<!-- orchestrator-verdict: hitl-light|hitl-full -->`

Human-readable summary with routing rationale referencing scorer dimensions and PE risk assessment.
