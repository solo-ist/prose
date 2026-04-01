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

| Check | Why It Matters | Example |
|-------|---------------|---------|
| Process boundary respect | Renderer <-> main must go through IPC | Importing `fs` in renderer bypasses sandbox |
| Context bridge exposure | New preload APIs need input validation | Adding `window.api.exec()` without sanitization |
| `getApi()` abstraction | Direct `window.api` bypasses the browser fallback | Should always use `getApi()` from `browserApi.ts` |
| IPC validation | Handlers must validate renderer input | `validatePath()` on all filesystem operations |
| Store interactions | Cross-store deps create hidden coupling | `chatStore` reading from `editorStore` directly |

## Risk Levels

| Level | Meaning | Routing Impact | Example |
|-------|---------|---------------|---------|
| LOW | Standard changes, well-contained | `auto-fix` eligible (if score ≤ 3) | Fixing a typo in a UI string |
| MEDIUM | Some architectural concern | `hitl-full` (if score ≥ 4) or `hitl-light` (if score ≤ 3) | Adding a new Zustand store with cross-store subscription |
| HIGH | Significant risk, multiple concerns | `hitl-full` | Changing the IPC channel protocol |
| CRITICAL | Security, data loss, or systemic risk | `hitl-full` (always) | Weakening CSP, disabling contextIsolation |

## Privilege Boundary

PRs touching these paths are auto-flagged as `privileged: true`:
- `src/main/**` — full system access (Node.js, filesystem, network)
- `src/preload/**` — context bridge / attack surface
- `electron-builder.*` — build/packaging config (signing, fuses, entitlements)
- `electron.vite.config.*` — build config (define blocks, entry points)

**`privileged: true` is a routing directive, not a bug.** It forces `hitl-full` regardless of score. This is correct — changes to the trust boundary between renderer and main process should always have human review. Don't lower this flag to get auto-fix routing.

## LOW vs MEDIUM Decision Guide

Ask yourself: "If this change has a subtle bug, what's the worst that happens?"

- **LOW**: User sees a visual glitch, a tooltip is wrong, a log message is malformed. The app still works. Fix is straightforward and contained.
- **MEDIUM**: User data could be stale, a sync could skip items, a store subscription fires out of order. The app works but produces wrong results in some cases. Fix requires understanding interaction between components.

When in doubt, lean MEDIUM — the cost of over-escalating is a human glance; the cost of under-escalating is a shipped bug.

## Workflow

1. Fetch the review comment and changed files from the PR
2. Send to Claude Opus with the PE analysis prompt
3. Check changed file paths against privilege boundary list
4. Produce risk assessment, concern list, and verdict
5. Output structured analysis with sentinel for downstream pipeline

## Output Format

Machine-readable sentinel:
`<!-- pe-output: {"risk":"LOW|MEDIUM|HIGH|CRITICAL", "privileged": true|false, "concerns": N} -->`

Human-readable analysis with architecture review, specific concerns, and verdict.
