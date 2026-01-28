# Prose v0.1.0-alpha.2 — Quality of Life

Fixes and improvements focused on editor stability and user experience.

## What's New

### Bug Fixes
- **Fixed undo stack behavior** — Undo no longer goes past the initial document state when opening files
- **Fixed dirty state tracking** — Document dirty indicator now works correctly
- **Fixed document scroll position** — Documents now open at the top instead of the bottom
- **Fixed button nesting warning** — Resolved React warning in TabBar component

### Improvements
- **Keyboard shortcuts overhaul** — Comprehensive audit and implementation of keyboard shortcuts
- **API key validation** — Better error handling and testing for API keys
- **User feedback for AI suggestions** — Added mechanism to provide feedback on AI responses
- **Autosave functionality** — Configurable autosave intervals to prevent data loss
- **Copy-to-clipboard buttons** — Easily copy chat content
- **Window dragging** — Tab bar area now supports window dragging
- **Content Security Policy** — Eliminated Electron security warnings
- **Default font change** — Now uses IBM Plex Mono instead of Source Code Pro

### Developer Experience
- **Automatic Claude code review** — CI now runs code review on PR open

## Requirements

- **macOS** (Apple Silicon) — Intel Mac support coming soon
- **Anthropic API key** — Required for AI features ([get one here](https://console.anthropic.com/))

## Installation

1. Download `Prose-0.1.0-alpha.2-arm64.dmg`
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
