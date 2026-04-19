# Agentic Documentation Audit

**Date:** 2026-03-13
**Scope:** All project documentation, evaluated for usefulness in an agentic development SDLC
**Auditor:** Claude Opus 4.6

---

## Executive Summary

Prose has an unusually mature agentic documentation setup. The `CLAUDE.md` is one of the best I've seen — it functions as a genuine operating manual for an AI agent, not just a README with extra steps. The custom skills (QA, release, review-feedback, roadmap) encode entire workflows that would otherwise require repeated human instruction. The `docs/issues/` convention and the codebase-architect skill create a planning layer that separates "thinking about what to build" from "building it," which is exactly the right architecture for agentic development.

That said, there are clear gaps. The documentation is strongest where you've been burned (process management, Circuit Electron gotchas, the IndexedDB schema trap) and weakest where things have been working fine but are getting complex enough that an agent could make expensive mistakes (component patterns, the tool/suggestion pipeline, the streaming architecture). The roadmap doc is stale. And the memory system is empty, which means every new session starts cold.

**Overall grade: B+.** The bones are excellent. The gaps are fixable.

---

## What's Working Well

### CLAUDE.md — The Agent's Operating Manual

This is the single most important file for agentic development, and it's strong. Specific things that work:

**Operational guardrails are concrete.** The PID protocol for dev server management, the `NEVER: pkill -f node` warnings, the multi-agent awareness section — these prevent the exact class of mistakes agents make when given bash access. The "use SEPARATE Bash calls — never chain with &&" instruction shows you've debugged agent-specific failure modes, not just human ones.

**The "Before Implementation" and "Before Presenting Work" checklists** are high-value. Agents are bad at remembering to do pre/post work unless it's explicitly listed. These checklists short-circuit the most common agent failure: diving straight into code without checking branch state, or announcing "done" without verifying the build compiles.

**Architecture section is the right depth.** It names the key files, explains the process model, calls out the cross-platform abstraction (`getApi()` not `window.api`), and flags landmines (IndexedDB version bumps, "Anthropic is the only supported provider"). An agent reading this section can orient itself in the codebase within seconds.

**The workflow section encodes your actual process**, not an aspirational one. Branch naming conventions, commit message format, PR review protocol, the automated review analysis pipeline — this is all directly actionable.

### Custom Skills — Encoded Workflows

The skills are where this project goes from "well-documented" to "agentic-native." Each one is essentially a runbook an agent can follow autonomously:

**`qa-pr`** is particularly well-crafted. It handles the full lifecycle (fetch PR → checkout branch → kill stale processes → build → test → post results), includes workarounds for known Circuit Electron limitations, and has a collaborative manual testing protocol for things automation can't reach. The "Setup → Handoff → Verify" pattern is a genuine innovation for human-agent collaboration.

**`review-feedback`** encodes judgment, not just process. The "pragmatism over compliance" philosophy, the severity/effort matrix, the distinction between "Must Fix," "Consider Fixing," "Defer," and "Dismissed" — this gives an agent a decision framework, not just a checklist.

**`release`** is an end-to-end runbook that would be terrifying without documentation (version bump → build → regression test → release notes → GitHub release → local install verification → push). Each step has exact commands and expected outputs.

**`codebase-architect`** is the most architecturally interesting skill. It creates a clear separation between "planning agent" (read-only, advisory) and "implementation agent" (writes code). The execution boundary section is explicitly designed to prevent a common failure mode: an advisory agent accidentally making changes. The modes of operation (Plan Review, Codebase Q&A, Issue Triage, Acceleration Prep, PR Review) give the agent a clear role depending on context.

### docs/issues/ Convention

The per-issue documentation folders are excellent for agentic development. Issue #74 (database recovery) is a model: problem statement, current architecture analysis with code references, tiered solution design, implementation plan with specific files to modify, risk assessment, and testing strategy. An agent handed this document and told "implement Phase 1" has everything it needs.

