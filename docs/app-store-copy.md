# Prose — Mac App Store Copy

---

## App Metadata

### Bundle Name

`ist.solo.prose`

### App Name (30 characters max)

Prose Markdown

### Subtitle (30 characters max)

Markdown editor for the AI era

### Promotional Text (170 characters — editable without a new build)

Free, open-source markdown editing. *Optional* AI that doesn't write for you. Bring your own API key. No subscriptions, no data collection, nothing between you and your files.

### Description

Prose is a free, open-source markdown editor for the Mac, featuring an optional and respectful AI integration.

Prose is different: This is AI that gets out of the way, augmenting your skills — *not* replacing them. Find typos, fix grammar, or pressure test an idea, just like a helpful editor would.

**Simple, Clean, and Minimal**\
Prose works great without AI! The design is clean, minimal, and *intentional.* No pixels are wasted.

**Free and Open Source**\
Prose is free on the App Store and MIT-licensed on GitHub. It's the same codebase, every line readable. Fork it, build on it, or just use it. Prose exists to be useful, not manufacture dependency.

**Privacy First**\
No accounts. No analytics, no telemetry. API keys are stored securely in macOS Keychain. Crash reporting is strictly opt-in and off by default. Everything stays on your machine unless you choose otherwise.

**AI That Works For You**\
Prose offers a "strong opinion, weakly held" — AI shouldn't write for you, or replace your voice. While Prose is opinionated about AI's role in writing, we're also about offering *choice*.

We offer three unobtrusive modes: Chat, Editor, and Create.

Chat Mode lets you talk about your draft, pressure testing ideas or structure.

Editor Mode works like a helpful copyeditor, finding typos, fixing grammar mistakes, and providing suggestions like notes from a collaborator.

Create Mode lets you put AI in the driver's seat, letting you rip through rote, mechanical, or uncreative work. Iterate on your coding plans with lightning speed.

**Review and Track Every Suggestion**\
Regardless of the AI Mode, you stay in control when AI touches the page.

AI edits arrive as inline comments and suggestions, never silent rewrites. Accept or reject each change individually, leave feedback, or sweep through everything in Quick Review or a full side-by-side diff.

Prose maintains a persistent history of AI edits, and provides highlighting to track non-human words with a clean, clear visual cue, so you can keep track and stay in charge.

Your document stays clean until you say so.

**Bring Your Own Key**\
Your conversations are yours. Use your own Anthropic API key, with nothing in the middle. Prose talks to Anthropic directly: no data capture, no training on your data, no markup, no middleman, no subscription.

**Local First — Plain Files, Always**\
Prose works with your local documents, with support for `.txt` and `.md` files. Open them in any editor, back them up anywhere, send them to anyone. No proprietary formats, no required cloud sync, no lock-in.

**Organize Your Way**\
Pin Projects and Favorites in the file explorer to keep the documents you live in one click away. Multi-tab editing, session restore, single-click preview, keep a big workspace navigable.

### Keywords (100 characters, comma-separated)

markdown,editor,writing,AI,Claude,plain text,distraction free,notes,open source,free

### Support URL

<https://solo.ist/prose/support/>

### Marketing URL

<https://solo.ist/prose>

---

## What's New

Version 1.9.0, the first App Store update since 1.6.5, so it covers 1.7.0 through 1.9.0. App Store Connect shows
this field as plain text (4000 characters at most): paste the block below as is. Nothing in it may name a feature
the App Store build gates off (sharing, sign-in, Claude Desktop, reMarkable, auto-update) or another edition of
the app. The in-app "What's new" window reads `resources/release-notes/1.9.0-mas.md`, the longer version.

```text
Prose 1.9.0 is a big polish release, and the first App Store update since 1.6.5.

• Tables — Insert and edit tables right in the editor: add, move and delete rows and columns, or type a pipe table to create one. Tables always save as plain markdown.
• Tabs keep your place — Every tab keeps its own caret, scroll position, undo history, comments and AI highlights. Source mode is per tab, too, and an untouched toggle changes nothing.
• Your files are safer — Prose notices when an open file changes on disk. Clean tabs reload, and unsaved work gets a conflict prompt instead of being overwritten.
• Markdown stays as written — Pipes in table cells, code blocks inside lists, superscript and subscript, and images with spaces in their names all survive a save.
• Comments stay put — Comments and AI highlights stay on their text through edits, tab switches, source mode and relaunches.
• A guided first run — New installs set up AI, an API key that is verified before it is saved, and the default app in one short walkthrough.
• Smaller things — A copy button on code blocks, a blockquote button, a choice of bullet style, Duplicate and move in the file explorer, open and save dialogs that remember their folder, and a "What's new" window after each update.
• Under the hood — Electron 45 and a full security update. Prose now requires macOS 13 or later.
```

---

## App Store Screenshots (suggested copy overlays)

Owned by #612 for the actual assets. Guidance: macOS screenshots at 2560×1600, dark mode preferred (matches the default aesthetic). Short headline + optional subline each.

**Screenshot 1 — Hero / Editor\
\
Scene: Editor open with the file explorer expanded to the Projects view.\
\
Headline: Pure markdown. No lock-in. No subscriptions.**

**Sub:** Your documents are plain \`.md\` or \`.txt\` files. Bring them anywhere — they'll outlast this app.

**Screenshot 2 — AI Alongside You\
\
\*\*Scene:\*\* Editor with the chat panel open. One comment and two small suggestions visible in the document. The chat panel shows the AI declining to write prose and recommending a mode switch.\
\
Headline: Respectful AI.**

**Sub:** Bring your own Anthropic key. No middleman, no subscription — conversations stay local.

**Screenshot 3 — Review Every Suggestion\
\
Scene: Quick Review UI open over a document, mid-review with one suggestion highlighted.**

**\[UI of Quick review\]**

**Headline:** Nothing changes until you say so.

**Sub:** AI edits show up as inline comments. Accept or reject — one at a time, or all at once.

**Screenshot 4 — Edits History\
\
Scene: The AI Edits History view open, showing a ledger of past accepted changes with model and reason metadata.\
\
Headline: Know what the AI wrote.\
\
Sub: A permanent ledger of every accepted change, with human/AI provenance.**

**\[AI edit history view\]**\
\
Headline: Know what the AI wrote.\
Sub: A permanent ledger of every accepted change, with human/AI provenance.

**Screenshot 5 — Projects & Favorites\
\
Scene: Favorites view in the file explorer, with a document open in the editor alongside it.\
\
Headline: Your workspace, one click away.\
\
Sub: Pin the projects and files you live in.**

---

## Age Rating

4+ — No objectionable content.

## Category

Primary: Productivity · Secondary: Developer Tools

---

## App Privacy

Crash Data (optional, opt-in, not linked to identity)

If — and only if — you enable crash reporting in Settings (off by default), Prose sends crash diagnostics to Sentry to help fix bugs. File paths are scrubbed. No other data is collected.

**Not Collected**\
No accounts, no analytics, no telemetry. API keys are stored in the macOS Keychain.

Note: when you use AI features, Prose passes your API key and message content directly to Anthropic. See Anthropic's privacy policy for details.