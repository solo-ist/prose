# Prose v0.1.0-alpha.1 — Early Preview

The first public alpha release of Prose, a minimal markdown editor with integrated AI assistance.

## What is Prose?

Prose is a distraction-free writing environment that combines a clean markdown editor with AI chat capabilities. Write naturally in markdown while having Claude available for brainstorming, editing suggestions, and research assistance.

## Requirements

- **macOS** (Apple Silicon) — Intel Mac support coming soon
- **Anthropic API key** — Required for AI features ([get one here](https://console.anthropic.com/))

## Installation

1. Download `Prose-0.1.0-alpha.1-arm64.dmg`
2. Open the DMG and drag Prose to Applications
3. **Important: Unsigned app workaround**

   macOS will show a misleading "damaged" error for unsigned apps downloaded from the internet. The app is not actually damaged. To fix this, open Terminal and run:

   ```bash
   xattr -cr /Applications/Prose.app
   ```

   Then open Prose normally. This is only required once after installation.

## Features

- **Markdown editor** with syntax highlighting and live preview
- **AI chat panel** powered by Claude (Anthropic, OpenRouter, or Ollama)
- **Dark mode** by default, with light theme available
- **File explorer** sidebar for navigating your documents
- **Tab-based editing** with drag reordering
- **reMarkable integration** for syncing handwritten notes (optional)

## Known Limitations

This is an early alpha release:

- macOS only (Windows/Linux builds coming)
- Apple Silicon only (Intel support coming)
- App is unsigned — requires manual security bypass
- No auto-updates yet
- Some rough edges expected

## Feedback

Found a bug or have a suggestion? Please open an issue:
https://github.com/angelmarino/prose/issues

---

Built with Electron, React, and TipTap.
