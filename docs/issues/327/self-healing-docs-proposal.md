# Self-Healing Documentation for Agent Pipeline v2

**Issue:** [#327 — Agent Pipeline v2: Dual-Analysis Triage and Automated Fix Pipeline](https://github.com/solo-ist/prose/issues/327)
**Date:** 2026-03-13
**Status:** Proposal

---

## The Problem

Documentation in this project has two failure modes, and they're both caused by the same thing: documentation is a separate artifact from the code and processes it describes, so it drifts silently.

**Mode 1: Stale content.** `docs/roadmap.md` says multi-provider LLM chat is complete. `CLAUDE.md` says Anthropic is the only provider that matters. Both were accurate when written. Neither was updated when the other changed. An agent reading both gets contradictory instructions.

**Mode 2: Missing content.** The LLM tool pipeline (three tool modes, streaming, suggestion workflow) is the most complex subsystem in the app. It has zero documentation. Not because anyone decided not to document it, but because it evolved through PRs that each seemed too small to warrant a docs update. No individual PR was the right time to write the docs. Collectively, the gap is now significant.

The pipeline v2 proposed in #327 creates a natural intervention point for both failure modes. Every PR already passes through structured analysis (code review → triage → routing). Adding a documentation health check to this pipeline is architecturally free — it's just another signal the orchestrator consumes.

---

## How It Fits Into Pipeline v2

The key insight is that self-healing documentation is not a separate system. It's a new dimension in the existing triage and auto-fix pipeline. Here's where it plugs in:

```
PR Event
  → Code Review Agent (existing)
  → [Gate: issues found?]
      → Issues found: Fork to sub-agents (parallel)
          ┌─────────────────────────┐
          │ Sub-agent 1: Scorer     │  ← existing (quantitative)
          ├─────────────────────────┤
          │ Sub-agent 2: PE         │  ← existing (architectural)
          ├─────────────────────────┤
          │ Sub-agent 3: Doc Healer │  ← NEW (documentation drift)
          └─────────────────────────┘
          → Orchestrator merges all signals
          → Routes: code fixes, doc fixes, or both
```

But — and this is important — the Doc Healer is not an Opus-class agent. It's a lightweight, deterministic check that runs in parallel with the existing sub-agents at minimal cost. Think of it as a linter, not a reviewer.

### Why Not a Dedicated Security Agent (Same Reasoning)

The comment on #327 already explains why a third Opus agent for security is overkill: "The Principal Engineer sub-agent already catches architectural security concerns." The same logic applies here. We don't need a third expensive agent. We need a cheap, focused check that produces a structured signal the orchestrator can act on.

---

## Design: The Doc Healer

### What It Checks

The Doc Healer runs against every PR and produces one of three verdicts: `docs-current`, `docs-drift-detected`, or `docs-update-required`. It checks four things:

#### 1. CLAUDE.md Consistency (Static Analysis)

Compare the PR's changed files against claims in `CLAUDE.md`:

| PR touches... | CLAUDE.md claims... | Drift? |
|---------------|---------------------|--------|
| `src/main/ipc.ts` (adds new channel) | IPC channels list is `file:*`, `settings:*`, `llm:*`, `remarkable:*` | Yes — new channel not listed |
| `src/renderer/stores/` (adds new store) | Stores are `editorStore`, `chatStore`, `settingsStore`, `fileListStore` | Yes — new store not listed |
| `src/preload/index.ts` (exposes new API) | No mention of the new API surface | Yes |
| `package.json` (adds build command) | Commands section doesn't include it | Yes |
| `src/renderer/components/` (styling) | No architectural claims about components | No drift |

This is a deterministic file-path check. If the PR modifies files that CLAUDE.md makes claims about, flag it. No LLM needed for detection — just a mapping of "CLAUDE.md sections → file paths they describe."

**Implementation:** A JSON manifest (`docs/doc-file-map.json`) that maps CLAUDE.md sections to the file patterns they document:

```json
{
  "## Commands": ["package.json"],
  "### IPC Channels": ["src/main/ipc.ts", "src/preload/index.ts"],
  "### State Management": ["src/renderer/stores/**"],
  "### Electron Process Model": ["src/main/**", "src/preload/**"],
  "### Editor": ["src/renderer/components/editor/**"],
  "### reMarkable Integration": ["src/main/remarkable/**"],
  "### Settings": ["src/renderer/types/index.ts", "src/main/ipc.ts"],
  "## UI Conventions": ["src/renderer/components/**"]
}
```

When a PR touches files matching a pattern, the corresponding CLAUDE.md section is flagged for review. This is cheap to maintain because the manifest itself becomes a documented relationship between code and docs.

#### 2. Skill Freshness (Event-Driven)

Skills reference specific file paths, commands, and behavioral contracts. When the underlying code changes, the skill may break silently. Check:

- Do file paths referenced in skills still exist?
- Do commands referenced in skills still work? (e.g., if a skill says `npm run build:mac`, does that script exist in package.json?)
- Do MCP tool names referenced in skills still resolve?

**Implementation:** Parse skill files for file paths and commands, cross-reference against the repo state post-PR. This is grep + file existence checks — no LLM needed.

#### 3. Issue Doc Staleness (Lifecycle-Based)

`docs/issues/<number>/` folders are created during planning and never updated or archived. When the issue is closed, the plan doc becomes historical — useful for context but potentially misleading if someone reads it as current guidance.

**Implementation:** On PR merge, if the PR closes an issue that has a `docs/issues/<number>/` folder:
- Add a header to the plan doc: `> **Status: Implemented** — Merged in PR #X on YYYY-MM-DD`
- If the implementation diverged significantly from the plan (detectable by comparing plan.md file list vs. actual files changed in PR), add a note: `> **Note:** Implementation diverged from this plan. See PR #X for actual changes.`

#### 4. Cross-Document Consistency (Periodic)

Some documents make claims about each other. `MVP.md` lists features. `roadmap.md` lists phases. `CLAUDE.md` describes architecture. When these conflict, agents get confused.

This is the only check that benefits from an LLM, and it doesn't need to run per-PR. Run it weekly (or on `/docs-audit` command) as a scheduled workflow:

- Feed all documentation files to a Sonnet-class model
- Ask: "Identify any contradictions between these documents"
- Post results as a GitHub issue if contradictions found

---

## Integration With the Orchestrator

The Doc Healer's output feeds into the existing routing matrix as an additional dimension:

| Scorer | PE Risk | Doc Healer | Route |
|--------|---------|------------|-------|
| 1-3 | LOW | docs-current | Auto-fix code only |
| 1-3 | LOW | docs-drift-detected | Auto-fix code + auto-update docs |
| 1-3 | LOW | docs-update-required | Auto-fix code, flag docs for human |
| Any | Any | docs-drift-detected | Add `docs-drift` label to PR |
| Any | MEDIUM+ | docs-update-required | Add to human review checklist |

The key principle: **doc drift never blocks a merge, but it always creates a tracking artifact.** Either the auto-fix agent updates the docs in the same PR, or a follow-up issue is created automatically.

### Auto-Fix for Docs

When the Doc Healer detects drift in CLAUDE.md (e.g., a new IPC channel was added but not listed), the auto-fix agent can handle this alongside code fixes. The fix is mechanical: read the new code, update the relevant CLAUDE.md section.

For skill file fixes (broken file paths, outdated commands), the auto-fix is even simpler: update the path or command to match reality.

For cross-document contradictions, auto-fix is not appropriate. These require human judgment about which document is the source of truth.

---

## Implementation Plan (Phased, Aligned With #327)

### Phase 1: Doc-File Manifest (Ships With Pipeline v2 Phase 1)

Create `docs/doc-file-map.json`. Add a simple check to the review workflow: if PR touches files in the manifest, add a comment noting which CLAUDE.md sections may need updating. This is a reminder, not automation — but it's zero-cost and immediately useful.

**Effort:** ~2 hours. One JSON file, one shell script in the workflow.

### Phase 2: Skill Path Validation (Ships With Pipeline v2 Phase 2)

Add a CI step that validates all file paths and commands referenced in `.claude/skills/` files. Fails with a warning (not a block) if references are broken.

**Effort:** ~4 hours. Script to parse skill files, cross-reference paths.

### Phase 3: Issue Doc Lifecycle (Ships With Pipeline v2 Phase 3)

On PR merge that closes an issue, auto-update `docs/issues/<number>/plan.md` with implementation status header. Create a GitHub Action that runs on `pull_request.closed` + merged.

**Effort:** ~3 hours. Small workflow addition.

### Phase 4: Full Doc Healer Sub-Agent (Ships With Pipeline v2 Phase 4)

Integrate the doc-file manifest check, skill validation, and issue doc lifecycle into a single sub-agent that runs alongside the Scorer and PE. Output is a structured JSON signal consumed by the orchestrator. Auto-fix agent can now update CLAUDE.md and skill files mechanically.

**Effort:** ~1 day. Orchestrator integration, auto-fix template for doc updates.

### Phase 5: Cross-Document Audit (Ships With Pipeline v2 Phase 6)

Scheduled weekly workflow that checks all documentation for internal contradictions. Posts a GitHub issue if drift is detected. Can also be triggered via `/docs-audit` comment command.

**Effort:** ~4 hours. Scheduled workflow + Sonnet API call.

---

## What This Doesn't Solve

This system handles documentation that describes code (architecture docs, agent instructions, skills). It does not handle:

- **User-facing documentation** (help text, onboarding, feature descriptions) — these require product judgment, not code analysis
- **Documentation that doesn't exist yet** — the system can detect drift in existing docs, but it can't decide that a new subsystem needs documentation in the first place (though the PE sub-agent could flag this as an architectural concern)
- **Documentation quality** — it checks accuracy, not clarity or completeness

---

## Relationship to the Documentation Audit

The [agentic documentation audit](../audits/agentic-documentation-audit.md) from earlier today identified 8 recommendations. Here's how the self-healing system addresses each:

| Audit Recommendation | Addressed By |
|---------------------|--------------|
| 1. Add "Common Patterns" recipes | Not addressed — requires authoring, not healing |
| 2. Resolve roadmap.md staleness | Phase 5 (cross-document audit) detects this automatically |
| 3. Document LLM tool pipeline | Not addressed — requires authoring |
| 4. Add troubleshooting playbook | Not addressed — requires authoring |
| 5. Seed memory system | Not addressed — different system |
| 6. Add security implementation rules | Phase 1 (doc-file manifest) ensures security-relevant code changes flag CLAUDE.md |
| 7. Update docs/README.md | Phase 5 (cross-document audit) would flag incompleteness |
| 8. Delete stale QA_feedback.md | Phase 3 (issue doc lifecycle) handles staleness marking |

The honest answer: self-healing documentation solves the drift problem (recommendations 2, 6, 7, 8) but not the gap problem (recommendations 1, 3, 4). You still need a human (or a dedicated authoring session with an agent) to write the documentation that doesn't exist yet. What the system prevents is the documentation you write today becoming stale tomorrow.

---

## Open Questions

1. **Manifest maintenance cost.** The doc-file manifest (`doc-file-map.json`) is itself a document that can drift. Should it be auto-generated from CLAUDE.md section headers + heuristic file matching, or manually maintained? Manual is more accurate but adds maintenance burden.

2. **Noise threshold.** A PR that touches `src/renderer/stores/chatStore.ts` to fix a typo doesn't warrant a "State Management section may need updating" comment. How aggressive should the matching be? Suggestion: only flag when files are added or removed from a directory, not when existing files are modified.

3. **Skill validation depth.** Should the skill path validator just check file existence, or should it also verify that code patterns referenced in skills (e.g., "use `evaluate` to dispatch KeyboardEvents") still appear in the referenced files? Deeper validation catches more drift but is harder to maintain.

4. **Auto-fix trust level for docs.** Should the auto-fix agent be allowed to modify CLAUDE.md autonomously, or should doc changes always go through human review? CLAUDE.md is the agent's operating manual — an agent modifying its own instructions has obvious recursive trust implications.
