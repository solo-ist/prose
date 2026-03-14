---
name: pipeline-pe
description: Principal Engineer architectural risk analysis for PRs. Assesses blast radius, hidden coupling, and privilege boundary concerns. Outputs LOW-CRITICAL risk rating.
---

# Pipeline PE (Principal Engineer) Analysis

Architectural risk assessment from a senior engineering perspective.

## Usage

```
/pipeline-pe <pr-number>
```

## Analysis Framework

The PE agent evaluates changes across five dimensions:

| Dimension | What It Catches |
|-----------|----------------|
| Architectural coherence | Duct tape vs proper integration |
| Blast radius | Failure propagation paths |
| Root cause vs symptom | Band-aids vs real fixes |
| Tech debt trajectory | Is the codebase getting better or worse? |
| Hidden coupling | Implicit contracts created or broken |

### Electron-Specific Checks

| Check | Why It Matters |
|-------|---------------|
| Process boundary respect | Renderer <-> main must go through IPC |
| Context bridge exposure | New preload APIs need input validation |
| `getApi()` abstraction | Direct `window.api` bypasses the browser fallback |
| IPC validation | Handlers must validate renderer input |
| Store interactions | Cross-store deps create hidden coupling |

## Risk Levels

| Level | Meaning | Action |
|-------|---------|--------|
| LOW | Standard changes, well-contained | Auto-fix eligible |
| MEDIUM | Some architectural concern | Human should verify |
| HIGH | Significant risk, multiple concerns | Full human review |
| CRITICAL | Security, data loss, or systemic risk | Block merge, escalate |

## Privilege Boundary

PRs touching these paths are auto-flagged as `privileged: true`:
- `src/main/**` — full system access
- `src/preload/**` — context bridge / attack surface
- `electron-builder.*` — build/packaging config
- `electron.vite.config.*` — build config

Privileged PRs always route to human review regardless of score.

## Output Format

Machine-readable sentinel:
`<!-- pe-output: {"risk":"...", "privileged": bool, "concerns": N} -->`

Human-readable analysis with architecture review, specific concerns, and verdict.
