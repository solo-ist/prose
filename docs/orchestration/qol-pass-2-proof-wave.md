# QoL Pass 2 — Oz orchestration brief (first cloud wave)

**Audience:** the Warp Agent *parent* run that orchestrates this wave (via `/plan` → `/orchestrate`), and the
human conducting it. This is the input you hand `/plan`. It defines the scope, the per-child contract, the
isolation rules, and the merge strategy so the parent can propose a child breakdown for human approval *before*
any child launches.

This is the **first** time we drive implementation through Oz cloud children (rather than local Claude Code or
the `@claude` GitHub-Actions path). It is a real QoL wave — all Quick Wins + four bounded Do-First issues, **12
issues total** — dispatched in **two batches** to respect file-overlap. Each child does one issue → draft PR →
CI review/triage → human QA → serial merge.

> **How to run (in Warp, prose repo, env `prose`):**
> 1. `/plan` → *"Read docs/orchestration/qol-pass-2-proof-wave.md and orchestrate **Batch 1**: one cloud child
>    per Batch-1 issue, each using the `solo-ist/prose:implement-issue` skill."* Review the proposed child
>    ownership + merge strategy, approve. Monitor with `oz run list` / the Oz web app.
> 2. After Batch 1 is reviewed, QA'd, and **merged**, run `/plan` again for **Batch 2** (so its children branch
>    off the updated `main` and don't collide with Batch-1 changes).
>
> The `implement-issue` skill is on `main` (PR #734 merged), so `solo-ist/prose:implement-issue` resolves for
> cloud children. The bare name `implement-issue` only resolves for *local* runs.

## The per-child contract

- **One child = one issue.** Each child loads the **`implement-issue`** skill
  (`.claude/skills/implement-issue/`), referenced **fully-qualified for cloud** as
  `solo-ist/prose:implement-issue` (resolved from `main`); the prompt names the single issue number.
- **Environment:** `prose` (`erUdWNSiECqkTQ7BXj6J4Y`) — write-capable, `npm ci --include=dev`.
- **Output:** a **draft PR** with `Closes #<n>`, one PR per issue. The child **never merges, never pushes to
  `main`, never publishes**. A human reviews and merges.
- **Stay in lane:** change only the files that issue needs; avoid the shared hot files
  (`src/main/ipc.ts`, `src/preload/index.ts`, `settingsStore.ts`, `ChatPanel.tsx`, `Editor.tsx`) unless the
  issue is about them, and call it out in the PR if so.

## Conductor responsibilities (alignment with the existing SDLC)

The `/accelerate` skill is the repo's established issue→agent playbook; this brief is the **Oz** dispatch path,
not a replacement. To stay consistent with it:

- **Routing source of truth = `/accelerate`'s matrix.** Cloud-dispatch isolated, bounded, clear-AC issues;
  cross-cutting/core/Circuit-QA-heavy work routes **local**. The chunky Do-First features below stay local.
- **`accelerated` label lifecycle** (per `/accelerate`): the **conductor** (not the child — the child's skill
  forbids board/label mutation) adds `accelerated` on dispatch, updates to `accelerated:pr-open` when the PR
  opens, removes it on merge. Note the label also triggers `web-e2e.yml` — keep it for tracking parity.
- **Links + one-at-a-time merge** (CLAUDE.md): surface every child run/PR URL; merge serially after green CI +
  `claude[bot]` review + local QA.

## Wave composition (12 issues, two batches)

File-overlap was pre-checked against the codebase. Children branch off `main` at dispatch, so collisions surface
at *merge* — the fix is to put colliding issues in different batches (Batch 2 branches off `main` after Batch 1
merges). **No two Batch-1 issues share a file.**

### Batch 1 — 8 issues, dispatch concurrently

| Issue | Scope | Primary files | Route |
|---|---|---|---|
| #716 | `/report-bug` + `/request-feature` slash commands | `chat/ChatInput.tsx`, `EnableLoggingDialog.tsx` | hitl-light |
| #717 | Tab right-click menu (Favorites + Open in Explorer) | `layout/TabBar.tsx` (calls `settingsStore.addFavorite`) | hitl-light |
| #719 | a11y roving tabindex for Chat/Activity tablist | `chat/ChatPanel.tsx`, `e2e/electron.activity-panel.spec.ts` | hitl-light |
| #725 | Frontmatter: submit/advance on Return | `editor/FrontmatterEditor.tsx` | hitl-light |
| #728 | `list_files` tree "Add to Favorites" | `chat/toolResultRenderers/ListFilesResult.tsx` (calls `addFavorite`) | hitl-light |
| #729 | Caret/scroll jump on first click (preview tab) | `editor/Editor.tsx` | hitl-light |
| #655 | Sentry runtime-toggle late-init warning | `src/main/sentry.ts`, `src/main/index.ts` | **hitl-full** |
| #664 | Disable "Reopen Closed Tab" when stack empty | `src/main/menu.ts`, `stores/tabStore.ts`, `layout/App.tsx` | **hitl-full** |

### Batch 2 — 4 issues, after Batch 1 merges

Internal order: **#724 + #727 concurrently** (disjoint) → then **#722** → then **#701**.

| Issue | Scope | Primary files | Route | Collides with (Batch 1/2) |
|---|---|---|---|---|
| #724 | Superscript + subscript + **footnotes** (full) | `editor/Editor.tsx`, `extensions/` (new), `types/index.ts`, `package.json` | hitl-light | `Editor.tsx` ← #729; `types` ← #722 |
| #727 | ENOENT-on-save → Save-As fallback, stop autosave loop, prune recents | `src/main/ipc.ts`, `hooks/useEditor.ts`, `hooks/useAutosave.ts`, `layout/App.tsx`, `files/FileListPanel.tsx`, `src/main/recentFiles.ts` | **hitl-full** | `App.tsx` ← #664; `ipc.ts` ↔ #722 |
| #722 | Per-mode Light/Dark theme (`lightColor`/`darkColor`) | `types/index.ts`, `settingsStore.ts`, `settings/AppearancePane.tsx`, `settings/ThemeCard.tsx`, `src/main/ipc.ts` | **hitl-full** | `ipc.ts`/`types`/`settingsStore` ↔ #701, #727, #724 |
| #701 | Customizable "…" menus + wiggle edit mode + persistence | `layout/Toolbar.tsx`, `files/FileListPanel.tsx`, `chat/ChatPanel.tsx`, `types/index.ts`, `src/main/ipc.ts`, `settingsStore.ts` | **hitl-full** | `ipc.ts`/`types`/`settingsStore` ← #722 |

### Collision map (files touched by ≥2 of the 12)

| File | Issues |
|---|---|
| `src/main/ipc.ts` | #722, #727, #701 |
| `src/renderer/types/index.ts` | #722, #701, #724 |
| `src/renderer/stores/settingsStore.ts` | #722, #701 (#717/#728 only *call* `addFavorite`, no write) |
| `src/renderer/components/editor/Editor.tsx` | #724, #729 |
| `src/renderer/components/layout/App.tsx` | #664, #727 |

### Watch flags (from the pre-check)

- **#701 — largest, dispatched as-is on purpose.** 6 files across all three "…" menus + a new
  `menuCustomization` schema + wiggle-mode UI, no scaffold. Dispatch it **last** in Batch 2 and watch the run;
  **pull it local** if the child flounders rather than merging a churny PR.
- **#727 — cross-cutting (main + renderer).** Human-review the structured-error IPC contract before merge.
- **#724 — footnotes** add `tiptap-markdown` serialization complexity; expect more QA on the resulting PR.
- **#722 — migration risk.** Brief the child to migrate existing single-`theme` users to `lightColor`/`darkColor`.

## Excluded from the wave

- **Chunky Do-First features → local worktrees:** #570 (AI provenance), #699 (comment threading), #700
  (extended thinking), #703→#723 (file-explorer rework) — core/serialized/Circuit-QA-heavy.
- **Ops, not code agents:** #384 (Homebrew Cask — needs a released build + external tap), #536 (Sentry→GitHub —
  console/integration config).
