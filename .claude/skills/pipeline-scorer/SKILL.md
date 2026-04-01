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

Scores each dimension 1-5, then computes a composite score (average x 2, range 1-10):

| Dimension | 1 (Low) | 5 (High) |
|-----------|---------|----------|
| Scope | 1-2 files changed | Cross-cutting changes |
| Severity mix | Style/nitpicks only | Security/data-loss issues |
| Change type | Config/docs | Core architecture |
| Test impact | No test impact | Untested critical paths |
| API surface | Internal only | Breaking public API |
| Dependency risk | No dep changes | Major dep overhaul |

## Routing Thresholds

| Score | Route | What it means downstream |
|-------|-------|------------------------|
| 1-3 | `auto-fix` | Issues are trivial — `pipeline-fix.yml` pushes a fix commit |
| 4-6 | `review` | Needs human verification — may become `auto-fix-verify` or `hitl-full` depending on PE risk |
| 7-10 | `complex` | Full human review required — always routes `hitl-full` |

Note: the scorer's threshold label is an input to the orchestrator, which applies its own routing matrix combining it with the PE risk level. The scorer does not directly dispatch anything.

## Calibration Examples

### Score ~2: Style-only fix
- Review found: two trailing whitespace warnings, one unused import
- Scope: 1 file | Severity: 1 | Type: 1 | Test: 1 | API: 1 | Deps: 1
- Composite: 2.0 → `auto-fix`

### Score ~4: Isolated bug fix
- Review found: off-by-one in pagination, missing null check in API handler
- Scope: 2 | Severity: 3 | Type: 2 | Test: 3 | API: 1 | Deps: 1
- Composite: 4.0 → `review`

### Score ~8: Security fix touching core architecture
- Review found: SQL injection in query builder, missing input validation on 3 API endpoints
- Scope: 4 | Severity: 5 | Type: 4 | Test: 4 | API: 3 | Deps: 1
- Composite: 7.0 → `complex`

## Common Pitfalls

- **Sparse reviews inflate severity.** A review with one nit and nothing else should score low (1-2), not medium. The absence of findings is signal.
- **Don't double-count.** If the review lists 5 instances of the same pattern (e.g., missing `validatePath()` in 5 handlers), that's one concern with wide scope — not 5 high-severity findings.
- **Config changes are rarely high-severity.** Changing `tsconfig.json`, `package.json` scripts, or CI workflow YAML is almost always scope=1, severity=1 unless it introduces a new dependency or changes build behavior.
- **Test impact != test changes.** A PR that changes core logic with no corresponding test updates should score high on test_impact even if the PR doesn't touch test files.

## Workflow

1. Fetch the code review comment from the PR
2. Send to Claude Sonnet with the scoring rubric
3. Parse dimension scores and compute composite
4. Output structured analysis with sentinel for downstream pipeline

## Output Format

The output includes a machine-readable sentinel:
`<!-- scorer-output: {"score":N,"dimensions":{...},"threshold":"..."} -->`

And a human-readable breakdown table with rationale for each dimension score.
