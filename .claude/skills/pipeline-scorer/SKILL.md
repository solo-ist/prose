---
name: pipeline-scorer
description: Score PR review findings using a quantitative rubric. Outputs a 1-10 composite score across 6 dimensions to inform auto-fix vs human-review routing.
---

# Pipeline Scorer

Quantitative assessment of PR review findings to drive triage routing.

## Usage

```
/pipeline-scorer <pr-number>
```

## Rubric

Scores each dimension 1-5, then computes a composite score (1-10):

| Dimension | 1 (Low) | 5 (High) |
|-----------|---------|----------|
| Scope | 1-2 files changed | Cross-cutting changes |
| Severity mix | Style/nitpicks only | Security/data-loss issues |
| Change type | Config/docs | Core architecture |
| Test impact | No test impact | Untested critical paths |
| API surface | Internal only | Breaking public API |
| Dependency risk | No dep changes | Major dep overhaul |

## Routing Thresholds

| Score | Route |
|-------|-------|
| 1-3 | `auto-fix` — issues are trivial enough for automated fix |
| 4-6 | `review` — needs human verification |
| 7-10 | `complex` — full human review required |

## Workflow

1. Fetch the code review comment from the PR
2. Send to Claude Sonnet with the scoring rubric
3. Parse dimension scores and compute composite
4. Output structured analysis with sentinel for downstream pipeline

## Output Format

The output includes a machine-readable sentinel:
`<!-- scorer-output: {"score":N,"dimensions":{...},"threshold":"..."} -->`

And a human-readable breakdown table with rationale for each dimension score.
