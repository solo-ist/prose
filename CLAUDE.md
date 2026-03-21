# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Environment

This project uses an **agentic, multi-agent development workflow**:

- **Multiple Claude Code agents** may run simultaneously on the same machine — across terminal sessions, git worktrees, different branches, or different repos. Never assume you're the only agent running.
- **Prefer Agent Teams and git worktrees** for parallelizing independent work. Use `isolation: "worktree"` when spawning agents that need to make changes without conflicting with the main working tree. This avoids branch conflicts and lets multiple agents write code simultaneously.
- **Worktree git commands**: Always use `git -C <worktree-path> <subcommand>` instead of `cd <path> && git <subcommand>`. Single commands match the `Bash(git:*)` allowlist; compound `cd && git` chains get flagged for manual approval, which blocks unattended agents.
- **Cloud agents** (via GitHub Actions) handle PR reviews, automated fixes, and pipeline triage. Local agents handle implementation, QA, and complex features.
- **The CI pipeline is self-enhancing** — automated review (`claude.yml`), scoring (`pipeline-triage.yml`), and auto-fix (`ci-gate.yml`) run on every PR. Skills and workflows evolve alongside the codebase.
- **Be mindful of concurrent sessions.** Other terminal sessions or worktree agents may be running builds, dev servers, or tests at the same time. Check for port conflicts before starting servers. Use PID files (not `pkill` patterns) for process management. Use `gh` CLI (not GitHub MCP) for all GitHub operations. Always `git fetch origin` before comparing branches — another session may have pushed.
- **The project board** (GitHub Projects #5) tracks priority and in-progress work. Move items to "In Progress" when starting, back to "Do First" if pausing. Never mutate board field definitions — only move items between existing columns.

## Commands

```bash
npm run dev          # Start development (Electron + Vite HMR, debuggable on port 9222)
npm run build        # Build for production (unpacked)
npm run build:mac    # Build macOS distributable (.app + .dmg)
npm run build:mas    # Build Mac App Store package (MAS_BUILD=1)
npm run build:win    # Build Windows distributable
npm run build:linux  # Build Linux distributable
```

**Note**: Always run these commands for the user rather than asking them to run manually. Start dev servers in the background so work can continue.

**Testing**: No unit test suite. E2E tests via Playwright (`e2e/`, `playwright.config.ts`). Manual QA via Circuit Electron (see below).

## Before Implementation

Before writing any code, complete this checklist:

1. **Branch**: Create or switch to issue branch: `git checkout -b issue-<number>-<description>`
2. **Docs**: For complex issues, create `docs/issues/<number>/plan.md`
3. **Verify**: Run `git branch --show-current` to confirm you're not on `main`

## Before Presenting Work for Review

Before presenting completed work for user review, ensure a clean environment:

1. **Kill this project's dev server**: Use PID file for safe cleanup (see below)
2. **Start fresh dev server**: Run `npm run dev` in the background
3. **Verify no errors**: Check dev server output for compilation errors before announcing completion

This prevents LevelDB lock conflicts and ensures the user sees the latest changes.

### Verification Instructions

Always include human-readable verification steps when presenting completed work. These should let the user independently confirm the changes work. Format as numbered steps with exact commands to run and what to look for in the output. Prefer verification against the locally running dev server; only use `npm run build:mac` + the built app when the change specifically requires a production build to verify.

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
```

If the PID file is missing but Electron processes exist, they're likely stale from a crashed session. Kill them before starting fresh.

### Multi-Agent Awareness

Multiple Claude Code agents may run simultaneously on this machine, potentially working on different Electron apps with similar signatures. This causes:

- **Port conflicts**: Default ports (5173, 9222) may already be in use
- **Process confusion**: Broad `pkill` patterns kill another agent's processes
- **Session conflicts**: Circuit Electron sessions may collide

**Always prefer the PID file method** for cleanup. When encountering "address already in use" errors, check if another agent is active before assuming a bug. Vite automatically finds alternative ports, but DevTools debugging port (9222) conflicts will cause launch failures.

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

When a PR is opened, Claude auto-reviews it (via `claude.yml`). A second workflow (`review-feedback.yml`) auto-analyzes that review:

1. **Detection**: Triggers on `issue_comment` from `claude[bot]` containing `## Code Review`
2. **Analysis**: Calls Claude Sonnet API to categorize feedback (Blocking / Functional / Quality / Nitpicks / Questions)
3. **Output**: Posts structured triage comment with severity, effort, and MERGE / FIX REQUIRED / NEEDS DISCUSSION recommendation
4. **Loop prevention**: Analysis comments include a `<!-- review-feedback-analysis -->` sentinel excluded from detection

**On-demand review**: Comment `/review` on a PR to trigger a fresh code review. Use this after pushing meaningful changes to an existing PR. The auto-review only fires on PR open — subsequent pushes require an explicit `/review` comment.

**Manual trigger**: Run `workflow_dispatch` on `review-feedback.yml` with a PR number to re-analyze any PR.

**Local deep-dive**: For code-level validation of review concerns, use `/review-feedback <pr-number>` locally. The cloud version is a quick triage; the local skill reads actual source files.

### CI/CD Workflows

All workflows in `.github/workflows/`:
- `claude.yml` - Auto-review on PR open + `@claude` mention handler
- `review-feedback.yml` - Analyzes claude[bot] review comments, posts structured triage
- `e2e.yml` - Electron Playwright tests on every PR (or `/test` comment)
- `web-e2e.yml` - Browser Playwright tests for `accelerated`-labeled or bot PRs
- `pipeline-triage.yml` - Scores review findings, routes to auto-fix or human review
- `pipeline-fix.yml` - Claude agent auto-fixes simple review findings
- `dispatch.yml` - Routes `/triage`, `/fix`, `/pipeline` slash commands to downstream workflows
- `feature-request-triage.yml` - Adds `feature-request`-labeled issues to project board
- `release.yml` - Builds and publishes macOS distributable to GitHub Releases on version tag push (`v*`)

## Architecture

### Cross-Platform Design

The app is designed to run both as an Electron desktop app and as a standalone web app. All platform-specific code is abstracted behind the `ElectronAPI` interface:

- **Electron**: Uses IPC to call main process for file dialogs, settings persistence (`~/.prose/settings.json`), and LLM API calls
- **Web**: Uses File System Access API (with `<input>` fallback), localStorage for settings, and direct API calls (limited by CORS — Anthropic blocks browser requests, so web mode LLM features are unavailable)

Always use `getApi()` from `src/renderer/lib/browserApi.ts` instead of accessing `window.api` directly. This returns the Electron API when available, or a browser-compatible fallback.

### Electron Process Model

When running as Electron:

1. **Main Process** (`src/main/`): Node.js environment handling window management, native file dialogs, and LLM API calls. LLM calls run here to avoid CORS issues.

2. **Preload** (`src/preload/index.ts`): Context bridge exposing `ElectronAPI` to the renderer via `window.api`.

3. **Renderer** (`src/renderer/`): React app with no direct Node.js access.

### IPC Channels

Defined in `src/main/ipc.ts` (64 handlers across 11 namespaces):
- `file:*` (17) - File operations (open, save, read, rename, delete, trash, duplicate, etc.)
- `settings:*` (4) - Settings persistence, secure storage check, API key test
- `llm:chat`, `llm:stream`, `llm:stream:abort` - LLM API calls (streaming via Anthropic SDK)
- `remarkable:*` (14) - reMarkable tablet sync (register, validate, sync, OCR, etc.)
- `google:*` (13) - Google Docs OAuth, sync, pull, import, metadata management
- `mcp:*` (3) - MCP server status, install, uninstall for Claude Desktop
- `sentry:setEnabled` - Toggle Sentry error tracking from renderer
- `window:*`, `shell:*`, `recentFiles:*`, `emoji:*`, `fileAssociation:*` - Utility handlers

### State Management

Zustand stores in `src/renderer/stores/`:
- `tabStore` - Multi-tab session lifecycle, persistence to IndexedDB
- `editorStore` - Document content, path, dirty state
- `editorInstanceStore` - TipTap editor instance reference
- `chatStore` - Chat messages, conversations, streaming state, panel visibility
- `settingsStore` - App settings (theme, LLM config, editor preferences)
- `fileListStore` - File explorer state and directory listing
- `reviewStore` - AI review mode (quick/side-by-side), suggestion navigation
- `summaryStore` - AI-generated document summaries, staleness tracking
- `commandHistoryStore` - Per-tool argument history, persisted to IndexedDB
- `linkHoverStore` - Currently hovered link URL for tooltip

### Feature Flags

`src/renderer/lib/featureFlags.ts` gates features that aren't ready for public release. Flags are persisted in `~/.prose/settings.json` under the `featureFlags` key and default to `false`.

To enable a feature without rebuilding, add to `~/.prose/settings.json`:
```json
"featureFlags": { "googleDocs": true, "remarkable": true }
```

Current flags:
- `googleDocs` — Google Docs bidirectional sync (v1.1)
- `remarkable` — reMarkable tablet sync (v1.1)

The module exports React hooks (`useGoogleDocsEnabled`, `useRemarkableEnabled`) for use in components and non-hook accessors (`isGoogleDocsEnabled`, `isRemarkableEnabled`) for use in callbacks. When gating a feature, import the appropriate function and use it to guard UI rendering, background effects, and menu handlers. Preserve all code — gate, don't delete.

### IndexedDB Schema Changes

Client-side persistence uses IndexedDB (`src/renderer/lib/persistence.ts`). When modifying the schema:

- **Always bump `DB_VERSION`** when adding/removing object stores. The `onupgradeneeded` callback only runs when the version increases—reopening at the same version won't create missing stores.
- **Upgrades can be blocked** if the database is open in another tab. The upgrade waits until all connections close, but users may not notice. New stores may silently fail to create.
- **Test fresh installs and upgrades** separately. A fresh install always gets the latest schema, but existing users need the migration path.

### LLM Integration

**Anthropic is the only provider.** All legacy multi-provider code (OpenAI, OpenRouter, Ollama) has been removed. The `Settings` type defines `provider: 'anthropic'` only.

LLM calls flow: `useChat` hook → `getApi().llmChatStream()` → IPC → main process → Anthropic SDK (with tools) or Vercel AI SDK (without)

Tool pipeline, stream lifecycle, and tool modes: see `docs/architecture/llm-pipeline.md`.

### Settings

Settings stored at `~/.prose/settings.json`. Default settings defined in `src/main/ipc.ts`. The `Settings` type in `src/renderer/types/index.ts` is the source of truth for the settings shape.

### Theme

Dark mode by default. Theme controlled via `dark` class on `<html>` element.

### Tabs

Multi-tab interface managed by `tabStore`. Each tab tracks its document path, content, dirty state, and emoji. Session persistence via IndexedDB — tabs survive app restart. Preview tabs (single-click in file explorer) are replaced by the next open; double-click or editing promotes to a permanent tab.

### Editor

The editor uses TipTap (ProseMirror-based) with markdown support via `tiptap-markdown`. Key files:
- `src/renderer/components/editor/Editor.tsx` - Main editor component
- `src/renderer/extensions/` - Custom TipTap extensions (ai-suggestions, diff-suggestions, node-ids, etc.)

### Document Review

AI-generated edits can be reviewed before accepting. Two modes:
- **Quick review** — inline diff with per-change accept/reject controls
- **Side-by-side** — full diff view with navigation

Managed by `reviewStore` and components in `src/renderer/components/review/`.

### reMarkable Integration

Syncs handwritten notebooks from reMarkable tablets. Located in `src/main/remarkable/`:
- `client.ts` - reMarkable cloud API client (uses `rmapi-js`)
- `sync.ts` - Notebook sync logic, downloads to `~/.prose/remarkable/`
- `ocr.ts` - Handwriting recognition via external OCR service

OCR requires an Anthropic API key. If using Anthropic as the LLM provider, that key is reused; otherwise users can configure a separate key in Settings → Integrations.

### Google Docs Integration

Bidirectional sync with Google Docs. Located in `src/main/google/`:
- `auth.ts` - OAuth2 flow with local redirect server, tokens stored via `safeStorage`
- `client.ts` - Google Drive/Docs API client (create, update, import, markdown ↔ HTML conversion)
- `sync.ts` - Sync logic, folder management (`~/Documents/Google Docs/`), metadata tracking (`.google/sync-metadata.json`)

### MCP Server

Prose exposes itself as an MCP server to Claude Desktop via two components:
- `src/main/mcp/` - Socket server + HTTP bridge inside the Electron main process. Relays tool calls to the renderer via IPC.
- `src/mcp-stdio/` - Standalone stdio server that Claude Desktop launches. Connects to the running app via Unix socket; auto-launches Prose if not running.

Exposes 5 tools: `read_document`, `get_outline`, `open_file`, `suggest_edit`, `create_and_open_file`.

### Shared Code

`src/shared/` contains code imported by both main and renderer processes:
- `tools/` - Tool registry, Zod schemas, type definitions, mode-based access control
- `llm/models.ts` - LLM model definitions
- `utils/retry.ts` - Retry with exponential backoff
### Sentry Error Tracking

Opt-in crash reporting via `@sentry/electron`. Users enable it in Settings > General > "Error Reporting".

- **Main process**: `src/main/sentry.ts` — `initSentry()` called synchronously at startup by reading `~/.prose/settings.json`. `setSentryEnabled()` handles runtime toggle via `sentry:setEnabled` IPC.
- **Renderer**: `src/renderer/lib/sentry.ts` — `initRendererSentry()` called from `settingsStore.loadSettings()`. Uses dynamic `import('@sentry/electron/renderer')` to keep the SDK off the critical render path (required for `sandbox: true` compatibility). `ErrorBoundary` wraps `<App />` in `main.tsx`.
- **DSN**: Hardcoded in `src/renderer/lib/sentry.ts` and `src/main/sentry.ts`.
- **Privacy**: Sentry never initializes unless `errorTracking.enabled === true` in settings. In dev mode, Sentry is initialized but disabled (`enabled: false`).
- **Source maps**: Uploaded automatically when `SENTRY_AUTH_TOKEN` is set during build (via `@sentry/vite-plugin`).

## Common Patterns

Step-by-step recipes for common extension tasks (settings tab, IPC channel, TipTap extension, panel, Zustand store, AI tool): see `docs/patterns.md`.

## Security Rules

- **Path validation** — every filesystem IPC handler must call `validatePath()` (`src/main/ipc.ts`). Rejects paths containing `..` after normalization.
- **API keys** — store via `credentialStore` (OS `safeStorage`), never in plaintext. If `safeStorage` is unavailable, keys are stripped, not saved.
- **No `innerHTML` with dynamic data** — use JSX or `textContent`. LLM-generated content must never be inserted as raw HTML.
- **Sandbox settings** — `contextIsolation: true`, `nodeIntegration: false` — never change these.
- **External URLs** — `shell.openExternal` only allows `http:` and `https:` protocols. All others are silently dropped.
- **CORS** — MCP HTTP server only reflects `localhost`/`127.0.0.1` origins. No wildcard `Access-Control-Allow-Origin`.

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
