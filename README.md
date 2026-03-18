# Prose

> A minimal markdown editor with integrated AI chat. Think iA Writer meets Cursor.

![Prose Screenshot](docs/images/screenshot.png)

Part of the [solo.ist](https://solo.ist) family.

## Features

- **Clean markdown editing** — Distraction-free writing with live preview
- **AI chat panel** — Claude-powered assistance with full document context
- **reMarkable sync** — Import handwritten notes from your tablet
- **Light/dark themes** — Easy on the eyes, day or night
- **Local files** — Plain .md files, your data stays yours

## Download

**Alpha Release** — Early preview, expect rough edges.

[Download for macOS (Apple Silicon)](https://github.com/solo-ist/prose/releases/latest)

*Intel Mac, Windows, and Linux coming soon.*

## Requirements

- macOS 11+ (Big Sur or later)
- [Anthropic API key](https://console.anthropic.com) for AI features
- Optional: reMarkable tablet for notebook sync

## Quick Start

1. Download and install Prose
2. Open Settings (⌘,) and add your Anthropic API key
3. Start writing!

## Privacy

- **No data collection** — Prose never phones home. There are no analytics, telemetry, or tracking of any kind.
- **BYOK** — Bring Your Own Key. Your Anthropic API key stays on your machine, stored via OS `safeStorage` (Keychain on macOS).
- **API calls on user action only** — The only outbound requests are to `api.anthropic.com`, and only when you explicitly invoke an AI feature.
- **Local files** — Your documents are plain `.md` files on your filesystem. Prose never uploads them.
- **Opt-in crash reporting** — Error reporting via Sentry is disabled by default. You can enable it in Settings → General.

## Build from Source

```bash
git clone https://github.com/solo-ist/prose.git
cd prose
npm install

# Run in development
npm run dev

# Build distributable
npm run build:mac   # macOS
npm run build:win   # Windows
npm run build:linux # Linux
```

See [CLAUDE.md](CLAUDE.md) for architecture and development guidelines.

## Contributing

Contributions welcome! Please open an issue first to discuss what you'd like to change.

## License

MIT
