# AGENTS.md

Shared instructions for OpenAI Codex and other non-Claude agents working in this repository.

Claude-specific automation, slash commands, and skills live in `CLAUDE.md` and `.claude/`. When those files contain project architecture or workflow details that are not repeated here, treat them as additional repository guidance unless they conflict with higher-priority instructions from the user, system, or developer.

## Agent Profile

Use the **Trusted Coding** profile (`hz8WBqkgRrbiraXS9b32Sx`) when working in this repo.
Use the **Review / Untrusted** profile (`2GV3WctmZUInztOStkCUMe`) for read-only review passes.

CLI shortcuts (defined in `~/.zshrc`):
```sh
oz-trusted --prompt "..."
oz-review  --prompt "..."
```

## Instruction Precedence

1. Follow system, developer, and direct user instructions first.
2. Follow this file for cross-agent repository behavior.
3. Follow `CLAUDE.md` for project architecture, Claude-specific workflows, and established local conventions.
4. Follow more specific docs under `docs/` when working in a feature area they cover.

If instructions conflict, choose the higher-priority source and mention the conflict in your handoff or PR.

## Multi-Agent Coordination

- Assume Claude and OpenAI agents may work in this repo at the same time.
- Before editing, check `git status --short --branch` and avoid overwriting unrelated changes.
- Do not revert user or other-agent changes unless explicitly asked.
- Keep edits scoped to the task. Avoid opportunistic refactors.
- Prefer separate branches or git worktrees for independent tasks.
- Before comparing branches or opening PRs, run `git fetch origin` because another agent may have pushed recently.
- Use `gh` CLI for GitHub operations. Avoid interactive commands; pass flags explicitly.
- If you start a long-running process, make it clear how it is managed and do not leave required verification processes running unintentionally.

## Project Snapshot

Prose is an Electron desktop app with a React/TypeScript renderer and a shared code layer for main, preload, renderer, and MCP behavior.

Key areas:

- `src/main/` - Electron main process, IPC, settings, integrations, updater, Sentry, MCP bridge.
- `src/preload/` - Context bridge for renderer-safe APIs.
- `src/renderer/` - React app, TipTap editor, Zustand stores, UI components. Chat tool-result renderers live in `src/renderer/components/chat/toolResultRenderers/` (e.g. `ListFilesResult.tsx`).
- `src/shared/` - Shared schemas, tools, LLM utilities, and cross-process types.
- `src/mcp-stdio/` - Stdio MCP server used by Claude Desktop.
- `docs/` - Architecture notes, patterns, issue plans, troubleshooting, release docs, and `docs/roadmap.md` (the canonical roadmap + operating model).
- `.claude/` - Claude Code settings, hooks, and skills. Do not treat these as Codex configuration.

## Roadmap & Planning

Before any planning, prioritization, sequencing, or parallelization work — including "what to work on next," scoping a wave or epic, or splitting work across agents — read [`docs/roadmap.md`](docs/roadmap.md) first. It is the canonical, resumable source for what is being built, in what order (the wave model), and how work is parallelized (three concurrent Wave 1 tracks on an A→B→C merge ladder). The strategy already exists there; build on it rather than reinventing it. Project board #5 is the live queue; the roadmap is the narrative and operating model. It changes frequently, so read the current version — if your branch may be behind `main`, run `git fetch origin` and read `git show origin/main:docs/roadmap.md` rather than a possibly-stale worktree copy. Branch new worktrees off freshly-fetched `origin/main`.

## Commands

Use the repo's npm scripts instead of ad hoc command lines:

```bash
npm run dev              # Electron + Vite development server
npm run build            # Production build to out/
npm run build:web        # Web build
npm run test:e2e         # Build and run Electron Playwright tests
npm run test:web         # Build and run web Playwright tests
npm run typecheck:e2e    # Type-check E2E tests
```

There is no unit test suite. Choose the smallest verification that covers the change:

- Docs-only changes: no build required unless touching generated docs or examples that must compile.
- Renderer/main/preload/shared TypeScript changes: run `npm run build`.
- Web-specific changes: run `npm run build:web` or `npm run test:web` when behavior changed.
- Electron user flows: run `npm run test:e2e` when practical, otherwise build and document manual verification.
- E2E test changes: run `npm run typecheck:e2e` and the relevant Playwright command.

**Cloud sandbox note:** If `npm run build` fails at the `build:skill` step (requires `zip`), fall back to
`npx electron-vite build` — it validates renderer/main/preload TypeScript. Do **not** use
`npx tsc -p tsconfig.json --noEmit`; it produces spurious project-reference errors (`TS6305`/`TS6306`) that
are not real type errors in this multi-tsconfig project.

## Dev Server Safety

The Electron dev server writes `.dev.pid`. Prefer the PID file for this repo's process cleanup.

```bash
cat .dev.pid 2>/dev/null
ps -p <PID> -o pid=
kill <PID>
```

Avoid broad process kills such as `pkill -f node` or `pkill -f Electron`; they can terminate another agent's session or MCP tools. If the PID file is missing, inspect processes carefully before killing anything.

## Coding Conventions

- Keep platform-specific behavior behind `getApi()` from `src/renderer/lib/browserApi.ts`; do not access `window.api` directly from renderer code.
- Store settings through the existing settings paths and types. Do not introduce new `homedir()` + `.prose` paths for app data.
- Preserve Electron sandbox settings: `contextIsolation: true` and `nodeIntegration: false`.
- Validate filesystem IPC paths with the existing `validatePath()` pattern.
- Store credentials through the OS-backed credential store; never commit plaintext secrets.
- Do not use `innerHTML` with dynamic or LLM-provided content.
- Gate unfinished features with `src/renderer/lib/featureFlags.ts`; do not delete dormant feature code just to hide it.
- When changing IndexedDB stores in `src/renderer/lib/persistence.ts`, bump `DB_VERSION` and consider fresh-install and upgrade paths.
- Use shadcn/ui, Tailwind, and existing component patterns. Do not add a new UI library without a strong reason.
- Keep animations minimal and consistent with the existing app.

## Documentation And Handoffs

- For complex issue work, create or update `docs/issues/<number>/plan.md`.
- When adding architecture or workflow knowledge useful to future agents, update `docs/` or this file instead of burying it in a PR comment.
- In final handoffs, include what changed, what was verified, and any residual risk.
- If you could not run a relevant check, state why.

## PR Expectations

- Work on a branch, not `main`.
- Keep one logical task per PR.
- Commit messages should reference the issue number when one exists.
- Include concise PR bodies with verification performed.
- Before merging or declaring a PR ready, check unresolved review comments when applicable.
