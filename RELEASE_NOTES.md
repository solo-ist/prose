# Prose v0.1.0-alpha.4 — Persistence & Polish

Fixes AI feature persistence and improves editor reliability.

## What's New

### Bug Fixes
- **Persist AI suggestions across tab switches** — AI-generated suggestions now survive when you switch between tabs
- **Persist AI annotations across tab switches** — Inline AI annotations remain visible after tab navigation
- **Fixed chat panel disappearing** — Chat no longer disappears when generating content on blank documents

### Improvements
- **Clickable line references** — Line references in chat are now clickable with visual search highlighting
- **Multi-node selection in comments** — Improved selection capture for the comment system
- **Updated default model** — Now uses claude-sonnet-4-5 for better performance
- **Dev server PID protocol** — Added safe process management for development

## Requirements

- **macOS** (Apple Silicon) — Intel Mac support coming soon
- **Anthropic API key** — Required for AI features ([get one here](https://console.anthropic.com/))

## Installation

1. Download `Prose-0.1.0-alpha.4-arm64.dmg`
2. Open the DMG and drag Prose to Applications
3. **Important: Unsigned app workaround**

   macOS will show a misleading "damaged" error for unsigned apps downloaded from the internet. The app is not actually damaged. To fix this, open Terminal and run:

   ```bash
   xattr -cr /Applications/Prose.app
   ```

   Then open Prose normally. This is only required once after installation.

## Known Limitations

This is an early alpha release:

- macOS only (Windows/Linux builds coming)
- Apple Silicon only (Intel support coming)
- App is unsigned — requires manual security bypass
- No auto-updates yet

## Feedback

Found a bug or have a suggestion? Please open an issue:
https://github.com/solo-ist/prose/issues

---

Built with Electron, React, and TipTap.
