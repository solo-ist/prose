# Prose v1.2.0

A polish-and-stability release: editor papercuts smoothed out, MCP made friendlier for Claude collaborators, and a fresh batch of fixes from real-world use of v1.1.0.

## What's New

### Editor

- **Link hover affordances** — links in the editor now show a pointer cursor and surface the URL in the status bar on hover, matching how every other markdown app behaves
- **Quick review panel** — wider default (330px) so AI-suggested edits have room to breathe

### MCP

- **Nested containers** in `get_outline` and `read_document` so Claude can navigate complex documents (lists inside callouts inside blockquotes) the way you wrote them
- **`suggest_edit`** is more reliable across tricky markdown shapes
- **Comments are visible** to MCP clients — Claude can now read and reason about the comments in your draft

### Reporting

- **Error Reporting consent prompt** — clicking "Report a bug" from the toolbar offers to enable Error Reporting first, so the report you send actually carries the crash trace it needs

## Fixes

- Editor: frontmatter no longer destabilizes the document; comment modal click is restored (#449, #456)
- Editor: image drag-and-drop now resolves paths correctly (#417)
- Editor: "Copy Markdown" uses Electron's native clipboard so other apps actually receive the markdown (#481)
- Persistence: IndexedDB auto-reconnects on `InvalidStateError` instead of leaving the app in a broken state (#377, #393)
- About dialog: reads the version from `package.json` instead of a hardcoded string (#438)
- Post-merge bug batch: misc papercuts from v1.1.0 cleaned up (#489, #490, #491, #492)

## Under the Hood

- LLM model IDs centralized through `getDefaultModel` so adding or swapping models touches one place (#389)
- Web build is now self-contained — `build:buildinfo` chains automatically (#484)
- CI: fork contributors can run E2E and Web E2E (#483, #485, #486); per-issue concurrency scope unblocks cross-issue parallelism (#470)

## Installation

### Direct Download

Download `Prose-1.2.0-arm64.dmg`, open, and drag to Applications. The app is signed and notarized — no security bypass needed.

### Auto-Update

Existing users will be prompted to update automatically.

### Mac App Store

The Mac App Store build for this release will follow separately.

## Requirements

- macOS (Apple Silicon)
- Anthropic API key for AI features ([get one](https://console.anthropic.com/))

---

**Full changelog:** https://github.com/solo-ist/prose/compare/v1.1.0...v1.2.0
