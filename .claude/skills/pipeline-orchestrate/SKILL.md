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
| 1-3 | LOW, nitpick-only (`severity_mix == 1`) or docs/copy (`change_type == 1`) | `hitl-light` | Post analyses, `needs-review` — merge as-is or apply nits by hand |
| 1-3 | LOW, has a functional finding | `auto-fix` | Claude Code pushes fix commit |
| 1-3 | MEDIUM+ | `hitl-light` | Post analyses, label `needs-review` |
| 4-6 | LOW | `auto-fix-verify` | Fix + request human verification |
| 4-6 | MEDIUM+ | `hitl-full` | Full analyses, assign human |
| 7+ | Any | `hitl-full` | Label `complex`, full human review |
| Any | CRITICAL | `hitl-full` | Always escalate |
| Any | privileged | `hitl-full` | Security hard gate — always escalate |

**Nitpick/docs carve-out (#735):** a docs-only or nitpick-only PR is the *lowest*-complexity case, so it scores ≤ 3 and would otherwise hit `auto-fix` — but there's nothing substantive for the fix agent to change, so it makes cosmetic edits the next review re-flags as fresh nits, driving a review → fix → review loop. The router consults the scorer's `severity_mix` / `change_type` dimensions and downgrades these to `hitl-light` instead. `auto-fix` is reserved for low-score PRs with at least one functional finding to act on.

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

With the security-gate short-circuit (383-2), these PRs skip scorer+PE entirely — the `pipeline-triage.yml` `security-gate-check` job detects the `<!-- security-gate: true -->` sentinel in the review and posts `hitl-full` directly.

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

For a docs-only PR (e.g. `docs/issues/644/*.md`) with only cosmetic nits (the #735 case):
- Scorer returns: `{"score": 2.3, "threshold": "auto-fix", "dimensions": {"severity_mix": 1, "change_type": 1, ...}}`
- PE returns: `{"risk": "LOW", "privileged": false, "concerns": 4}`
- Path: score < 4, risk LOW, but `severity_mix == 1` → `hitl-light` (carve-out), **not** `auto-fix`
- Labels: `needs-review`
- No auto-fix dispatched — verdict notes the `auto-fix → hitl-light` downgrade

## Output Format

Machine-readable sentinel:
`<!-- orchestrator-verdict: auto-fix|auto-fix-verify|hitl-light|hitl-full -->`

Human-readable summary with routing rationale referencing scorer dimensions and PE risk assessment.
