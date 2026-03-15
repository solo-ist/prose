# Contributing to Prose

Thanks for your interest in contributing! Please open an issue first to discuss what you'd like to change.

## Setup

```bash
git clone https://github.com/solo-ist/prose.git
cd prose
npm install
npm run dev
```

Requires Node.js 20+ and npm 10+.

## Development

- `npm run dev` — Start Electron + Vite with HMR (debuggable on port 9222)
- `npm run build` — Build for production (unpacked)
- `npm run build:mac` — Build macOS distributable (.app + .dmg)

## Project Structure

```
src/
  main/           # Electron main process (Node.js)
  preload/        # Context bridge (ElectronAPI)
  renderer/       # React app (no Node.js access)
  shared/         # Code shared between main + renderer
  mcp-stdio/      # Standalone MCP server for Claude Desktop
e2e/              # Playwright end-to-end tests
```

## Making Changes

1. Create an issue describing the change
2. Create a branch: `git checkout -b issue-<number>-<description>`
3. Make your changes
4. Run `npm run build` to verify compilation
5. Open a PR referencing the issue

## Commit Format

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(editor): add table support
fix(api): handle null response from provider
docs: update architecture section
```

## Code Style

- **UI components**: shadcn/ui only — don't introduce other UI libraries
- **State management**: Zustand with `subscribeWithSelector` middleware
- **Platform abstraction**: Use `getApi()` from `src/renderer/lib/browserApi.ts`, never `window.api` directly
- **Fonts**: IBM Plex Mono for all text by default

## Architecture

See [CLAUDE.md](CLAUDE.md) for detailed architecture documentation, including IPC channels, state management, and security rules.
