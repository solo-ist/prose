# Prose MVP

A cross-platform markdown editor with integrated AI, cloud sync, and handwriting import.

**Version**: 0.1.0-alpha.4
**Platform**: macOS (primary), Windows/Linux (infrastructure ready)
**Model**: BYOK (bring your own key) -- Anthropic only

---

## What Ships

### Editor

- TipTap-based markdown editor with live rendering
- Multi-tab interface with session persistence and preview tabs
- Find & replace
- Frontmatter display
- Autosave (off / on every change / custom interval)
- Crash recovery with session restore
- Configurable font, size, and line height (IBM Plex Mono default)

### File Management

- Native open/save/save-as dialogs (`.md`, `.markdown`, `.txt`)
- File explorer sidebar with lazy-loaded directory tree
- File rename, duplicate, delete/trash, reveal in Finder
- Recent files menu (macOS Dock integration)
- Register as default markdown editor

### AI Chat

- Streaming chat panel with full document context
- Multi-conversation threads per document, persisted to IndexedDB
- Three tool modes:
  - **Suggestions** -- read-only; AI proposes edits via `suggest_edit`
  - **Full** -- AI can directly modify the document
  - **Plan** -- AI proposes changes, user approves before apply
- Inline suggestion popover on text selection (rewrite, expand, condense, tone)
- Annotation visibility toggle

### Document Review

- Quick review (inline diff)
- Side-by-side diff
- Per-change navigation with accept/reject controls

### Google Docs Integration

- OAuth 2.0 authentication
- Push, pull, and import (HTML-to-markdown with nested list handling)
- Batch sync across linked documents
- Auto-creates `~/Documents/Google Docs/` folder

### reMarkable Integration

- Device registration and notebook sync
- OCR via Claude Vision (reuses Anthropic API key)
- Dual output: read-only OCR in `.remarkable/`, editable markdown alongside
- Selective notebook sync with cloud-native picker

### MCP Server

- Auto-install stdio server for Claude Desktop
- Version tracking and uninstall

### Settings & Theming

- 5 themes: dark (default), light, system, terminal green dark/light
- Settings dialog with tabs: General, Editor, LLM, Integrations, Account
- API key storage via OS Keychain (safeStorage) with plaintext fallback
- Keyboard shortcuts reference dialog

---

## What's Broken (Do First)

Issues that must be fixed before the MVP can ship. Current "Do First" column on the [project board](https://github.com/orgs/solo-ist/projects/5/views/1).

| # | Issue | Type |
|---|-------|------|
| 229 | Word diff uses set-membership instead of proper LCS | bug |
| 230 | Side-by-side review counter shows confusing "X of Y" | bug |
| 208 | macOS app fails to launch due to code signing | bug |
| 211 | reMarkable sync broken on fresh install | bug |
| 212 | Prose MCP error | bug |
| 132 | Insert and delete operations stream incorrectly | bug |
| 227 | Cmd+W doesn't work | bug |
| 206 | Info panel summary + context fix | bug |
| 143 | Reconcile "Preview Mode" and "Markdown Mode" states | enhancement |
| 55 | Investigate frontmatter editing support | spike |
| 214 | Make reMarkable notebook folders collapsible | feature |
| 215 | reMarkable folder file movements update cloud location | feature |
| 217 | Capitalize "P" in app name | feature |
| 237 | Migrate API key storage to safeStorage/Keychain | enhancement |
| 238 | AI consent/disclosure flow for MAS compliance | enhancement |

---

## What Ships Next (Launch Blockers)

Required for public release but not for feature-complete MVP. Current "Do Next" column.

| # | Issue | Type |
|---|-------|------|
| 127 | Complete security audit | launch |
| 26 | Packaging, signing, auto-update | launch |
| 120 | Google Cloud OAuth verification | launch |
| 191 | Auto-update via GitHub Releases | launch |
| 138 | Mac App Store v1.0 ($0.99 BYOK) | release |
| 197 | Open-source preparation (make repo public) | chore |

---

## Not MVP (Later)

Acknowledged ideas, explicitly deferred.

- Tables, images, txt export (#23)
- SpecScript block integration (#168)
- Audio transcription with speaker diarization (#190)
- Bash CMS plugin (#219)
- Platform architecture / SpecScript as universal layer (#232)
- Integrated terminal (#233)
- SpecScript versioning research (#234)
- Enterprise infrastructure (#235)

---

## Success Criteria

MVP is complete when a user can:

1. Open the app, create or open a markdown document, and edit with full formatting
2. Open the AI chat, have a multi-turn conversation about their document, and accept/reject suggested edits
3. Sync a document to Google Docs and pull changes back
4. Import handwritten notes from a reMarkable tablet via OCR
5. Close the app, reopen, and find all tabs, conversations, and settings preserved
6. Do all of the above without hitting any of the "Do First" bugs
