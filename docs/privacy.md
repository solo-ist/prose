# Privacy Policy

**Prose — AI-Powered Markdown Editor**
Last updated: November 9, 2026

## Summary

Prose is a local-first writing app. Your documents stay on your device unless you choose to publish one with sharing, or let a web assistant you connected work on your open documents with Remote access (see below). We don't track your usage, and you don't need an account to use Prose; only sharing and Remote access require signing in.

## Data We Don't Collect

- No analytics or usage tracking
- No account registration, unless you sign in to use sharing or Remote access
- No telemetry by default
- No document content is transmitted to us, except a document you publish. Remote access passes requests and answers through our server on their way between your Prose app and an assistant you connected; it never stores or logs them

## Your API Key

Prose uses a bring-your-own-key (BYOK) model. You provide your own Anthropic API key to use AI features. Your key is:

- Stored locally on your device using macOS Keychain (via Electron `safeStorage`)
- Sent directly to Anthropic's API (`api.anthropic.com`) only when you explicitly invoke an AI feature
- Never transmitted to us or any other third party

AI requests are made directly from your device to Anthropic. We never see, store, or relay your API key or your conversations. Anthropic's own privacy policy governs how they handle API requests: https://www.anthropic.com/privacy

## Your Documents

All files are stored locally on your device. Prose does not upload, sync, or back up your documents to any server. The exceptions are a document you explicitly publish with sharing, and what an assistant you connected with Remote access reads from the documents you have open. File access is limited to locations you explicitly open or save to.

## Sharing (Opt-In)

Sharing is in the direct-download version (not the Mac App Store version) and is invite-only for now. Nothing leaves your device for sharing until you sign in, and no document is uploaded until you publish it.

When you sign in to share, we store:

- Your email address, which we use to send you sign-in codes and, if you request sharing access, to tell you when it's on
- Your sign-in sessions, including the IP address and browser or app identifier that started each one

When you publish a document, we store:

- A copy of the published document, served at its share link to anyone who has the link
- Comments that readers leave on it, including the name they enter and, if they choose to give it, their email address (never shown to other readers)

Revoking a share link takes the document down and deletes its stored copy and comments. Copies that readers already saved stay with them.

## Remote Access for ChatGPT and Claude (Opt-In)

Remote access lets ChatGPT and claude.ai (and other assistants that connect over the web) work with the documents you have open in Prose. It is in the direct-download version (not the Mac App Store version), it is off until you turn it on in Settings → Integrations → Connections, and it needs you to be signed in.

How it works: your Prose app opens a connection out to our server, `api.prose.solo.ist`; your computer accepts no incoming connections. When a connected assistant calls a Prose tool (for example, to read an open document or suggest an edit), the request goes from the assistant's service to our server, then over that connection to your Prose app, which answers. The answer goes back the same way. An answer can include text from the documents you have open.

- **Two approvals.** You approve each assistant on our sign-in page, and again in Prose, where you choose what it may do (read; suggest edits; comment). An assistant you haven't approved in Prose gets nothing.
- **Open documents only.** An assistant can't open, create, or list your files, and it never accepts or rejects suggestions: you decide.
- **Nothing kept in transit.** The relay carries an assistant's requests (tool calls) and Prose's answers, in memory, and only while Remote access is on. No document content is ever stored on our server. If Prose isn't running, the assistant is told so and nothing waits for you.

What we store for Remote access:

- Each assistant's registration details, such as the name it gives and where to send you back after you approve it
- Your approval of each assistant, and its access tokens, which we keep only as one-way hashes. Access tokens expire after an hour; the token an assistant uses to stay connected expires after 30 days

What we log, one line per request: your account identifier, which assistant, the kind of request (for example a tool call), the name of the tool, how long it took, the size of the request and of the answer in bytes, and how it ended (answered, refused, timed out, Prose not running). Never the request's contents or the answer. These lines are kept in our host Render's logs for its retention period, between 7 and 30 days depending on our plan, then deleted.

The assistant's own service sees what you let it read, under its provider's privacy policy (for example, [OpenAI's](https://openai.com/policies/privacy-policy) or [Anthropic's](https://www.anthropic.com/privacy)).

To stop: turning off Remote access closes the connection at once, and removing (revoking) an assistant in Prose ends its access at once and revokes its tokens on our server, so it can't reconnect without your approval.

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
| `api.prose.solo.ist` | You turn on Remote access (opt-in only) | Keeps a connection open so assistants you approved can reach your open documents |

No other network connections are made.

## Third-Party Services

- **Anthropic** — AI provider. Only contacted when you use AI features. Governed by [Anthropic's privacy policy](https://www.anthropic.com/privacy).
- **Sentry** — Crash reporting. Only contacted if you opt in. Governed by [Sentry's privacy policy](https://sentry.io/privacy/).
- **Render** — Hosts the sharing and Remote access service and its database. Only used if you use sharing or Remote access.
- **Cloudflare R2** — Stores published documents. Only used if you publish.
- **Resend** — Sends sign-in code emails. Only used when you sign in.
- **GitHub** — Update checks. Only contacted to check for new app versions (direct-download version). Governed by [GitHub's privacy policy](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

## Children's Privacy

Prose does not knowingly collect any information from children under 13.

## Changes to This Policy

If we update this policy, we'll update the "Last updated" date above. Significant changes will be noted in the app's release notes.

## Contact

If you have questions about this policy, open an issue at https://github.com/solo-ist/prose or email privacy@solo.ist.
