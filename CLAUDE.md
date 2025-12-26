# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start development (Electron + Vite HMR)
npm run build        # Build for production
npm run build:mac    # Build macOS distributable
npm run build:win    # Build Windows distributable
npm run build:linux  # Build Linux distributable
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
- `file:open`, `file:save`, `file:saveAs`, `file:read` - File operations
- `settings:load`, `settings:save` - Settings persistence
- `llm:chat` - LLM API calls (Vercel AI SDK)

### State Management

Zustand stores in `src/renderer/stores/`:
- `editorStore` - Document content, path, dirty state
- `chatStore` - Chat messages, loading state, panel visibility
- `settingsStore` - App settings (theme, LLM config, editor preferences)

### LLM Integration

LLM calls flow: `useChat` hook → `window.api.llmChat()` → IPC → main process → Vercel AI SDK

The main process (`src/main/ipc.ts`) handles all provider switching (Anthropic, OpenAI, OpenRouter, Ollama) using the Vercel AI SDK's provider-specific packages.

### Settings

Settings stored at `~/.prose/settings.json`. Default settings defined in `src/main/ipc.ts`. The `Settings` type in `src/renderer/types/index.ts` is the source of truth for the settings shape.

### Theme

Dark mode by default. Theme controlled via `dark` class on `<html>` element.

## UI Conventions

- **Component library**: Use shadcn/ui components. Don't introduce other UI libraries.
- **Animations**: Keep minimal. Use only what shadcn/ui and tailwindcss-animate provide out of the box.
- **Fonts**: Source Code Pro for all text (UI and editor).
