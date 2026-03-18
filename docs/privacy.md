# Privacy Policy

**Prose — AI-Powered Markdown Editor**
Last updated: March 18, 2026

## Summary

Prose is a local-first writing app. Your documents stay on your device. We don't collect your data, track your usage, or require an account.

## Data We Don't Collect

- No analytics or usage tracking
- No account registration
- No telemetry by default
- No document content is ever transmitted to us

## Your API Key

Prose uses a bring-your-own-key (BYOK) model. You provide your own Anthropic API key to use AI features. Your key is:

- Stored locally on your device using macOS Keychain (via Electron `safeStorage`)
- Sent directly to Anthropic's API (`api.anthropic.com`) only when you explicitly invoke an AI feature
- Never transmitted to us or any other third party

AI requests are made directly from your device to Anthropic. We never see, store, or relay your API key or your conversations. Anthropic's own privacy policy governs how they handle API requests: https://www.anthropic.com/privacy

## Your Documents

All files are stored locally on your device. Prose does not upload, sync, or back up your documents to any server. File access is limited to locations you explicitly open or save to.

## Crash Reporting (Opt-In)

Prose includes optional crash reporting powered by Sentry. This is **disabled by default** and can be enabled in Settings > General > Error Reporting.

When enabled, crash reports may include:

- Error messages and stack traces
- App version and operating system version
- Anonymous device identifier

Crash reports **never** include:

- Document content or file names
- Your API key
- Personal information

You can disable crash reporting at any time in Settings.

## Network Connections

Prose only makes network requests in these cases:

| Connection | When | Purpose |
|-----------|------|---------|
| `api.anthropic.com` | You use an AI feature | Sends your prompt to Anthropic's API using your key |
| `github.com` | App checks for updates | Checks for new releases (direct-download version only) |
| `sentry.io` | Crash occurs (opt-in only) | Sends anonymized crash report |

No other network connections are made.

## Third-Party Services

- **Anthropic** — AI provider. Only contacted when you use AI features. Governed by [Anthropic's privacy policy](https://www.anthropic.com/privacy).
- **Sentry** — Crash reporting. Only contacted if you opt in. Governed by [Sentry's privacy policy](https://sentry.io/privacy/).
- **GitHub** — Update checks. Only contacted to check for new app versions (direct-download version). Governed by [GitHub's privacy policy](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

## Children's Privacy

Prose does not knowingly collect any information from children under 13.

## Changes to This Policy

If we update this policy, we'll update the "Last updated" date above. Significant changes will be noted in the app's release notes.

## Contact

If you have questions about this policy, open an issue at https://github.com/solo-ist/prose or email privacy@solo.ist.