Issue #55 (frontmatter editing) is equally good — it documents the investigation, presents options with tradeoffs, makes a recommendation, and flags risks. This is the kind of document that prevents an agent from making a well-intentioned but architecturally wrong choice.

---

## What's Missing or Weak

### 1. Stale Roadmap (High Impact)

`docs/roadmap.md` was last updated December 2024 and is significantly out of date. It lists "Multi-provider LLM chat" as a completed feature when `CLAUDE.md` says "Anthropic is the only supported provider." It references phases (Agentic Editing, Document Management, Streaming) that have been partially or fully completed. The "Key Files" section at the bottom references files that may no longer exist or have moved.

**Why this matters for agents:** The roadmap-prioritization and roadmap-refinement skills both read this document. If they cross-reference it with the actual issue board, they'll get confused by contradictions. More importantly, `MVP.md` appears to be the actual source of truth for current state but it's not referenced from the roadmap.

**Recommendation:** Either deprecate `roadmap.md` in favor of `MVP.md` + the GitHub project board, or update it to reflect current state. Add a "canonical sources of truth" note to `CLAUDE.md` so agents know which document to trust when they conflict.

### 2. No Component/Pattern Guide (High Impact)

The architecture section in `CLAUDE.md` names the stores and key files, but there's no documentation of UI component patterns. For an agent implementing a new feature, questions like these have no documented answers:

- How do you add a new settings tab? (What's the pattern in SettingsDialog?)
- How do you add a new IPC channel end-to-end? (handler in ipc.ts → type in preload → exposure in browserApi.ts)
- How do you add a new TipTap extension? (registration, where to put it, how to wire to stores)
- How do you add a new tool to the AI chat system? (tool definition, handler, rendering)
- How do you add a new panel to the resizable layout?

These are the "recipes" an agent needs most. Right now, an agent has to reverse-engineer these patterns from existing code every time. A section in `CLAUDE.md` called "Common Patterns" with 5-10 of these recipes would dramatically reduce implementation time and error rate.

**Recommendation:** Add a "Common Patterns" or "How to Add..." section to `CLAUDE.md`. Each pattern should list the files to touch, the order of operations, and link to an existing example in the codebase.

### 3. Empty Memory System (Medium Impact)

The `memory/` directory exists with `context/`, `people/`, and `projects/` subdirectories, but they're all empty. The productivity:memory-management skill is installed but has nothing to work with.

**Why this matters for agents:** Every Cowork session starts from zero context. The memory system is designed to accumulate project vocabulary (what "the tool pipeline" means, what "suggestion mode" refers to), people context (who works on what), and project context (current priorities, recent decisions). Without it, agents have to re-derive this context from `CLAUDE.md` and the codebase each time.

**Recommendation:** Seed the memory system with at least a `projects/prose.md` file covering: current phase, recent decisions, vocabulary/jargon, and the relationship between MVP.md/roadmap.md/the project board.

### 4. No Documentation of the LLM Tool Pipeline (Medium Impact)

The chat system's tool architecture is the most complex subsystem in the app, and it's the one most likely to be extended by agents (new tools, new modes). But there's no documentation of:

- The three tool modes (Suggestions, Full, Plan) and how they differ in behavior
- How tools are defined and registered
- The streaming pipeline (stream ID validation, tool roundtrip limits, abort handling)
- The suggestion/diff workflow (how AI edits become inline suggestions, how accept/reject works)

The codebase-architect skill's reference doc mentions these exist but `CLAUDE.md` only has a one-line description: "LLM calls flow: useChat hook → window.api.llmChat() → IPC → main process → Vercel AI SDK."

**Recommendation:** Add a "Chat & Tool Architecture" section to `CLAUDE.md` that documents the tool pipeline, tool modes, and streaming behavior. This is the area where an agent making a wrong assumption causes the most user-visible damage.

### 5. QA_feedback.md is Abandoned (Low Impact)

`docs/QA_feedback.md` references issues #2 through #7 and appears to be from the very early days of the project. It's not being maintained and the issues it references are likely long-closed. It creates noise for agents that scan the docs directory.

**Recommendation:** Delete it or archive it. QA feedback now flows through Circuit Electron test results posted to PRs, which is the better system.

### 6. No Error Recovery Playbook (Medium Impact)

`CLAUDE.md` has great preventive documentation (don't do X, always do Y) but no recovery documentation. When an agent encounters common failure states — build fails, port conflict, stale LevelDB lock, IndexedDB corruption in dev, Circuit Electron session won't connect — there's no documented recovery procedure beyond the scattered mentions in individual skills.

**Recommendation:** Add a "Troubleshooting" section to `CLAUDE.md` with the 5-10 most common failure states and their fixes. The skills already contain some of this (the QA skills have troubleshooting sections), but having it centralized in the main agent instructions means it's always in context.

### 7. docs/README.md Doesn't Map the Full Docs Landscape (Low Impact)

The docs README lists three items (roadmap, issues, QA_feedback) but doesn't mention spikes, research, or the relationship to MVP.md and CLAUDE.md. For an agent trying to understand where documentation lives, this is incomplete.

**Recommendation:** Update to include all documentation locations: spikes/, research/, the .claude/skills/ directory, MVP.md, and the memory/ system.

### 8. Security Audit Has No CLAUDE.md Integration (Low Impact)

The security audit at `docs/issues/127/findings.md` is thorough, but its findings aren't reflected in `CLAUDE.md`. An agent implementing a new IPC handler won't know about the SEC-03 pattern (missing path validation) unless it happens to read the security audit. The lesson — "always call validatePath() on file-writing IPC handlers" — should be a permanent instruction.

**Recommendation:** Add security-relevant implementation rules to the architecture section of `CLAUDE.md`: always validate paths in IPC handlers, never use innerHTML with dynamic data, always use safeStorage for secrets.

---

## Structural Observations

### Documentation is Agent-First, Not Human-First

This is a strength, not a criticism. The docs are written for an entity that reads fast, follows instructions literally, and needs explicit guardrails against destructive actions. The PID protocol, the "NEVER" warnings, the exact command sequences in skills — these are all calibrated for an agent audience. A human developer would find some of this overly prescriptive. For agents, it's exactly right.

### The Planning/Execution Split is Well-Designed

The separation between codebase-architect (read-only advisory) and implementation agents (write code) is architecturally sound. The `docs/issues/` plans serve as the handoff artifact. The acceleration workflow (architect produces brief → agent implements → QA validates) is a genuine SDLC, not just "tell the AI to code."

### Skills Are the Most Valuable Asset

The custom skills encode months of trial and error into reproducible workflows. They're more valuable than the static documentation because they capture process, not just knowledge. The QA, release, and review-feedback skills in particular would take a new team member weeks to internalize — an agent gets them immediately.

---

## Prioritized Recommendations

| Priority | Recommendation | Effort | Impact |
|----------|---------------|--------|--------|
| 1 | Add "Common Patterns" recipes to CLAUDE.md | Medium | High — reduces agent implementation errors |
| 2 | Resolve roadmap.md staleness (deprecate or update) | Small | High — eliminates conflicting sources of truth |
| 3 | Document the LLM tool pipeline and streaming architecture | Medium | High — protects most complex subsystem |
| 4 | Add "Troubleshooting" recovery playbook to CLAUDE.md | Small | Medium — faster recovery from common failures |
| 5 | Seed the memory system with project context | Small | Medium — reduces cold-start cost per session |
| 6 | Add security implementation rules to CLAUDE.md | Small | Medium — prevents repeating known vulnerabilities |
| 7 | Update docs/README.md to map full docs landscape | Small | Low — helps orientation |
| 8 | Delete or archive stale QA_feedback.md | Trivial | Low — reduces noise |
