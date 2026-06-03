# Prose — Mac App Store Copy

> **Draft notes — not for App Store Connect (resolve before submitting):**
> - **Free repositioning:** copy now leads with *free + open source* per the MAS = free-taste model (#615). Confirm the price tier is set to **Free** in App Store Connect.
> - **App name / branding:** kept the name **Prose** (bundle `ist.solo.prose`); App Store name stays **"Prose Markdown."** If #612's icon/branding refresh changes the wordmark or adds a tagline, update the Name/Subtitle to match.
> - **Crash-reporting accuracy:** with #391, **opt-in** crash reporting (Sentry) now works on the MAS build. The privacy section + App Privacy label below were updated to reflect "opt-in, off by default." → **The App Privacy nutrition label must declare *Crash Data* as optionally collected (not linked to identity)** once opt-in Sentry ships, instead of "Data Not Collected." Confirm with the privacy label in App Store Connect.
> - **MAS scope:** reMarkable sync, Google Docs sync, and the Claude-Desktop MCP server are gated **off** in the MAS build — intentionally not advertised here.

---

## App Metadata

### Bundle Name
`ist.solo.prose`

### App Name (30 characters max)
Prose Markdown

### Subtitle (30 characters max)
Markdown for the agentic era

### Promotional Text (170 characters — editable without a new build)
Free, open-source markdown for the agentic era. Plain `.md` files, your own Anthropic key, and AI that edits alongside you — no subscription, no middleman.

### Description

Prose is a free, open-source markdown editor for the Mac, built for the agentic era — where your files are plain text, your API keys are yours, and AI works alongside you directly in the document.

**Free and Open Source**
Prose is free on the App Store and MIT-licensed on GitHub — the same codebase, every line readable. Fork it, build on it, or just use it. Prose exists to be useful, not to manufacture dependency.

**Plain Files, Always**
Your documents are `.md` files — open them in any editor, back them up anywhere, send them to anyone. No proprietary formats, no required cloud sync, no lock-in. They'll outlast this app.

**Bring Your Own Key**
Connect your own Anthropic API key. Prose talks to Anthropic directly — no markup, no middleman, no subscription. Your conversations stay on your machine.

**AI That Works Alongside You**
Chat about your draft, or hand the agent the keys to edit it. Prose's assistant works in two modes — a read-only Chat mode and an Editor mode where it can insert, rewrite, and restructure with real tool calls — so you stay in control of when AI touches the page.

**Review Every Suggestion**
AI edits arrive as inline comments, like notes from a collaborator — never silent rewrites. Accept or reject each change individually, leave feedback, or sweep through everything in Quick Review or a full side-by-side diff. Your document stays clean until you say so.

**Know What the AI Wrote**
Accepted AI edits are tracked with human/AI provenance you can toggle on or off, plus a permanent edits-history ledger for the document — so months later you still know which words were yours.

**Organize Your Way**
Pin Projects and Favorites in the file explorer to keep the documents you live in one click away. Multi-tab editing, session restore, single-click preview, and reopen-closed-tab (⌘⇧T) keep a big workspace navigable.

**A Clean, Minimal Editor**
Pure markdown editing on TipTap. YAML frontmatter parsed and preserved, never rendered. Code-block syntax highlighting, light and dark themes, autosave, configurable fonts, and standard shortcuts. Export to self-contained HTML when you need to share. The words are what matter.

**Privacy First**
No accounts. No analytics, no telemetry. API keys stored in the macOS Keychain. Crash reporting is strictly opt-in and off by default. Everything stays on your machine unless you choose otherwise.

### Keywords (100 characters, comma-separated)
markdown,editor,writing,AI,Claude,plain text,distraction free,notes,open source,free

### Support URL
https://github.com/solo-ist/prose/issues

### Marketing URL
https://solo.ist/prose

---

## What's New

> Version is assigned at release-cut time. This entry covers the current MAS refresh.

Prose is now **free**. This release also brings:

- **AI edits history** — a permanent per-document ledger of every accepted AI change.
- **Quick Review redesign** — accept/reject actions sit right above the diff for faster passes.
- **Projects & Favorites** — pin the folders and files you work in most.
- **Reopen Closed Tab** — bring back the last tab you closed with ⌘⇧T.
- **Export to HTML** — self-contained HTML with the markdown embedded for round-trip editing.
- **Code-block syntax highlighting**, refreshed selection styling, live word/character count, sharper comment placement, and a batch of editor and stability fixes.

Plain `.md` files. Your keys stay yours.

---

## App Store Screenshots (suggested copy overlays)

Owned by #612 for the actual assets. Guidance: macOS screenshots at 2560×1600, dark mode preferred (matches the default aesthetic). Short headline + optional subline each.

**Screenshot 1 — Hero / Editor**
Headline: Pure markdown. Zero lock-in.
Sub: Your documents are `.md` files. Open them anywhere — they'll outlast this app.

**Screenshot 2 — AI Alongside You**
Headline: Your key. Your costs.
Sub: Bring your own Anthropic key. No middleman, no subscription — conversations stay local.

**Screenshot 3 — Review Every Suggestion**
Headline: Nothing changes until you say so.
Sub: AI edits show up as inline comments. Accept or reject — one at a time, or all at once.

**Screenshot 4 — Edits History**
Headline: Know what the AI wrote.
Sub: A permanent ledger of every accepted change, with human/AI provenance.

**Screenshot 5 — Projects & Favorites**
Headline: Your workspace, one click away.
Sub: Pin the projects and files you live in.

---

## Age Rating
4+ — No objectionable content.

## Category
Primary: Productivity · Secondary: Developer Tools

---

## App Privacy

**Crash Data (optional, opt-in, not linked to identity)**
If — and only if — you enable crash reporting in Settings (off by default), Prose sends crash diagnostics to Sentry to help fix bugs. File paths are scrubbed. No other data is collected.

**Not Collected**
No accounts, no analytics, no telemetry. API keys are stored in the macOS Keychain.

Note: when you use AI features, Prose passes your API key and message content directly to Anthropic. See Anthropic's privacy policy for details.
