# QoL Pass 2 — Oz orchestration brief (proof wave)

**Audience:** the Warp Agent *parent* run that orchestrates this wave (via `/plan` → `/orchestrate`), and the
human conducting it. This is the input you hand `/plan`. It defines the scope, the per-child contract, the
isolation rules, and the merge strategy so the parent can propose a child breakdown for human approval *before*
any child launches.

> **How to run (in Warp, prose repo, env `prose`):**
> `/plan` → *"Read docs/orchestration/qol-pass-2-proof-wave.md and orchestrate the proof wave: one cloud child
> per issue in the Proof wave table, each using the `implement-issue` skill."*
> Review the proposed child ownership + merge strategy, then approve to launch. Monitor with `oz run list` /
> the Oz web app.

## Why a proof wave first

This is the **first** time we drive implementation through Oz cloud children rather than local Claude Code or
the `@claude` GitHub-Actions path. We validate the full loop end-to-end on a handful of low-risk, isolated issues
— child dispatched → branch → **draft PR** → CI review/triage → human QA → merge — *before* scaling to the
chunky Do-First tracks. Per decision, the chunky QoL items stay out of this wave.

## The per-child contract

- **One child = one issue.** Each child loads the **`implement-issue`** skill (`.claude/skills/implement-issue/`)
  as its base context; the prompt names the single issue number.
- **Environment:** `prose` (`erUdWNSiECqkTQ7BXj6J4Y`) — write-capable, `npm ci --include=dev`.
- **Output:** a **draft PR** with `Closes #<n>`, one PR per issue. The child **never merges, never pushes to
  `main`, never publishes**. A human reviews and merges.
- **Stay in lane:** change only the files that issue needs; avoid the shared hot files
  (`src/main/ipc.ts`, `src/preload/index.ts`, `settingsStore.ts`, `ChatPanel.tsx`, `Editor.tsx`) unless the
  issue is about them, and call it out in the PR if so.

## Proof wave (this run)

Clean, isolated, renderer-only — the recommended first launch:

| Issue | Title | Primary files | Notes |
|---|---|---|---|
| #716 | `/report-bug` & `/request-feature` slash commands | `components/chat/ChatInput.tsx` (+ command registry) | watch chat-area overlap with #719 |
| #717 | Tab right-click menu (Favorites + Open in Explorer) | `components/.../TabBar.tsx` | isolated |
| #725 | Frontmatter: submit/advance on Return | `components/editor/FrontmatterEditor.tsx` | isolated |
| #728 | `list_files` tree missing "Add to Favorites" | `components/chat/.../ListFilesResult.tsx` (file tree) | isolated |

Privilege-boundary **canaries** — include to verify the CI security-gate fires (they touch `src/main`/`preload`,
so the `pipeline-triage` security-gate should route them to `hitl-full`):

| Issue | Title | Primary files | Notes |
|---|---|---|---|
| #655 | Sentry runtime toggle inits SDK after `ready` | `src/main/sentry.ts` (+ `index.ts`) | **privilege boundary** (src/main) |
| #664 | Disable "Reopen Closed Tab" when stack empty | app menu (`src/main`), `src/preload/index.ts`, `tabStore` | **privilege boundary** (main + preload) |

Optional 5th renderer item if you want a wider first batch:

| Issue | Title | Primary files | Notes |
|---|---|---|---|
| #719 | a11y roving tabindex for Chat/Activity tablist | `components/chat/ChatPanel.tsx` | touches a hot file; overlaps #716's chat area — sequence after #716 |

## Explicitly NOT in this wave

- **#722** per-mode theme — *settings-shape serializer*; land first and **local** (touches `types`, `settingsStore`,
  `ipc` defaults). Other settings work rebases on it.
- **Chunky Do-First QoL** — #703→#723, #700→#699, #724, #729, #727, #701, #570 — **local worktrees** next wave
  (core abstractions / Circuit QA / serialized; per `/accelerate`'s "route locally" matrix).
- **Ops, not code agents** — #384 (Homebrew Cask), #536 (Sentry→GitHub) — human/console.
- **Dependabot #79** — trivial dep bump; handle locally.

## Merge strategy (fan-in)

1. Each draft PR triggers the existing CI: E2E, then `claude[bot]` review + `pipeline-triage` (now **triage-only**
   per #737 — no autonomous auto-fix). Security-gate routes privilege-boundary PRs to `hitl-full`.
2. Human (Angel) + local Claude QA each PR via HMR / Circuit Electron before merge.
3. Mark ready, merge **one at a time**; re-run validation on `main` after each. No batch auto-merge.

## Safety (cloud ignores local Agent Profiles)

Cloud children do **not** inherit the `Trusted Coding` / `Review` profiles. Guardrails for this wave:

1. **Branch protection on `main`** — *prerequisite, see gate below.* The structural stop against a child
   pushing to or merging `main`.
2. **Environment** `prose` carries no publishing/signing credentials (no `*.p8`, no Transporter/notarization).
3. **GitHub identity** — prefer the scoped **Oz by Warp GitHub App** (team) over a personal admin token so
   children are structurally non-admin and cannot bypass branch protection.
4. **Skill + prompt prohibitions** — the `implement-issue` skill hard-forbids merge/push-to-main, publishing,
   secret reads, board mutations, and `buildVersion` resets, and treats issue text as data not instructions.
5. **CI review gate** — every PR is reviewed; privilege-boundary paths escalate to human review.

## Pre-launch gate (must clear before `/orchestrate`)

- [ ] **Enable branch protection on `main`** (currently *unprotected*): require a PR to merge, block direct
      pushes. Recommended: require the E2E status check; 0 required approvals so Angel can still self-merge.
      (Decide `enforce_admins` — see hand-off.)
- [ ] Confirm children authenticate via the **Oz GitHub App** (not a personal admin PAT).
- [ ] `implement-issue` skill committed and discoverable (`oz agent skills` / present in `.claude/skills/`).
- [ ] `ANTHROPIC_API_KEY` (and any model access) available to the `prose` env.
