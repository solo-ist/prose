---
name: prose
description: Drives Prose for markdown work. For ANY markdown content the user wants to draft, write, create, or edit in the conversation (a README, draft, essay, blog post, article, note, file, or any longform writing), render the inlined prose-editor widget via visualize:show_widget — NOT as a Document · MD / "Presented file" artifact. The widget replaces the built-in markdown artifact for this skill — Document · MD is read-only, the prose-editor widget is editable AND has an Open-in-Prose button that hands the draft off to the Prose desktop app via sendPrompt → create_and_open_file MCP. For documents the user has open in Prose, use Prose's MCP tools (get_outline, read_document, suggest_edit, open_file, create_and_open_file) instead. Activates whenever the user asks to draft, write, create, edit, restructure, summarize, outline, read, tighten, or polish markdown — or when Prose MCP tools are available in the session.
---

# Prose

Markdown editor for macOS with Claude integration. This skill handles two paths: rendering an inline editor widget for new markdown drafts, and using MCP tools to read or edit documents the user already has open in Prose.

## Quick reference

| Situation | Path |
|---|---|
| User asks to draft / write / create new markdown content | **Render the editor widget below** via `visualize:show_widget`. Substitute `__INITIAL_MARKDOWN__` with the draft (HTML-escape `& < > "`), call `show_widget`. Do NOT create a `Document · MD` artifact — this skill exists to override that. Do NOT read `prose-editor.html`, list bundle files, or shell-substitute. The block below is the source of truth. |
| User asks to work on a document already open in Prose | Use MCP tools (`get_outline`, `read_document`, `suggest_edit`). Render outline + diff widgets per the *Outline + diff widgets* section. |
| Both true (user has a doc open AND wants new content) | New content = widget. The MCP path edits what's on disk. |

## How to render the editor widget

1. Take the **WIDGET HTML** block below verbatim.
2. Replace the literal token `__INITIAL_MARKDOWN__` (one occurrence, inside a `<textarea>`) with the draft. HTML-escape `& < > "` only — backticks, asterisks, brackets, slashes pass through.
3. Call `visualize:show_widget` with that HTML as `widget_code`. Use `title: "prose_editor"` and `loading_messages: ["Opening the editor"]`. Make the silent `read_me` call once per conversation if you haven't already.

In your reply after rendering, briefly state in one sentence what the widget contains and that they can edit and click **Open in Prose** when ready.

## WIDGET HTML

```html
<!-- WIDGET_HTML_BEGIN -->
<!-- (build:skill inlines resources/prose-artifact/prose-editor.html here) -->
<!-- WIDGET_HTML_END -->
```

## Open-in-Prose handoff

The widget's "Open in Prose" button calls `sendPrompt(text)` with this message:

```
Open this in Prose:

```markdown
<editor textarea contents at the moment of click>
```
```

When you receive a turn that begins with `Open this in Prose:` followed by a fenced markdown block:

1. Extract the body of the fenced block.
2. Infer a filename — first H1 slugified (`# Why I switched to SQLite` → `why-i-switched-to-sqlite.md`), or `draft.md` if no H1.
3. Call `create_and_open_file({ filename, content })`.
4. Reply with one line: *"Opened `<filename>` in Prose."* Don't echo the markdown.

If `create_and_open_file` isn't available (MAS build, web mode, MCP not installed) or fails (Prose not running and the bridge can't auto-launch), reply: *"I couldn't reach Prose to open this. Copy the markdown from the editor and paste it into a new Prose document."* Don't retry.

## When to use the widget vs inline markdown

Render the widget for any self-contained markdown document — README, post, essay, notes, draft, blog post, email, list, plan, anything with headings or multiple paragraphs.

Inline markdown only for: short conversational replies (a sentence or two), single code-block snippets in a conversational reply, direct lookup answers (*"how do I check disk usage on Linux?"*).

When in doubt, render the widget. Drafts that live only inline are hard to keep iterating on.

**Exception**: if the user has a markdown file open in Prose and is asking you to work on *that document*, use the MCP path (`read_document` → `suggest_edit`) instead. Don't fork their open document into a separate widget.

