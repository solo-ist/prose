# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start development (Electron + Vite HMR, debuggable on port 9222)
npm run build        # Build for production (unpacked)
npm run build:mac    # Build macOS distributable (.app + .dmg)
npm run build:win    # Build Windows distributable
npm run build:linux  # Build Linux distributable
```

**Note**: Always run these commands for the user rather than asking them to run manually. Start dev servers in the background so work can continue.

**No tests**: This project has no test suite. QA is done via Circuit Electron (see below).

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

## QA Testing

The app supports automated QA testing via Circuit Electron MCP (configured at parent level).

### Workflow

Circuit Electron launches its own Electron instance, which bypasses electron-vite's dev server. For reliable testing:

1. **Build first**: Run `npm run build` to create fresh `out/` files
2. **Launch with Circuit Electron**: Use development mode to launch from project directory
3. **Test the feature**: Interact with the app using Circuit Electron tools

### Dev Server PID Protocol

The dev server writes its PID to `.dev.pid` on startup. **Always use this file** for process management—never use pattern matching like `pgrep -f "prose.*Electron"` which may match stale instances from other sessions.

```bash
# Check if running (ALWAYS do this first)
cat .dev.pid 2>/dev/null && ps -p $(cat .dev.pid) -o pid= >/dev/null 2>&1 && echo "Running" || echo "Not running"

# Kill only THIS project's dev server
kill $(cat .dev.pid) 2>/dev/null || true

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

- **Track work in GitHub Issues**: Create issues before starting work.
- **Branching**: Create a branch per issue using format `issue-<number>-<short-description>` (e.g., `issue-42-fix-login-bug`). Branch from `main`.
- **Commits**: Reference issue numbers in commits (e.g., `Fix login validation (#42)`).
- **Pull requests**: One PR per issue. Merge to `main` after code review.
- **Issue documentation**: For complex issues, create a folder in `docs/issues/<number>/`. See `docs/issues/README.md` for details.

## Architecture

### Cross-Platform Design

The app is designed to run both as an Electron desktop app and as a standalone web app. All platform-specific code is abstracted behind the `ElectronAPI` interface:

- **Electron**: Uses IPC to call main process for file dialogs, settings persistence (`~/.prose/settings.json`), and LLM API calls
- **Web**: Uses File System Access API (with `<input>` fallback), localStorage for settings, and direct API calls (limited by CORS—only OpenRouter and Ollama work in browser)

Always use `getApi()` from `src/renderer/lib/browserApi.ts` instead of accessing `window.api` directly. This returns the Electron API when available, or a browser-compatible fallback.

### Electron Process Model

When running as Electron:

1. **Main Process** (`src/main/`): Node.js environment handling window management, native file dialogs, and LLM API calls. LLM calls run here to avoid CORS issues.

2. **Preload** (`src/preload/index.ts`): Context bridge exposing `ElectronAPI` to the renderer via `window.api`.

3. **Renderer** (`src/renderer/`): React app with no direct Node.js access.

### IPC Channels

Defined in `src/main/ipc.ts`:
- `file:*` - File operations (open, save, saveAs, read, rename, delete)
- `settings:load`, `settings:save` - Settings persistence (`~/.prose/settings.json`)
- `llm:chat`, `llm:chatStream`, `llm:abortStream` - LLM API calls (Vercel AI SDK)
- `remarkable:*` - reMarkable tablet sync (register, validate, sync, etc.)

### State Management

Zustand stores in `src/renderer/stores/`:
- `editorStore` - Document content, path, dirty state
- `editorInstanceStore` - TipTap editor instance reference
- `chatStore` - Chat messages, loading state, panel visibility
- `settingsStore` - App settings (theme, LLM config, editor preferences)
- `fileListStore` - File explorer state and directory listing

### IndexedDB Schema Changes

Client-side persistence uses IndexedDB (`src/renderer/lib/persistence.ts`). When modifying the schema:

- **Always bump `DB_VERSION`** when adding/removing object stores. The `onupgradeneeded` callback only runs when the version increases—reopening at the same version won't create missing stores.
- **Upgrades can be blocked** if the database is open in another tab. The upgrade waits until all connections close, but users may not notice. New stores may silently fail to create.
- **Test fresh installs and upgrades** separately. A fresh install always gets the latest schema, but existing users need the migration path.

### LLM Integration

LLM calls flow: `useChat` hook → `window.api.llmChat()` → IPC → main process → Vercel AI SDK

The main process (`src/main/ipc.ts`) handles all provider switching (Anthropic, OpenAI, OpenRouter, Ollama) using the Vercel AI SDK's provider-specific packages.

### Settings

Settings stored at `~/.prose/settings.json`. Default settings defined in `src/main/ipc.ts`. The `Settings` type in `src/renderer/types/index.ts` is the source of truth for the settings shape.

### Theme

Dark mode by default. Theme controlled via `dark` class on `<html>` element.

### Editor

The editor uses TipTap (ProseMirror-based) with markdown support via `tiptap-markdown`. Key files:
- `src/renderer/components/editor/Editor.tsx` - Main editor component
- `src/renderer/components/editor/extensions/` - Custom TipTap extensions

### reMarkable Integration

Syncs handwritten notebooks from reMarkable tablets. Located in `src/main/remarkable/`:
- `client.ts` - reMarkable cloud API client (uses `rmapi-js`)
- `sync.ts` - Notebook sync logic, downloads to `~/.prose/remarkable/`
- `ocr.ts` - Handwriting recognition via external OCR service

OCR requires an Anthropic API key. If using Anthropic as the LLM provider, that key is reused; otherwise users can configure a separate key in Settings → Integrations.

## UI Conventions

- **Component library**: Use shadcn/ui components. Don't introduce other UI libraries.
- **Animations**: Keep minimal. Use only what shadcn/ui and tailwindcss-animate provide out of the box.
- **Fonts**: IBM Plex Mono for all text (UI and editor) by default. Users can change fonts in Settings → Editor.

## Session Management

When the user signals they want to stop working (e.g., "let's take a break", "let's stop for now", "I'm done for now"), automatically provide:

1. A brief 1-2 sentence summary of what we were working on (to make resuming easy)
2. The current date and time

This can also be invoked manually with `/break`.
