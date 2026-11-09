# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

OpenAI Codex and other non-Claude agents use `AGENTS.md` as their repository entry point.
Claude agents should also read `AGENTS.md` for shared cross-agent coordination rules, then use
this file for Claude-specific workflows, skills, and deeper project context.

## Roadmap & Planning — read `docs/roadmap.md` first

**Before any planning, prioritization, sequencing, or parallelization work** — including "what should we work on / what's next," scoping a wave or epic, or proposing how to split work across agents — **read [`docs/roadmap.md`](docs/roadmap.md) first.** It is the canonical, resumable source of truth for *what* we're building, *in what order* (the wave model), and *how the work is parallelized* (the three concurrent Wave 1 tracks and the **A→B→C merge ladder**). The sequencing and parallelization strategy already lives there — build on it, don't reinvent it. The [project board (#5)](https://github.com/orgs/solo-ist/projects/5/views/1) is the live queue; the roadmap is the narrative + operating model (column = phase, milestone = wave). It changes frequently, so **read the current version**: if your branch may be behind `main`, run `git fetch origin` and read `git show origin/main:docs/roadmap.md` (or sync first) — a stale worktree can show an outdated or even retired roadmap.

## Development Environment

This project uses an **agentic, multi-agent development workflow**:

- **Multiple Claude Code agents** may run simultaneously on the same machine — across terminal sessions, git worktrees, different branches, or different repos. Never assume you're the only agent running.
- **Prefer Agent Teams and git worktrees** for parallelizing independent work. Use `isolation: "worktree"` when spawning agents that need to make changes without conflicting with the main working tree. This avoids branch conflicts and lets multiple agents write code simultaneously. **Branch new worktrees off freshly-fetched `origin/main`** (`git fetch origin` first) — a worktree cut from a stale base shows outdated docs, including an old `roadmap.md`.
- **Worktree git commands**: Always use `git -C <worktree-path> <subcommand>` instead of `cd <path> && git <subcommand>`. Single commands match the `Bash(git:*)` allowlist; compound `cd && git` chains get flagged for manual approval, which blocks unattended agents.
- **Cloud agents** (via GitHub Actions) handle PR reviews, automated fixes, and pipeline triage. Local agents handle implementation, QA, and complex features.
- **The CI pipeline is self-enhancing** — automated review (`claude.yml`), scoring (`pipeline-triage.yml`), and auto-fix (`ci-gate.yml`) run on every PR. Skills and workflows evolve alongside the codebase.
- **Be mindful of concurrent sessions.** Other terminal sessions or worktree agents may be running builds, dev servers, or tests at the same time. Check for port conflicts before starting servers. Use PID files (not `pkill` patterns) for process management. Use `gh` CLI (not GitHub MCP) for all GitHub operations. Always `git fetch origin` before comparing branches — another session may have pushed.
- **The project board** (GitHub Projects #5) tracks priority and in-progress work. Board #5 has no "In Progress" column — status columns are: **User Requested**, **Do First**, **Do Next**, **Later**, **Quick Wins**, **On Hold**. Never mutate board field definitions — only move items between existing columns. The overarching roadmap narrative (epics, waves, sequencing) lives in [`docs/roadmap.md`](docs/roadmap.md).

## Commands

```bash
npm run dev          # Start development (Electron + Vite HMR, debuggable on port 9222)
npm run build        # Build for production (unpacked)
npm run build:mac    # Build macOS distributable (.app + .dmg)
npm run build:mas    # Build Mac App Store package (MAS_BUILD=1)
npm run build:win    # Build Windows distributable
npm run build:linux  # Build Linux distributable
```

**Install**: `npm ci` is enough. Electron ≥ 42 downloads nothing in its own `postinstall`; ours runs `install-electron` after `electron-builder install-app-deps`, so the binary lands at install time (electron-vite needs it before `npm run dev`). If a checkout ever lacks it, run `npx install-electron`.

**Note**: Always run these commands for the user rather than asking them to run manually. Start dev servers in the background so work can continue.

**Testing**: Unit tests via vitest (`npm run test:unit`; `src/**/*.test.ts`, jsdom, a headless TipTap editor built from `createEditorExtensions()`; runs in CI before the Electron suite). E2E tests via Playwright (`e2e/`, `playwright.config.ts`). Manual QA via Circuit Electron (see below).

## Before Implementation

Before writing any code, complete this checklist:

1. **Roadmap**: Read [`docs/roadmap.md`](docs/roadmap.md) — confirm where the issue sits (wave / track) and how it sequences against other work. (Mandatory for any planning/sequencing/parallelization task.)
2. **Branch**: Create or switch to issue branch: `git checkout -b issue-<number>-<description>`
3. **Docs**: For complex issues, create `docs/issues/<number>/plan.md`
4. **Verify**: Run `git branch --show-current` to confirm you're not on `main`

## Before Presenting Work for Review

Before presenting completed work for user review, ensure a clean environment:

1. **Kill this project's dev server**: Use PID file for safe cleanup (see below)
2. **Start fresh dev server**: Run `npm run dev` in the background
3. **Verify no errors**: Check dev server output for compilation errors before announcing completion

This prevents LevelDB lock conflicts and ensures the user sees the latest changes.

### Verification Instructions

Always include human-readable verification steps when presenting completed work. These should let the user independently confirm the changes work. Format as numbered steps with exact commands to run and what to look for in the output. Prefer verification against the locally running dev server; only use `npm run build:mac` + the built app when the change specifically requires a production build to verify.

## Working Tree Hygiene

Before announcing a task complete, run `git status`. Every untracked file must have a destination — do not leave files orphaned across sessions.

- **Project code/config** (e.g., `.claude/` — standard Claude Code project config) → committed
- **Project docs** → commit under `docs/` (or `docs/issues/<n>/` for issue-linked docs)
- **Historical/reference docs** (launch checklists, audits, proposals) → commit under an appropriate `docs/` subdirectory such as `docs/launch/` or `docs/audits/`
- **Claude Cowork artifacts** (`.skills/`, `*.plugin`) → gitignored; these are per-session tooling outputs, not project files
- **Editor/IDE state** (`.vscode/`, `.idea/`, `.zed/`) → gitignored
- **Local-only scratch** (one-off drafts) → either delete, or place under a gitignored path

If a file's destination needs user input, ask explicitly — don't defer the decision by leaving it untracked.

## QA Testing

The app supports automated QA testing via Circuit Electron MCP (configured at parent level).

### Workflow

Circuit Electron launches its own Electron instance, which bypasses electron-vite's dev server. For reliable testing:

1. **Build first**: Run `npm run build` to create fresh `out/` files
2. **Launch with Circuit Electron**: Use development mode to launch from project directory
3. **Test the feature**: Interact with the app using Circuit Electron tools
4. **Clean up screenshots**: Delete `electron-screenshot-*.jpeg` files from the project root after testing

### Dev Server PID Protocol

The dev server writes its PID to `.dev.pid` on startup. **Always use this file** for process management—never use pattern matching like `pgrep -f "prose.*Electron"` which may match stale instances from other sessions.

```bash
# Check if running (use SEPARATE Bash calls — never chain with && or ||)
cat .dev.pid 2>/dev/null        # Call 1: read the PID
ps -p <PID> -o pid=             # Call 2: check if process exists

# Kill only THIS project's dev server
kill <PID>                      # Use the PID from call 1

# Fallback ONLY if PID file missing (use sparingly - may affect other agents)
pkill -f "prose.*Electron"
pkill -f "electron-vite.*prose"

# NEVER: pkill -f node      # This kills Circuit Electron MCP!
# NEVER: pkill -f Electron  # This kills ALL Electron apps!
# To clear LEAKED Circuit servers safely, use the reaper (orphans only) — see below:
#   node scripts/reap-circuit.mjs
```

If the PID file is missing but Electron processes exist, they're likely stale from a crashed session. Kill them before starting fresh.

### Multi-Agent Awareness

Multiple Claude Code agents may run simultaneously on this machine, potentially working on different Electron apps with similar signatures. This causes:

- **Port conflicts**: Default ports (5173, 9222) may already be in use
- **Process confusion**: Broad `pkill` patterns kill another agent's processes
- **Session conflicts**: Circuit Electron sessions may collide

**Always prefer the PID file method** for cleanup. When encountering "address already in use" errors, check if another agent is active before assuming a bug. Vite automatically finds alternative ports, but DevTools debugging port (9222) conflicts will cause launch failures.

### Orphaned Circuit Server Cleanup

Circuit Electron (`@snowfort/circuit-electron`, a `0.0.x` alpha) does **not** exit when its Claude client disconnects. Orphaned servers reparent to `launchd` and many spin into ~100% CPU busy-loops; left alone they pile up (one sweep found 74 of them eating ~10 cores). The dev-server PID protocol above does **not** cover this — it kills the app, not the MCP server.

Reap them safely with:

```bash
node scripts/reap-circuit.mjs            # kill orphaned servers
node scripts/reap-circuit.mjs --dry-run  # report only, kill nothing
```

This is the safe inverse of "NEVER pkill -f node": it kills a Circuit process **only** if its parent chain reaches `init` (pid 1) through Circuit processes alone. Any server still attached to a live client — this session's, a concurrent agent's, even a terminal you launched it from — is spared, so it's multi-agent safe by construction. The QA skills (`qa-pr`, `qa-accelerated`, `qa-hitl`) invoke it automatically; run it by hand any time CPU spikes from stray `node` processes.

### Built App Location

After `npm run build:mac`, the app is at:
```
dist/mac-arm64/prose.app
```

## Workflow

- **Use `gh` CLI for all GitHub operations**: Issues, PRs, project board, checks, releases — always use `gh` commands via Bash, never a GitHub MCP server. The `gh` CLI is pre-authenticated and available both locally and in CI.
- **Track work in GitHub Issues**: Create issues before starting work.
- **Branching**: Create a branch per issue using format `issue-<number>-<short-description>` (e.g., `issue-42-fix-login-bug`). Branch from `main`.
- **Commits**: Reference issue numbers in commits (e.g., `Fix login validation (#42)`).
- **Pull requests**: One PR per issue. Merge to `main` after code review.
- **Before merging any PR**: Check for unresolved review comments (`/review-feedback <pr-number>` or `gh api repos/solo-ist/prose/pulls/<number>/comments`). Do not merge until all feedback is addressed, dismissed with rationale, or deferred to a follow-up issue.
- **Always output links**: After creating, closing, or commenting on issues or PRs, always output the full URL (e.g., `https://github.com/solo-ist/prose/pull/42`) so the user can Cmd+click from the terminal.
- **Issue documentation**: For complex issues, create a folder in `docs/issues/<number>/`. See `docs/issues/README.md` for details.

### Automated Review Analysis

Claude reviews a PR whenever E2E passes on it — on PR open and after every push — because `ci-gate.yml`'s `trigger-review` job auto-posts a `/review` on green CI (self-debounced ~10 min). `claude.yml` has **no** `pull_request` trigger: a `/review` comment is the only way in. A second workflow (`review-feedback.yml`) auto-analyzes that review:

1. **Detection**: Triggers on `issue_comment` from `claude[bot]` containing `## Code Review`
2. **Analysis**: Calls Claude Sonnet API to categorize feedback (Blocking / Functional / Quality / Nitpicks / Questions)
3. **Output**: Posts structured triage comment with severity, effort, and MERGE / FIX REQUIRED / NEEDS DISCUSSION recommendation
4. **Loop prevention**: Analysis comments include a `<!-- review-feedback-analysis -->` sentinel excluded from detection

**On-demand review**: Comment `/review` on a PR to trigger a fresh code review. **You rarely need to** — `ci-gate.yml` auto-posts `/review` whenever E2E passes (on PR open *and* after each push), so a green CI already triggers the review. A redundant manual `/review` double-runs the cloud reviewer *and* the `review-feedback` analysis — wasted cloud-agent runs.

**When no auto-review appears on green CI**, it was almost certainly the **author-trust gate**: `trigger-review` skips the review unless the *PR author* has repo `write`/`admin` (checked via `getCollaboratorPermissionLevel` — **not** `author_association`, which misreports private org members as `CONTRIBUTOR`). The gate lives in `ci-gate.yml` rather than `claude.yml` because the `/review` is posted as the PROJECT_TOKEN owner, who is always trusted — so `claude.yml`'s commenter check structurally cannot catch a fork author, and an outside contributor could otherwise spend Anthropic credits on demand.

So a fork PR from an outside contributor goes green with **no review**, logging `Notice — auto-review skipped (untrusted author)` in the CI Gate run. To review it, post `/review` yourself: `claude.yml` checks the *commenter's* permission, so a maintainer comment passes, and the review reads the diff via `gh pr diff`, which works across forks. Same remedy when E2E was skipped entirely.

**Manual trigger**: Run `workflow_dispatch` on `review-feedback.yml` with a PR number to re-analyze any PR.

**Local deep-dive**: For code-level validation of review concerns, use `/review-feedback <pr-number>` locally. The cloud version is a quick triage; the local skill reads actual source files.

### CI/CD Workflows

All workflows in `.github/workflows/`:
- `claude.yml` - Code review + `@claude` mention handler; entered via `/review` comment only (no `pull_request` trigger)
- `review-feedback.yml` - Analyzes claude[bot] review comments, posts structured triage
- `e2e.yml` - Electron Playwright tests on every PR (or `/test` comment); a Postgres service and `gateway/` installed for the relay spec's local gateway (#1239)
- `web-e2e.yml` - Browser Playwright tests for `accelerated`-labeled or bot PRs
- `gateway.yml` - Gateway integration suites (`npm run test:share`, `test:mail`, `test:share:subdomains`, and the MCP relay's `test:relay`, against a Postgres service) on PRs touching `gateway/**`
- `share-viewer-e2e.yml` - Shared web viewer suite (`e2e/web.share-viewer.spec.ts`) on PRs touching the viewer, the artifact builder, or the spec
- `ci-gate.yml` - On E2E `workflow_run` success, auto-posts `/review` (the green-CI review trigger), gated on the PR author having repo write access; on failure, routes to auto-fix
- `pipeline-triage.yml` - Scores review findings, routes to auto-fix or human review
- `pipeline-fix.yml` - Claude agent auto-fixes simple review findings
- `dispatch.yml` - Routes `/triage`, `/fix`, `/pipeline` slash commands to downstream workflows
- `feature-request-triage.yml` - Adds `feature-request`-labeled issues to project board
- `release.yml` - Builds and publishes macOS distributable to GitHub Releases on version tag push (`v*`)

## Architecture

### Cross-Platform Design

The app is designed to run both as an Electron desktop app and as a standalone web app. All platform-specific code is abstracted behind the `ElectronAPI` interface:

- **Electron**: Uses IPC to call main process for file dialogs, settings persistence (`app.getPath('userData')/settings.json`), and LLM API calls
- **Web**: Uses File System Access API (with `<input>` fallback), localStorage for settings, and direct API calls (limited by CORS — Anthropic blocks browser requests, so web mode LLM features are unavailable)

Always use `getApi()` from `src/renderer/lib/browserApi.ts` instead of accessing `window.api` directly. This returns the Electron API when available, or a browser-compatible fallback.

### Electron Process Model

When running as Electron:

1. **Main Process** (`src/main/`): Node.js environment handling window management, native file dialogs, and LLM API calls. LLM calls run here to avoid CORS issues.

2. **Preload** (`src/preload/index.ts`): Context bridge exposing `ElectronAPI` to the renderer via `window.api`.

3. **Renderer** (`src/renderer/`): React app with no direct Node.js access.

### IPC Channels

Most handlers live in `src/main/ipc.ts` (86 across 14 namespaces). A few sit closer to their feature: `sentry:setEnabled` and `renderer:ready` in `src/main/index.ts`, `updater:*` (3) in `src/main/updater.ts`, `file:watch:start` and `file:watch:stop` in `src/main/fileWatcher.ts`, `appStoreImport:*` (6) in `src/main/appStoreImportIpc.ts`, `mcp:tool:result` (via `ipcMain.on`, not `handle`) in `src/main/mcp/bridge.ts`, `mcp:connections:*` (4) and `mcp:endpoint` in `src/main/mcp/connectionsIpc.ts`, and `mcp:remote:*` (7) in `src/main/mcp/relayService.ts`.

- `file:*` (22) - File operations (open, save, read, rename, delete, trash, duplicate, watch, export HTML, MAS bookmark activation, etc.) — 20 handlers in `ipc.ts`, plus `file:watch:start` and `file:watch:stop` in `fileWatcher.ts`
- `settings:*` (4) - Settings persistence, secure storage check, API key test
- `llm:chat`, `llm:fetchModels`, `llm:stream`, `llm:stream:abort` - LLM API calls (the Anthropic SDK, or the Chat Completions adapter for OpenAI); the request names a provider and main reads its key
- `llm:keyStatus`, `llm:setKey`, `llm:clearKey` - Per-provider API keys: the renderer sets or clears a key and reads back only its status (#1240)
- `remarkable:*` (20) - reMarkable tablet sync (register, validate, sync, sync:abort, OCR, folder move, etc.)
- `mcp:*` (8) - MCP server status, install, uninstall for Claude Desktop; connections (list, create, rename, revoke) and the HTTP endpoint's URL (#1236)
- `mcp:remote:*` (7) - Remote access (#1239): status, the switch, and the remote connections (list, approve, update, deny, remove); main pushes `mcp:remote:changed`. Every handler refuses on MAS builds
- `share:*` (21) - Gateway sharing: sign-in, access, publish/republish/revoke, local list + `share:listRemote` gateway reconcile (#1037), comments pull/push, path updates. Only the two local reads (`share:list`, `share:getForPath`) are callable on MAS builds
- `sentry:setEnabled` - Toggle Sentry error tracking from renderer
- `updater:*` (3) - Auto-update check, download, install (Electron auto-updater)
- `appStoreImport:*` (6) - Import the App Store edition's profile into the direct build (#1243): status, start (stages the import and relaunches; the copy runs in `runPendingImport` at the next launch, before anything opens the profile), decline, acknowledge, importKeys / discardKeys. Every handler reports unavailable on MAS builds
- `skill:download` - Download an external skill for use inside Prose
- `clipboard:*` (1) - Write text to system clipboard
- `appearance:*` (1) - Pin the macOS dock tile to the Prose icon
- `window:*`, `shell:*`, `recentFiles:*`, `emoji:*`, `fileAssociation:*` - Utility handlers

### State Management

Editor state is not in a store. Every open tab owns a ProseMirror `EditorState` held by a session in `src/renderer/document/session.ts` (see "Editor" below); the tab record in `tabStore` is the truth for a document's body, frontmatter, dirty flag, preview / read-only flags and rich-or-source mode; annotation records, comment threads and suggestions live in the plugins' own state.

Zustand stores in `src/renderer/stores/`:
- `tabStore` - The tab records (`Tab`: identity, `content`, `frontmatter`, `isDirty`, `isPreview`, `readOnly`, `mode`, `viewState`), the closed-tab history, session persistence to IndexedDB; `useActiveTab(select)` reads the active record
- `editorStore` - A **mirror** of the active tab's record (`document`: id, path, content, frontmatter, dirty; written only by the session layer and `tabs/actions.ts`) plus UI flags (`isEditing`, `isRemarkableReadOnly`, `isAutosaving`, `annotationsVisible`, the AI frontmatter overlay `pendingFrontmatter`, the status-bar cursor). Nothing computes on the mirror.
- `editorInstanceStore` - TipTap editor instance reference
- `chatStore` - Chat messages, conversations, streaming state, panel visibility
- `settingsStore` - App settings (theme, LLM config, editor preferences)
- `fileListStore` - File explorer state and directory listing
- `reviewStore` - Review mode (`quick`/`side-by-side` for AI edits, `comments` for comment threads), suggestion navigation
- `summaryStore` - AI-generated document summaries, staleness tracking
- `commandHistoryStore` - Per-tool argument history, persisted to IndexedDB
- `linkHoverStore` - Currently hovered link URL for tooltip
- `notificationStore` - Bespoke in-app toasts (the app uses no toast library; rendered by `components/layout/Notifications.tsx`)
- `sharedListStore` - Every local share entry (live + revoked) for the explorer's Shared view and the ◎ indicator on shared tree rows (#1036)
- `shareStore` - The active document's share entry and sync status (the ◎ popover)
- `accountStore` - Gateway sign-in state
- `projectsStore` - Project roots for the explorer

### Feature Flags

`src/renderer/lib/featureFlags.ts` gates features that aren't ready for public release. Flags are persisted in `settings.json` (in `app.getPath('userData')`) under the `featureFlags` key. Each flag has its own default — see below.

To override a flag without rebuilding, add to `~/Library/Application Support/Prose/settings.json` (macOS; `Prose Dev/settings.json` for `npm run dev`):
```json
"featureFlags": { "remarkable": false }
```

Current flags:
- `remarkable` — reMarkable tablet sync (v1.1). **Default: on for desktop builds; forced off for MAS builds** regardless of the user's setting, since the reMarkable Cloud auth and OCR Lambda credentials aren't ready for App Store review. Set to `false` explicitly to disable on desktop.
- `webPlatform` — sharing via the Prose gateway (share links, live comments, sign-in). **Default: on for desktop builds since 1.8.1 (#943); forced off for MAS builds.** Publishing is still gated server-side by the `share_publish` grant; users without one get Request access (#1018). Read it through `webPlatformOn` / `useWebPlatformEnabled` / `isWebPlatformEnabled` — never `featureFlags.webPlatform` directly — so the default lives in one place.

The module exports React hooks (`useRemarkableEnabled`, `useWebPlatformEnabled`) for use in components and non-hook accessors (`isRemarkableEnabled`, `isWebPlatformEnabled`) for use in callbacks. When gating a feature, import the appropriate function and use it to guard UI rendering, background effects, and menu handlers. Preserve all code — gate, don't delete.

### IndexedDB Schema Changes

Client-side persistence uses IndexedDB (`src/renderer/lib/persistence.ts`). When modifying the schema:

- **Always bump `DB_VERSION`** when adding/removing object stores. The `onupgradeneeded` callback only runs when the version increases—reopening at the same version won't create missing stores.
- **Upgrades can be blocked** if the database is open in another tab. The upgrade waits until all connections close, but users may not notice. New stores may silently fail to create.
- **Test fresh installs and upgrades** separately. A fresh install always gets the latest schema, but existing users need the migration path.

**Editor-state rules (comments, AI suggestions, AI annotations):** marks and
decorations are NOT serialized into the `.md`; the records live in IndexedDB
keyed by `documentId` and are re-applied at load by matching the marked text.
Four rules keep them safe, each enforced by a mechanism rather than a
convention (design: `docs/architecture/editor-state.md` §3.3; the tripwires in
`e2e/electron.document-sessions.spec.ts` fail the build when one is broken):
1. **No write without the producing state's document id.** The three IndexedDB
   writers (`saveAnnotations`, `saveComments`, `saveSuggestions` and their
   deletes) are imported only by `document/session.ts`, whose `persistRecords`
   reads the id and the records from the same `EditorState`.
2. **Id and records change together.** They are fields of one immutable
   `EditorState` (the identity plugin and each record plugin's state): a state
   is created whole and replaced whole, so no moment has the next id with the
   previous records.
3. **No timing flag guards shared state.** Load-time work is a pure function
   that returns a finished state: marks are applied inside the session's seed
   transaction before a state is ever shown, a reload re-anchors inside the
   replace transaction, and a record is added in the transaction that creates
   it. Nothing polls for "restored".
4. **Design before touching shared editor state.** Only `session.ts` calls
   `view.updateState`, creates an `EditorState` or persists records; no renderer
   code calls `commands.setContent` (the session builds states). A new writer or
   projection is a function in `session.ts`, added in a PR that cites the
   design (`docs/patterns.md`, "How to Add a Session Writer or Projection").

### LLM Integration

**Providers** are listed in `src/shared/llm/providers.ts` (transport, base URL, credential key, models, small model, thinking, live-model filter): Anthropic (`transport: 'anthropic'`, its SDK) and OpenAI (`transport: 'chat-completions'`). Every switch on the transport in main is exhaustive (a `never` default), so a new one fails to compile until each path handles it. Inference Coop (#956) is a Chat Completions entry with its own base URL. **Anthropic-only, whatever the chat provider:** tab emoji (Claude Haiku) and reMarkable OCR read the Anthropic key. **Keys stay in main** (`src/main/llmKeys.ts`): the renderer never holds one. It sees `settings.llm.keyStatus` (each provider's last four characters and whether the key persists), stores a key with `setLlmKey` and clears it with `clearLlmKey`; `settings:save` never stores a key. Settings → LLM shows one key row per provider (`components/settings/ProviderKeys.tsx`); `setActiveProvider` switches the provider in use and restores its model (`settings.llm.modelByProvider`); every model picker reads `useAvailableModels()` (the provider in use's live list once fetched, else its seed) (#1242).

LLM calls flow: `useChat` hook → `getApi().llmChatStream()` → IPC → main process → Anthropic SDK (with tools) or Vercel AI SDK (without), or for a Chat Completions provider `src/main/chatCompletions.ts` (tools or not). The adapter translates Prose's Anthropic-shaped messages and tools out and the SSE stream back into the same `llm:stream:*` events, so `useChat` never knows which API answered.

**Gating AI entry points:** any UI or background path that triggers an LLM call must gate on the single source of truth in `lib/llm.ts` — `isAIConfigured(settings)` / `aiAvailability(settings)` (consent **and** valid config), or the `useAIConfigured()` hook in components. Disable user-initiated controls with an explanation when unavailable, fire `notifyAINotConfigured()` for blocked actions whose surface may be hidden, and silently no-op auto-fired calls (e.g. summaries). Never destroy user content (comments, suggestions) on a blocked call.

Tool pipeline, stream lifecycle, and tool modes: see `docs/architecture/llm-pipeline.md`.

### Settings

Settings stored at `app.getPath('userData')/settings.json` (`~/Library/Application Support/Prose/` on macOS; `npm run dev` uses its own `Prose Dev/` profile, seeded once from `Prose/` — see `docs/troubleshooting.md`). All settings path resolution is centralized in `src/main/paths.ts`. Default settings defined in `src/main/ipc.ts`. The `Settings` type in `src/renderer/types/index.ts` is the source of truth for the settings shape.

Legacy `~/.prose/` data is migrated automatically on first launch via `src/main/migrate.ts` (settings and dictionary only; credentials require re-entry due to safeStorage identity differences).

### Theme

Dark mode by default. Theme controlled via `dark` class on `<html>` element.

### Tabs

Every way a document enters a tab, leaves it, or changes identity goes through one function in `src/renderer/tabs/actions.ts` (open, preview, new, switch, close, reopen, rename, convert, reload from disk, restore at launch, `setTabFrontmatter`, `markTabSaved`); `hooks/useTabs.ts` is a thin React binding over it and the chat tools (`select_tab`, `open_file`, `new_file`, `save_file`) call the same functions. The tab record (`tabStore`) is the truth for the document's body, frontmatter, dirty flag, preview / read-only flags and mode; the session layer keeps it current from its projections. Session persistence via IndexedDB — tabs survive app restart; only the active tab's session opens at launch, the others on first activation. Preview tabs (single-click in file explorer) are replaced by the next open; double-click, clicking into the editor or editing promotes to a permanent tab, which re-applies `editable = !isPreview && !readOnly`.

### Editor

The editor uses TipTap (ProseMirror-based) with markdown support via `tiptap-markdown`. There is one TipTap editor and one `EditorState` per open tab: `src/renderer/document/session.ts` holds the states (`openSession` parses, normalises and seeds a state from the tab's text and its IndexedDB records; `activateSession` swaps it into the view with `view.updateState`; `applyToSession` runs a transaction on a shown or a background state; `replaceSessionDocument` is the one whole-document replace, re-anchoring every record by text; `setSessionIdentity` restamps on rename / Save As; `saveSnapshot` is the one save path), the identity plugin (`document/identity.ts`) stamps each state with its document id, and `document/handle.ts` gives tool executors a `DocumentHandle` for a shown or a background document. Projections (500 ms after the last keystroke) write the tab record and the editor-store mirror; records persist from the state that produced them. The dirty flag follows every source-mode transaction at once, and a close or disk-reload decision lands the pending projection before it reads the record (`landProjections`, #885). Source mode keeps a CodeMirror state per session (`extensions/source/state.ts`). Key files:
- `src/renderer/document/session.ts` - The session layer (the only creator, swapper and persister of editor state)
- `src/renderer/components/editor/Editor.tsx` - The editor component (keyboard, popovers, dialogs, the source surface)
- `src/renderer/components/editor/extensions.ts` - The extension list (`createEditorExtensions`), shared with the vitest harness
- `src/renderer/extensions/` - Custom TipTap extensions (ai-annotations, comments, ai-suggestions, node-ids, source, etc.); records live in plugin state, read with `annotationsOf(state)`, `threadsOf(state)`, `getAISuggestions({ state })`, written through the extensions' commands or their `…To(tr, …)` helpers

### Document Review

AI-generated edits can be reviewed before accepting. Two modes:
- **Quick review** — inline diff with per-change accept/reject controls
- **Side-by-side** — full diff view with navigation

Comment threads have their own top-level review surface, **Comment Review**
(`CommentReviewPanel`) — a peer of Quick Review managed through the same
`reviewStore` mode slot (`reviewMode === 'comments'`), so the two are mutually
exclusive and toggle cleanly. Prev/next navigation wraps in all review panels.

Managed by `reviewStore` and components in `src/renderer/components/review/`.

### reMarkable Integration

Syncs handwritten notebooks **and typed-text documents** (Type Folio keyboard input) from reMarkable tablets. Located in `src/main/remarkable/`:
- `client.ts` - reMarkable cloud API client (uses `rmapi-js`)
- `sync.ts` - Notebook sync logic with parallel downloads (3 concurrent), incremental metadata saves, and structured `SyncProgressUpdate` progress events. `processNotebookContent` derives markdown per page: **typed text** locally, **handwriting** via OCR
- `ocr.ts` - Handwriting recognition via external OCR service (batch size 5, retry with exponential backoff)
- `rm-scene-parser.ts` - Zero-dependency parser for reMarkable's v6 `.rm` binary format; extracts typed text (`RootTextBlock`) and detects strokes. Ported from the MIT-licensed [`rmscene`](https://github.com/ricklupton/rmscene). Never throws — parse failures fall back to the OCR path

**Typed text vs. handwriting:** Typed docs are stored as `fileType === 'notebook'` (there is no separate "text" fileType) with digital text in the v6 `.rm` scene, so OCR renders them blank. `processNotebookContent` parses each page for typed text (no OCR/API key needed) and OCRs only stroke pages; typed text wins per page for mixed notebooks. The `extraction` metadata field (`typed-text` | `ocr` | `mixed`) records the source, and re-processing a legacy entry (no `extraction` field) once heals already-synced typed docs that had empty bodies.

**Sync progress push:** The `remarkable:sync` IPC handler pushes `SyncProgressUpdate` events via `event.sender.send('remarkable:sync:progress', ...)`. The preload exposes `onRemarkableSyncProgress(callback)` for the renderer to subscribe.

**OCR service:** Requires environment variables `REMARKABLE_OCR_URL` and `REMARKABLE_OCR_API_KEY` pointing to the Lambda endpoint. When absent, OCR silently skips — handwriting notebooks have no markdown text, but typed-text docs still sync (typed extraction is local and needs no OCR). Also requires an Anthropic API key (reused from LLM provider settings, or configured separately in Settings → Integrations).

### MCP Server

Prose is an MCP server for any client (Claude Desktop, Claude Code, Codex, Open WebUI, LibreChat). One server definition (`src/shared/mcp/server.ts`, on the v2 SDK `@modelcontextprotocol/server`) serves protocol revisions 2025-11-25 (the `initialize` handshake) and 2026-07-28 (`server/discover`, the per-request envelope), with client-neutral `instructions` (`src/shared/mcp/instructions.ts`). Two components:
- `src/main/mcp/` - Inside the Electron main process: the Streamable HTTP endpoint on loopback (`/mcp`; port 9877 for the installed app, 9878 unpackaged, `PROSE_MCP_PORT` overrides; Host and Origin checks, then a bearer token: a **connection's** token or the per-launch one in `<userData>/mcp-auth-token`), the Unix socket the stdio bridge uses, and the IPC bridge that relays tool calls to the renderer.
- **Connections** (#1236, `src/main/mcp/connections.ts`): one named, revocable token per client, created in Settings → Integrations → Connections, stored as a SHA-256 hash in `<userData>/mcp-connections.json` (0600); the token is shown once. **Main builds the actor** for every MCP call — the connection (HTTP), or the stdio client's `clientInfo` — and sends it beside the call (`mcp:tool:invoke`'s fourth argument); the renderer accepts it only through `mcpActorFrom` (`src/shared/mcp/actor.ts`) and never reads identity from tool arguments.
- `src/mcp-stdio/` - Standalone stdio server that clients launch. Relays to the socket of the profile it was installed into (`profile.ts`; `PROSE_USER_DATA_DIR` overrides); auto-launches only the installed app.
- **The remote relay, gateway side** (#1238; design `docs/architecture/mcp-relay.md`): ChatGPT and claude.ai reach Prose through the gateway, never the writer's machine. `gateway/src/auth/oauth.ts` makes the gateway an OAuth 2.1 authorization server (`@better-auth/oauth-provider` + `@better-auth/cimd` 1.7.18, pinned to its Better Auth) for one resource, `<gateway>/mcp` (`https://api.prose.solo.ist/mcp`): CIMD and open DCR (rate-limited per IP), PKCE S256, the `resource` parameter required, scopes `read` / `propose` / `comment` (+ `offline_access`), opaque access tokens (1 h) and rotating refresh tokens (30 d) stored hashed and checked on every call, so a revoke bites at once. `gateway/src/relay/`: discovery (`wellKnown.ts`), the email-code sign-in and consent pages (`pages.ts`), `POST /mcp` (`mcp.ts`: filters `tools/list` and refuses out-of-scope calls by `scopes.ts`, forwards in memory, "Prose is not running" with no desktop), `GET /relay` (`socket.ts` + `hub.ts`: the desktop's dial-out WebSocket, session cookie, no `Origin`, one per account + device), `POST /api/relay/revoke`, metadata-only logs (`log.ts`). Tested by `gateway/scripts/test-relay.mjs` (`npm run test:relay`).
- **The remote relay, desktop side** (#1239): **Remote access** (Settings → Integrations → Connections, `components/settings/RemoteAccess.tsx`), off by default, direct build only; it needs the gateway sign-in. On, main dials out (`src/main/mcp/relay.ts`, Node's WebSocket, `<gateway>/relay?device=<id>` with the origin-bound session cookie; pong, backoff, `{type:'active'}` on window focus; the gateway's `{type:'routing', active}` frames drive "Receiving remote calls" / "Another Mac is active"); off closes the socket at once, the kill switch. A pending client gets a toast with Review and a count in Settings, on the Integrations tab and on the Dock (direct build) until approved or declined. `IS_MAS_BUILD` never dials. The second gate is `src/main/mcp/relayCalls.ts`: a client the writer hasn't approved is recorded as pending in `<userData>/mcp-remote.json` (`remoteConnections.ts`, 0600) and refused; an approved one reaches only the tools both its token's scopes and the writer's approval allow (`src/shared/mcp/remoteScopes.ts`, kept identical to the gateway's table by a test), through `createProseMcpServer({ allowedTools })` behind `createMcpHandler`, with the actor `{ connectionId: 'remote:<client id>', connectionLabel: <the writer's label>, client: <registered name>, via: 'relay' }`. Deny and remove refuse at once, then revoke the client at the gateway (`POST /api/relay/revoke`). The renderer refuses any non-remote tool for a `via: 'relay'` actor. Remote clients never get `open_file`, `create_and_open_file` or `select_tab`. E2E: `e2e/electron.mcp-relay.spec.ts`, against a real local gateway (`PROSE_E2E_GATEWAY_DATABASE_URL`; CI's e2e job has a Postgres service).

Exposes 17 tools (the `mcpToolNames` subset in `src/shared/tools/registry.ts`): `read_document`, `get_outline`, `open_file`, `suggest_edit`, `create_and_open_file`, `list_comments`, `add_comment`, `resolve_comment`, `reply_to_comment`, `reopen_comment`, `list_tabs`, `select_tab`, and the review lifecycle (#890) `list_suggestions`, `reply_to_suggestion`, `revise_suggestion`, `get_review_status`, `list_review_events`. Accept and reject are never on the list: the writer decides (#607), and agents follow decisions through `list_review_events`. `revise_suggestion` replaces a pending suggestion (it becomes `superseded`) or follows one the writer rejected (#1266): a new pending suggestion on the same node, linked both ways, while the old one stays `rejected`; the node is the call's `nodeId`, else the one the log row recorded (`SuggestionHistory.nodeId`; node ids change when a document reopens), else the one node still holding the original text. An accepted suggestion can't be revised (`SUGGESTION_ACCEPTED`): the agent calls `suggest_edit` again. The document tools take an optional `document` (a documentId or path from `list_tabs`) that must name an open tab (#1237). MCP calls never move the writer's caret, focus or tab (tab-changing tools aside), and the renderer re-checks the allowlist the main-process bridge enforces. Every record an MCP call makes carries an `Actor` (`src/shared/review/actor.ts`, #1232), and the review log (`extensions/review-log/`, #1233) keeps each suggestion's history and the events. Their titles, annotations, output schemas and MCP-specific descriptions live in `src/shared/tools/mcpMetadata.ts`; results carry `structuredContent` beside the text. `zod` is a direct 3.x dependency on purpose: the app's tool schemas are zod 3, and the v2 SDK brings its own zod 4 (the migration is #1216).

### Shared Code

`src/shared/` contains code imported by both main and renderer processes:
- `tools/` - Tool registry, Zod schemas, type definitions, mode-based access control
- `llm/models.ts` - LLM model definitions
- `utils/retry.ts` - Retry with exponential backoff
### Sentry Error Tracking

Opt-in crash reporting via `@sentry/electron`. Users enable it in Settings > General > "Error Reporting".

- **Main process**: `src/main/sentry.ts` — `initSentry()` called synchronously at startup by reading settings (checks new userData path first, falls back to legacy `~/.prose/`). `setSentryEnabled()` handles runtime toggle via `sentry:setEnabled` IPC.
- **Renderer**: `src/renderer/lib/sentry.ts` — `initRendererSentry()` called from `settingsStore.loadSettings()`. Uses dynamic `import('@sentry/electron/renderer')` to keep the SDK off the critical render path (required for `sandbox: true` compatibility). `ErrorBoundary` wraps `<App />` in `main.tsx`.
- **DSN**: Injected at build time via `SENTRY_DSN` env var. Falls back to the project DSN if unset. Renderer uses `__SENTRY_DSN__` (Vite `define`); main process uses `process.env.SENTRY_DSN`.
- **Privacy**: Sentry never initializes unless `errorTracking.enabled === true` in settings. In dev mode, Sentry is initialized but disabled (`enabled: false`).
- **Source maps**: Uploaded automatically when `SENTRY_AUTH_TOKEN` is set during build (via `@sentry/vite-plugin`).

## Common Patterns

Step-by-step recipes for common extension tasks (settings tab, IPC channel, TipTap extension, panel, Zustand store, AI tool, session writer or projection): see `docs/patterns.md`.

## Security Rules

- **Path handling** — every filesystem IPC handler declares its **path source** in a comment (`// Path source: A|B|C …`, see `src/main/paths.ts`) and validates accordingly. **A (user-chosen: dialogs, explorer entries, the current tab, settings roots)** → `normalizePath()`. KNOW WHAT IT IS: a normalizer, NOT containment — `normalize()` resolves `..` before the traversal check, so `a/../../etc/x` passes clean. **B (content-derived: document text, image srcs, imported artifacts, `prose://` payloads, LLM/MCP tool arguments, sync metadata)** → `resolveWithin(root, path, …)` with an explicit containment root; it realpaths both sides and applies extension / hidden-folder rules (`file:readBase64` — audit H-03; tool paths use `resolveToolPath()`: text files under home or a user-chosen workspace root — default save directory, projects, favorites — never inside a hidden folder). **C (a user-chosen directory + a typed name)** → sanitize the name in the renderer with `sanitizeEntryName()` before joining. Never cite `normalizePath()` as a traversal defense. (#918)
- **API keys** — store via `credentialStore` (OS `safeStorage`), never in plaintext, and only from main: LLM keys go through `src/main/llmKeys.ts` and never cross to the renderer (#1240). If `safeStorage` is unavailable, a key is held in main's memory for the session and never written.
- **No `innerHTML` with dynamic data** — use JSX or `textContent`. LLM-generated content must never be inserted as raw HTML.
- **Sandbox settings** — `contextIsolation: true`, `nodeIntegration: false` — never change these.
- **External URLs** — `shell.openExternal` only allows `http:` and `https:` protocols. All others are silently dropped.
- **CORS** — MCP HTTP server only reflects `localhost`/`127.0.0.1` origins. No wildcard `Access-Control-Allow-Origin`.
- **DevTools** — stripped from production View menu. Set `PROSE_DEBUG=1` env var to re-enable for debugging.
- **Privacy manifest** — `resources/PrivacyInfo.xcprivacy` declares required-reason API usage for Apple. Update when adding new system APIs.
- **MAS sandbox** — MCP install/uninstall/status handlers and Remote access (`mcp:remote:*`; the relay never dials out) are blocked via `IS_MAS_BUILD`. Settings path uses `app.getPath('userData')` (sandbox-safe). Never use `homedir()` + `.prose` for new data paths.
- **App Store submission** — NEVER submit builds for App Store review. Upload to App Store Connect / TestFlight is the automation boundary. Submission for review is always a human decision and action.

## Sentry Debugging

Prose uses opt-in Sentry error tracking. When investigating production errors, use the Sentry CLI (`npx sentry`) — not MCP.

**Playbook:**
```bash
npx sentry issue list                  # List recent unresolved issues
npx sentry issue list --json | jq      # Machine-readable output
npx sentry issue explain PROSE-<id>    # Seer AI root cause analysis (takes ~1 min)
npx sentry issue plan PROSE-<id>       # Generate a fix plan
```

**First-time setup:** `npx sentry auth login` (browser OAuth, stores token locally).

**Workflow:** `issue list` → `issue explain <id>` → fix in code → verify. Seer provides reproduction steps, suspect lines, and scoping analysis — treat it as a strong lead, not gospel. Always cross-reference against the actual source before committing a fix.

## Troubleshooting

Common failure recovery (port conflicts, LevelDB locks, build failures, API errors, Circuit Electron, tool execution errors): see `docs/troubleshooting.md`.

## UI Conventions

- **Component library**: Use shadcn/ui components. Don't introduce other UI libraries.
- **Animations**: Keep minimal. Use only what shadcn/ui and tailwindcss-animate provide out of the box.
- **Fonts**: IBM Plex Mono for all text (UI and editor) by default. Users can change fonts in Settings → Editor.

## Session Management

When the user signals they want to stop working (e.g., "let's take a break", "let's stop for now", "I'm done for now"), automatically provide:

1. A brief 1-2 sentence summary of what we were working on (to make resuming easy)
2. The current date and time

This can also be invoked manually with `/break`.