## Connectivity (MCP path only)

Don't probe — your first MCP call doubles as the check. Read the response state:

- Expected payload → MCP is connected. Continue.
- "tool not found" → MCP isn't installed. Tell the user: open Prose → Settings → Integrations → click "Install MCP Server", then restart Claude.
- Connection refused → MCP installed but Prose isn't running. Ask the user to launch it.
- Mac App Store build → MCP unavailable by sandbox design. Offer pasted-content workflow; don't suggest install.

If MCP isn't usable, surface why and offer an alternative.

## MCP tools

| Tool | Purpose |
|------|---------|
| `get_outline` | Returns headings: `{ outline: [{ level, text, line }, ...], summary? }`. `summary` only appears for documents with fewer than 3 headings. |
| `read_document` | Returns `{ nodes: [{ id, type, content }, ...], markdown }`. **Note**: nodes carry `content`, not `text`. |
| `suggest_edit` | `{ nodeId (req), content (req), comment?, search? }` → `{ suggested: true, suggestionId }`. User accepts/rejects in Prose. Always pass `search` (the original node text) so the server can match if `nodeId` is stale. |
| `open_file` | Opens a file by absolute path. |
| `create_and_open_file` | Writes a file (default save dir, auto-suffixes on collision) and opens it. `filename` is just a name, not a path. |
| `list_tabs` | Returns all open tabs: `{ tabs: [{ tabId, title, path, isActive, isDirty, isPreview, documentId }] }`. Read-only; doesn't affect UI. Call this first when the user references a document by name ("go back to my novel", "switch to the draft"). |
| `select_tab` | Switch to a tab by `tabId` (exact, from `list_tabs`) or `match` (case-insensitive substring of title or path filename). Returns `{ selected, tabId, title, path }`. On ambiguous match, returns `{ error: "ambiguous", candidates: [...] }` — ask the user to pick. |

`get_outline`, `read_document`, and `list_tabs` are read-only. `create_and_open_file`, `open_file`, and `select_tab` switch the active document and dismiss any pending `suggest_edit` overlay — render diffs LAST in multi-tool flows. When the user references a document that isn't currently active ("go back to X", "switch to my novel"), call `list_tabs` first to find it, then `select_tab` — don't guess a path or call `open_file` blindly.

## Outline + diff widgets (for MCP work)

Both render via `visualize:show_widget` — same `read_me` prerequisite, same `title` / `loading_messages` parameters. The widget IS the response shape; don't fall back to plain Markdown unless `show_widget` is genuinely unavailable.

### Outline widget

After `get_outline` returns three or more entries. (For fewer than 3, use the `summary` field and answer in 1–2 conversational sentences.)

Substitute `{{HEADING_ITEMS}}` with one item per heading:

```html
<style>
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap');
  .prose-outline {
    --bg: #ffffff; --text: #1a1a1a; --border: #e4e4e7; --muted: #71717a;
    font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13px; line-height: 1.6; color: var(--text); max-width: 720px;
  }
  @media (prefers-color-scheme: dark) {
    .prose-outline { --bg: #18181b; --text: #fafafa; --border: #3f3f46; --muted: #a1a1aa; }
  }
  .prose-outline__card { border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; background: var(--bg); }
  .prose-outline__label { font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 10px; }
  .prose-outline__item { padding: 3px 0; color: var(--text); font-size: 13px; }
</style>
<div class="prose-outline">
  <div class="prose-outline__card">
    <div class="prose-outline__label">Outline</div>
    {{HEADING_ITEMS}}
  </div>
</div>
```

Per-heading item — `INDENT` = `(level - 1) * 16`, `TEXT` = HTML-escape:

```html
<div class="prose-outline__item" style="padding-left: {{INDENT}}px;">{{TEXT}}</div>
```

### Diff widget (batch summary)

**One widget per `suggest_edit` batch — not one per edit.** Whether you queued 1 edit or 12, render exactly one of these widgets at the end of the batch, with one row per edit. The Prose review overlay is the detailed accept/reject surface; this widget is the chat-side summary so the user can see at a glance what was proposed.

