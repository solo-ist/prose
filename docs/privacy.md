# Privacy Policy

**Prose — AI-Powered Markdown Editor**
Last updated: October 12, 2026

## Summary

Prose is a local-first writing app. Your documents stay on your device unless you choose to publish one with sharing (see below). We don't track your usage, and you don't need an account to use Prose; only sharing requires signing in.

## Data We Don't Collect

- No analytics or usage tracking
- No account registration, unless you sign in to use sharing
- No telemetry by default
- No document content is transmitted to us, except a document you publish

## Your API Key

Prose uses a bring-your-own-key (BYOK) model. You provide your own Anthropic API key to use AI features. Your key is:

- Stored locally on your device using macOS Keychain (via Electron `safeStorage`)
- Sent directly to Anthropic's API (`api.anthropic.com`) only when you explicitly invoke an AI feature
- Never transmitted to us or any other third party

AI requests are made directly from your device to Anthropic. We never see, store, or relay your API key or your conversations. Anthropic's own privacy policy governs how they handle API requests: https://www.anthropic.com/privacy

## Your Documents

All files are stored locally on your device. Prose does not upload, sync, or back up your documents to any server. The one exception is a document you explicitly publish with sharing. File access is limited to locations you explicitly open or save to.

## Sharing (Opt-In)

Sharing is off unless you turn it on, and is invite-only for now. It isn't available in the Mac App Store version.

When you sign in to share, we store:

- Your email address, which we use to send you sign-in codes and, if you request sharing access, to tell you when it's on
- Your sign-in sessions, including the IP address and browser or app identifier that started each one

When you publish a document, we store:

- A copy of the published document, served at its share link to anyone who has the link
- Comments that readers leave on it, including the name they enter and, if they choose to give it, their email address (never shown to other readers)

Revoking a share link takes the document down and deletes its stored copy and comments. Copies that readers already saved stay with them.

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
| `api.prose.solo.ist` | You use sharing (opt-in only) | Signs you in, publishes your document, and syncs its comments |

No other network connections are made.

## Third-Party Services

- **Anthropic** — AI provider. Only contacted when you use AI features. Governed by [Anthropic's privacy policy](https://www.anthropic.com/privacy).
- **Sentry** — Crash reporting. Only contacted if you opt in. Governed by [Sentry's privacy policy](https://sentry.io/privacy/).
- **Render** — Hosts the sharing service and its database. Only used if you use sharing.
- **Cloudflare R2** — Stores published documents. Only used if you publish.
- **Resend** — Sends sign-in code emails. Only used when you sign in to share.
- **GitHub** — Update checks. Only contacted to check for new app versions (direct-download version). Governed by [GitHub's privacy policy](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

## Children's Privacy

Prose does not knowingly collect any information from children under 13.

## Changes to This Policy

If we update this policy, we'll update the "Last updated" date above. Significant changes will be noted in the app's release notes.

## Contact

If you have questions about this policy, open an issue at https://github.com/solo-ist/prose or email privacy@solo.ist.
