# Prose Roadmap

*Last updated: December 2024*

## Current State

Prose is a cross-platform writing app with integrated AI chat, built on Electron + React + TipTap.

### Completed Features
- TipTap markdown editor with focus mode, find bar, links
- Multi-provider LLM chat (Anthropic, OpenAI, OpenRouter, Ollama)
- File operations (new, open, save, save as) with frontmatter support
- Chat persistence per document with conversation history
- Draft auto-recovery
- Comprehensive keyboard shortcuts
- Settings (theme, editor, LLM config)
- Cross-platform support (Electron + web fallback)

### Open Issues
- #15 - Fix double response UI in chat

---

## MVP Roadmap

### Phase 1: Core Fixes
High priority bug fixes and UX improvements.

| Task | Issue | Priority | Status |
|------|-------|----------|--------|
| Fix double response UI in chat | [#15](https://github.com/solo-ist/prose/issues/15) | High | Open |
| Streaming LLM responses | [#20](https://github.com/solo-ist/prose/issues/20) | High | Planned |

### Phase 2: Agentic Editing
Enable AI to apply edits directly to the document, similar to Cursor/Claude Code.

**Issue**: [#21](https://github.com/solo-ist/prose/issues/21)

**Approach**: Search/replace blocks
- AI proposes `old_string` / `new_string` pairs
- More robust than line-based diffs
- Can evolve to inline suggestions later

| Task | Priority |
|------|----------|
| Design edit protocol (system prompt) | High |
| Parse edit blocks from AI response | High |
| Add "Apply" button per edit | High |
| Add "Apply All" action | Medium |
| Show diff preview before applying | Medium |
| Validate edit targets exist in document | Medium |
| Support undo for AI edits | Medium |

### Phase 3: Document Management
Improve document workflow and discoverability.

**Issue**: [#22](https://github.com/solo-ist/prose/issues/22)

| Task | Priority |
|------|----------|
| Store recent file paths (last 10-20) | Medium |
| Add File > Open Recent menu | Medium |
| Show recents on empty state | Medium |
| Clear recent files option | Low |

### Phase 4: Editor Enhancements
Expand editor capabilities.

**Issue**: [#23](https://github.com/solo-ist/prose/issues/23)

| Task | Priority |
|------|----------|
| Tables support (TipTap extension) | Medium |
| Image handling (paste/drag) | Medium |
| Export to .txt (plain text) | Low |

### Phase 5: Error Handling
Improve reliability and user feedback.

**Issue**: [#24](https://github.com/solo-ist/prose/issues/24)

| Task | Priority |
|------|----------|
| Validate model names per provider | Medium |
| Better API key validation | Medium |
| Network error recovery / retry | Medium |
| Settings validation | Low |

### Phase 6: Google Docs Sync
Two-way sync with Google Docs using last-write-wins.

**Issue**: [#27](https://github.com/solo-ist/prose/issues/27)

| Task | Priority |
|------|----------|
| Google OAuth integration | High |
| Store Google Doc ID in document | High |
| Push to Google Docs | High |
| Pull from Google Docs | High |
| Sync button / status indicator | Medium |

### Phase 7: Polish
UI/UX refinements.

**Issue**: [#25](https://github.com/solo-ist/prose/issues/25)

| Task | Priority |
|------|----------|
| About dialog | Low |
| Window title improvements | Low |
| Empty state design | Low |

### Phase 8: Launch Preparation
Distribution and installation.

**Issue**: [#26](https://github.com/solo-ist/prose/issues/26)

| Task | Priority |
|------|----------|
| DMG packaging (macOS) | High |
| Code signing + notarization | High |
| Auto-update (GitHub Releases) | High |
| Default app for .md/.markdown | Medium |
| Windows installer (NSIS) | Medium |
| Linux packages (AppImage, .deb) | Medium |

---

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Agentic editing format | Search/replace blocks | More robust than diffs, like Claude Code |
| Code signing | Apple Developer account | Required for Gatekeeper approval |
| Auto-updates | GitHub Releases | Free, native electron-updater support |
| Branding/logo | Deferred | Focus on functionality first |

---

## Backlog (Post-MVP)

These features are out of scope for MVP:

- PDF export
- HTML export
- Document templates
- Word goals / focus features
- Collaborative editing
- Inline edit suggestions (vs search/replace)
- Auto-sync (manual sync first)

---

## Key Files

### Agentic Editing
- `src/renderer/components/chat/ChatPanel.tsx` - Apply button
- `src/renderer/stores/editorStore.ts` - Edit application
- `src/renderer/hooks/useChat.ts` - Edit protocol
- `src/renderer/lib/documentEditor.ts` (new) - Targeting/diff

### Recent Documents
- `src/renderer/types/index.ts` - Add recentFiles to Settings
- `src/main/ipc.ts` - Track opens
- `src/renderer/components/layout/TitleBar.tsx` - Menu
- `src/renderer/components/layout/EmptyState.tsx` (new)

### Streaming
- `src/main/ipc.ts` - Enable streaming
- `src/preload/index.ts` - Stream IPC channel
- `src/renderer/hooks/useChat.ts` - Handle streaming

### Google Docs Sync
- `src/main/google.ts` (new) - Google API integration
- `src/renderer/types/index.ts` - Add googleDocId to Document
- `src/renderer/components/settings/SettingsDialog.tsx` - Account tab

### Launch
- `electron-builder.yml` - DMG, signing, associations
- `package.json` - Build scripts
- `build/` (new) - Icons, installer assets