Each row is a 3-column grid: edit number | original text | suggested text. **Show the full text on each side** — no truncation. The user wants to see what was proposed; truncation forces them to context-switch to Prose just to read.

Substitute `{{COUNT}}` with the number of edits and `{{ROWS}}` with one row per edit:

```html
<style>
  .prose-edits {
    color: var(--color-text-primary, #1a1a1a);
    background: var(--color-background-primary, #ffffff);
    border: 1px solid var(--color-border-secondary, #e4e4e7);
    border-radius: var(--border-radius-md, 8px);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px; line-height: 1.5; padding: 14px; max-width: 900px;
  }
  .prose-edits__hd { font-weight: 600; margin-bottom: 10px; font-size: 13px; }
  .prose-edits__row {
    display: grid; grid-template-columns: 1.5em 1fr 1fr; gap: 8px;
    padding: 8px 0; border-top: 1px solid var(--color-border-secondary, #e4e4e7);
    align-items: start;
  }
  .prose-edits__row:first-of-type { border-top: 0; padding-top: 0; }
  .prose-edits__n { color: var(--color-text-tertiary, #71717a); font-size: 11px; padding-top: 4px; }
  .prose-edits__from, .prose-edits__to {
    padding: 6px 8px; border-radius: 4px;
    overflow-wrap: break-word; min-width: 0;
  }
  .prose-edits__from { background: rgba(239,68,68,0.12); text-decoration: line-through; text-decoration-thickness: 1px; }
  .prose-edits__to { background: rgba(34,197,94,0.12); }
  .prose-edits__ft { color: var(--color-text-tertiary, #71717a); margin-top: 10px; font-size: 11px; }
</style>
<div class="prose-edits">
  <div class="prose-edits__hd">{{COUNT}} edits proposed</div>
  {{ROWS}}
  <div class="prose-edits__ft">Accept or reject each in Prose's diff overlay.</div>
</div>
```

Per-row template — `{{N}}` is the edit number (1, 2, 3...), `{{FROM}}` and `{{TO}}` are the full original and suggested text, both HTML-escaped:

```html
<div class="prose-edits__row"><span class="prose-edits__n">{{N}}.</span><span class="prose-edits__from">{{FROM}}</span><span class="prose-edits__to">{{TO}}</span></div>
```

After the widget, one short conversational line is enough — *"Review them in Prose's diff overlay."* Don't restate the edits in prose; the widget already lists them.

## Editing nodes (suggest_edit workflow)

`suggest_edit` is node-targeted. Workflow: `read_document` → pick the nodes → call `suggest_edit` for each one (with both `nodeId` and `search`). **Fire all your edits in a single response** — each call adds an independent suggestion mark to the document, and the user reviews the whole batch in Prose's review UI. Don't synchronously wait for the user to accept/reject between calls; just queue them and return.

**Render exactly one diff summary widget at the end of the batch.** Use the *Diff widget (batch summary)* template above — one widget regardless of edit count, with one row per `suggest_edit` call. This is a hard rule: never close out a batch without the summary widget; the user has no chat-side visibility into what you proposed otherwise. The Prose review overlay is the detailed accept/reject surface; the widget is the recognizability surface. Both matter.

Prefer minimal diffs (smallest containing node). For heading edits, verify the heading text verbatim against `get_outline` first. If `suggest_edit` returns "no match", re-read the document and retry with a fresh `nodeId`.

## Graceful degradation

| Condition | Behavior |
|-----------|----------|
| Prose running, MCP connected | Full assistance. |
| Prose running, MCP not installed (OSS build) | "Open Prose → Settings → Integrations → Install MCP Server, then restart Claude." |
| Mac App Store build | Sandbox blocks MCP. Offer pasted content. Don't suggest install. |
| Prose not running | Suggest launching, or work with pasted content. |
| `show_widget` unavailable on this surface | Outline → nested Markdown list (use `level` for indent). Diff → describe in 1–2 sentences. |
