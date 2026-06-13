# QoL Pass 2 — Oz orchestration brief (proof wave)

**Audience:** the Warp Agent *parent* run that orchestrates this wave (via `/plan` → `/orchestrate`), and the
human conducting it. This is the input you hand `/plan`. It defines the scope, the per-child contract, the
isolation rules, and the merge strategy so the parent can propose a child breakdown for human approval *before*
any child launches.

> **How to run (in Warp, prose repo, env `prose`):**
> `/plan` → *"Read docs/orchestration/qol-pass-2-proof-wave.md and orchestrate the proof wave: one cloud child
> per issue in the Proof wave table, each using the `solo-ist/prose:implement-issue` skill."*
> Review the proposed child ownership + merge strategy, then approve to launch. Monitor with `oz run list` /
> the Oz web app.
>
> **The skill must be on the cloned branch.** Cloud children resolve `--skill` against the env's configured
> repo at its **default branch (`main`)**, so reference it fully-qualified as `solo-ist/prose:implement-issue`
> and **merge the skill to `main` first** (PR #734). The bare name `implement-issue` only resolves for *local*
> runs.

## Why a proof wave first

This is the **first** time we drive implementation through Oz cloud children rather than local Claude Code or
the `@claude` GitHub-Actions path. We validate the full loop end-to-end on a handful of low-risk, isolated issues
— child dispatched → branch → **draft PR** → CI review/triage → human QA → merge — *before* scaling to the
chunky Do-First tracks. Per decision, the chunky QoL items stay out of this wave.

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

- **Routing source of truth = `/accelerate`'s matrix.** Cloud-dispatch only issues that are isolated, bounded
  (≤5 files), clear AC, no core-abstraction/Circuit-QA needs; everything else routes **local**. The proof-wave
  table already honors this.
- **`accelerated` label lifecycle** (per `/accelerate`): the **conductor** (not the child — the child's skill
  forbids board/label mutation) adds `accelerated` to each issue on dispatch, updates to `accelerated:pr-open`
  when the child's PR opens, and removes it on merge. *Decision:* the `accelerated` label also triggers
  `web-e2e.yml`; keep it for tracking parity (recommended), or skip the label if browser-e2e on these renderer
  Quick Wins is unwanted noise.
- **Links + one-at-a-time merge** (CLAUDE.md): surface every child run/PR URL; merge serially after green CI +
  `claude[bot]` review + local QA.

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

1. Each draft PR triggers the existing CI: E2E, then `claude[bot]` review + `pipeline-triage` — **review +
   triage only once PR #739 merges** (retires autonomous auto-fix: `pipeline-fix.yml` deleted, orchestrator
   routes only `hitl-light`/`hitl-full`, E2E failures escalate rather than auto-fix). Until #739 lands the
   auto-fix paths still exist on `main` (though dispatch is currently broken), so don't launch before it merges.
   Security-gate routes privilege-boundary PRs to `hitl-full`.
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

- [x] **Branch protection on `main`** — applied: PR required, `e2e` must pass, 0 approvals, `enforce_admins`
      ON (admins included — no direct-to-main, even for Angel), force-push/deletion blocked, conversation
      resolution required.
- [ ] **Merge PR #734 to `main`** so the `implement-issue` skill + this brief are on the default branch the
      cloud env clones. *Without this, `solo-ist/prose:implement-issue` will not resolve for cloud children.*
- [ ] Confirm children authenticate via the **Oz by Warp GitHub App** (team key), not a personal admin PAT —
      Warp → Settings → Admin Panel → Platform → Enabled GitHub Orgs → `solo-ist`.
- [ ] `ANTHROPIC_API_KEY` (and any model access) available to the `prose` env.
- [ ] **Merge PR #739 — retire autonomous auto-fix** (resolves #737/#735, supersedes #736). Removes the
      mutation engine entirely (`pipeline-fix.yml` deleted; orchestrator routes only `hitl-light`/`hitl-full`;
      E2E failures escalate, not auto-fix), so a child PR structurally cannot trip a review→fix loop. The
      pipeline still reviews + triages every child PR.

## Operational notes (from the Oz multi-agent-runs docs)

- **Parent cancel ≠ child cancel.** Cancelling the `/plan` parent does **not** auto-stop running children — they
  keep executing (and billing). Stop children explicitly if you abort. List descendants via the run API
  (`ancestor_run_id`) or `oz run list`.
- **Children inherit the parent's auth/billing** in agent-driven `/orchestrate`. Run from a context whose GitHub
  identity you intend (ideally the Oz App). Even if a child ends up acting as an admin, `enforce_admins` on `main`
  still blocks any merge/direct-push — children can only open PRs.
- **Concurrency:** Build plan = 20 concurrent agents; the proof wave (≤7) is well within budget. Cloud runs
  consume Warp credits.
