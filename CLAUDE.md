# Prose

A minimal markdown editor with AI chat, built with Electron + React + TypeScript.

## Tech Stack

- **Build**: electron-vite
- **Frontend**: React 18, TypeScript
- **State**: Zustand
- **UI**: shadcn/ui (Radix primitives), Tailwind CSS
- **Editor**: TipTap (placeholder, not yet implemented)
- **Markdown**: gray-matter for frontmatter parsing

## Project Structure

```
src/
├── main/           # Electron main process
│   ├── index.ts    # Window creation, app lifecycle
│   ├── ipc.ts      # IPC handlers (file ops, settings)
│   └── menu.ts     # Application menu
├── preload/        # Context bridge
│   └── index.ts    # Exposes typed API to renderer
└── renderer/       # React app
    ├── components/
    │   ├── chat/       # ChatPanel, ChatInput, ChatMessage
    │   ├── editor/     # Editor (placeholder)
    │   ├── layout/     # App, Toolbar, StatusBar
    │   ├── settings/   # SettingsDialog
    │   └── ui/         # shadcn components
    ├── hooks/          # useChat, useEditor, useSettings
    ├── stores/         # Zustand stores
    ├── lib/            # Utilities (markdown, llm, utils)
    └── types/          # TypeScript interfaces
```

## Commands

```bash
npm run dev      # Start development (Electron + Vite HMR)
npm run build    # Build for production
```

## Key Patterns

- **IPC**: All file/settings operations go through `window.api` (exposed via preload)
- **Guards**: Renderer code guards `window.api` calls for browser-only dev
- **Theme**: Dark by default, controlled via `dark` class on `<html>`
- **Settings**: Stored in `~/.prose/settings.json`

## LLM Configuration

Supports multiple providers (configured in Settings):
- Anthropic (Claude)
- OpenAI
- OpenRouter
- Ollama (local)

API keys stored in settings file (not version controlled).