- **Dependabot #79** — trivial dep bump; handle locally.

## Merge strategy (fan-in)

1. Each draft PR triggers the existing CI: E2E, then `claude[bot]` review + `pipeline-triage` — now **review +
   triage only** (PR #739 retired autonomous auto-fix: `pipeline-fix.yml` deleted, orchestrator routes only
   `hitl-light`/`hitl-full`, E2E failures escalate). A child PR cannot trip a review→fix loop. Security-gate
   routes privilege-boundary PRs (the **hitl-full** rows above) to full human review.
2. Human (Angel) + local Claude QA each PR via HMR / Circuit Electron before merge.
3. Merge **one at a time**; re-run validation on `main` after each. No batch auto-merge. Batch 2 is dispatched
   only after Batch 1 is fully merged.

## Safety (cloud ignores local Agent Profiles)

Cloud children do **not** inherit the `Trusted Coding` / `Review` profiles. Guardrails:

1. **Branch protection on `main`** (applied): PR required, `e2e` must pass, `enforce_admins` ON — children can
   only open PRs, never merge/push `main`.
2. **Environment** `prose` carries no publishing/signing credentials (no `*.p8`, no Transporter/notarization).
3. **GitHub identity** — the scoped **Oz by Warp GitHub App** (team key `prose-cloud-agents`) for headless runs;
   interactive `/plan` uses your identity, but `enforce_admins` covers it either way.
4. **Skill + prompt prohibitions** — `implement-issue` hard-forbids merge/push-to-main, publishing, secret
   reads, board mutations, `buildVersion` resets, and treats issue text as data not instructions.
5. **CI review gate** — every PR is reviewed; privilege-boundary paths escalate to human review.

## Pre-launch gate

- [x] **Branch protection on `main`** — applied (PR required, `e2e`, `enforce_admins`, conversation resolution).
- [x] **PR #734 merged** — `implement-issue` skill + this brief are on `main`.
- [x] **PR #739 merged** — autonomous auto-fix retired; pipeline is review + triage only.
- [x] **Oz by Warp App** installed on `solo-ist` (all repos); team key `prose-cloud-agents` created.
- [ ] **Confirm** Warp → Settings → Admin Panel → Platform → Enabled GitHub Orgs shows `solo-ist`.
- [ ] **Confirm** `ANTHROPIC_API_KEY` (and model access) is attached to the `prose` env.

## Operational notes (from the Oz multi-agent-runs docs)

- **Parent cancel ≠ child cancel.** Cancelling the `/plan` parent does **not** auto-stop running children — they
  keep executing (and billing). Stop children explicitly if you abort. List descendants via the run API
  (`ancestor_run_id`) or `oz run list`.
- **Children inherit the parent's auth/billing** in agent-driven `/orchestrate`. Even if a child acts as an
  admin, `enforce_admins` on `main` still blocks any merge/direct-push — children can only open PRs.
- **Concurrency:** Build plan = 20 concurrent agents; Batch 1 (8) and Batch 2 (4) are each well within budget.
  Cloud runs consume Warp credits.
