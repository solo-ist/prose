---
name: prose
description: Use Prose's MCP tools (get_outline, read_document, suggest_edit, open_file, create_and_open_file) to read, outline, and propose edits to the document the user has open in Prose. Activates when the user asks to edit, restructure, summarize, read, get an outline of, look at, or work on a document in Prose, or when Prose MCP tools are available in the session.
---

# Prose

Prose is a focused Markdown editor for macOS with native Claude integration via MCP (Model Context Protocol). This skill drives Prose from a Claude conversation: outlining documents, reading content, and proposing inline edits the user can accept or reject in the diff UI.

## Connectivity

Don't probe before doing real work — your **first MCP call doubles as the connectivity check**. Make whatever call the user's request actually needs (`get_outline`, `read_document`, etc.) and read the response state:

- **Returns the expected payload** → Prose is running with MCP connected. Continue.
- **"tool not found" / not in toolset** → MCP isn't installed. Tell the user: open Prose → Settings → Integrations → click "Install MCP Server", then restart Claude.
- **Error: server not reachable / connection refused** → MCP is installed but Prose isn't running. Ask the user to launch Prose, or offer to work with pasted content.
- **Mac App Store build of Prose** → MCP is unavailable by sandbox design. Explain this and offer to work with pasted content. Don't attempt install instructions.

Never silently underperform. If MCP isn't usable, surface why and offer an alternative.

## Tools

| Tool | Purpose |
|------|---------|
| `get_outline` | Returns document headings as a structured list. |
| `read_document` | Returns the full document as a list of nodes. Each node has an `id` (use this for edit targeting), the node `type`, and its `text` content. |
| `suggest_edit` | Proposes a replacement for a single node. The user sees an inline diff in Prose and accepts or rejects there — Prose's MCP does not expose programmatic accept. |
| `open_file` | Opens an existing file in Prose by absolute path. |
| `create_and_open_file` | Creates a new file with given content at a given path and opens it in Prose. |

## Response shapes

`get_outline` returns:

```
{ outline: [{ level: number, text: string, line: number }, ...], summary?: string }
```

Each entry is a heading. `level` is 1–6 (H1–H6), `text` is the heading text, `line` is its approximate line number. The `summary` field appears only when the document has fewer than 3 headings.

`read_document` returns a list of nodes, each with `id`, `type`, and `text`. The `id` is what `suggest_edit` targets via `nodeId`.

`suggest_edit` returns `{ suggested: true, suggestionId }` on success.

## Editing — node IDs first

`suggest_edit` is **node-targeted**. Its parameters:

- `nodeId` (**required**) — the ID of the node to replace. Always get this from `read_document`.
- `content` (**required**) — the new content for that node. This replaces the node's *entire* content.
- `comment` (optional) — short rationale shown in the diff UI (≤ 20 words).
- `search` (optional fallback) — the original text of the node. Pass this whenever you have it. If the `nodeId` is stale (the user edited the document since you read it), the server falls back to text matching against `search`.

**Always pass both `nodeId` and `search`.** `nodeId` is the primary key; `search` is the safety net.

If `suggest_edit` returns a targeting error ("node not found", "no match"):

1. Call `read_document` again to get fresh node IDs.
2. Locate the node you intended to edit by its current text.
3. Retry with the fresh `nodeId`.

Do not try to construct edits without first reading the document. Blind edits frequently miss context and fail to target.

## Editing etiquette

- **One suggestion at a time.** Never fire multiple `suggest_edit` calls in parallel — each opens a diff overlay in Prose, and parallel calls overwhelm the UI and often conflict.
- **Read before editing.** Always call `read_document` (or at minimum `get_outline`) before suggesting edits to a document you haven't read this session.
- **Prefer minimal diffs.** If only a sentence needs changing, replace just that node. Rewriting a paragraph because of one clause is disruptive.
- **Verify structural changes against the outline.** When moving sections or editing headings, confirm heading text verbatim from `get_outline` first.

## Suggested edit workflow

1. `read_document` (or `get_outline` if you only need structure) — get node IDs and current text.
2. Identify the target node by its `text` and structural position.
3. `suggest_edit` with both `nodeId` and `search` (the original node text).
4. Wait for the user to accept or reject in Prose's diff UI before queueing another edit.

## Rendering — widgets are the response shape

Both widget templates are inlined below. **The widget IS the response shape for outlines and diffs — not an optional enhancement.** Do not fall back to a Markdown list because the widget feels heavy or because Markdown is "simpler." Only fall back when `show_widget` is genuinely unavailable on this surface (every variant returns "tool not found").

Templates are static HTML — `show_widget` does not execute callbacks, so do not add `onclick` handlers or buttons.

### Outline widget

**When**: after `get_outline` returns three or more entries. For fewer than 3 headings, use the `summary` field and answer in 1–2 conversational sentences.

**Outer template** — substitute `{{HEADING_ITEMS}}` with one item per heading:

```html
<style>
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap');
  .prose-outline {
    --bg: #ffffff; --text: #1a1a1a; --border: #e4e4e7; --muted: #71717a;
    font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13px; line-height: 1.6; color: var(--text);
    max-width: 720px; border: 1px solid var(--border); border-radius: 8px;
    padding: 14px 16px; background: var(--bg);
  }
  @media (prefers-color-scheme: dark) {
    .prose-outline { --bg: #18181b; --text: #fafafa; --border: #3f3f46; --muted: #a1a1aa; }
  }
  .prose-outline__label { font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 10px; }
  .prose-outline__item { padding: 3px 0; color: var(--text); font-size: 13px; }
</style>
<div class="prose-outline">
  <div class="prose-outline__label">Outline</div>
  {{HEADING_ITEMS}}
</div>
```

**Item template** — one per heading. `INDENT` = `(level - 1) * 16`. `TEXT` = HTML-escape `& < > "` in the heading text:

```html
<div class="prose-outline__item" style="padding-left: {{INDENT}}px;">{{TEXT}}</div>
```

Pass the substituted HTML to `show_widget` (or `visualize:show_widget`) as the only argument.

### Diff widget

**When**: after `suggest_edit` returns `{ suggested: true, suggestionId }`. Render every time, not just for "interesting" edits.

**Compute** an inline word-level diff between the original node text and your new `content`. Both texts appear in full, side-by-side, with only the differing word runs highlighted in place — the eye skims unchanged surrounding text and lands on what changed.

**Granularity**: word-level (a contiguous run of word characters or a contiguous run of punctuation). Don't mark character-level differences inside a word — for `integraton` → `integration`, mark the whole word, not just the missing `i`. For whole-paragraph rewrites where every word changed, marking the entire text as one span is acceptable.

**Template** — substitute `{{OLD_TEXT}}`, `{{NEW_TEXT}}`, `{{COMMENT_BLOCK}}`:

```html
<style>
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap');
  .prose-diff {
    --bg: #ffffff; --text: #1a1a1a; --border: #e4e4e7; --muted: #71717a; --surface: #f4f4f5;
    --removed-bg: #fecaca; --removed-fg: #7f1d1d;
    --added-bg: #bbf7d0; --added-fg: #14532d;
    font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13px; line-height: 1.55; color: var(--text); max-width: 820px;
  }
  @media (prefers-color-scheme: dark) {
    .prose-diff {
      --bg: #18181b; --text: #fafafa; --border: #3f3f46; --muted: #a1a1aa;
      --surface: rgba(255, 255, 255, 0.04);
      --removed-bg: rgba(239, 68, 68, 0.30); --removed-fg: #fecaca;
      --added-bg: rgba(34, 197, 94, 0.30); --added-fg: #bbf7d0;
    }
  }
  .prose-diff__columns { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
  .prose-diff__col { display: flex; flex-direction: column; min-width: 0; }
  .prose-diff__label { font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 8px; }
  .prose-diff__block { border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; background: var(--bg); flex: 1; }
  .prose-diff__text { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: inherit; font-size: 13px; color: var(--text); }
  .prose-diff__removed { background: var(--removed-bg); color: var(--removed-fg); text-decoration: line-through; text-decoration-thickness: 1px; padding: 0 2px; border-radius: 3px; }
  .prose-diff__added { background: var(--added-bg); color: var(--added-fg); padding: 0 2px; border-radius: 3px; }
  .prose-diff__comment { margin-bottom: 16px; padding: 10px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; font-size: 13px; color: var(--text); }
  .prose-diff__footer { font-size: 12px; color: var(--muted); }
</style>
<div class="prose-diff">
  <div class="prose-diff__columns">
    <div class="prose-diff__col">
      <div class="prose-diff__label">Original</div>
      <div class="prose-diff__block"><pre class="prose-diff__text">{{OLD_TEXT}}</pre></div>
    </div>
    <div class="prose-diff__col">
      <div class="prose-diff__label">Suggested</div>
      <div class="prose-diff__block"><pre class="prose-diff__text">{{NEW_TEXT}}</pre></div>
    </div>
  </div>
  {{COMMENT_BLOCK}}
  <div class="prose-diff__footer">Accept or reject in Prose's diff overlay.</div>
</div>
```

**Substitution rules**:

- `{{OLD_TEXT}}` — full original text (HTML-escape `& < > "`), then wrap each removed run with `<span class="prose-diff__removed">…</span>`. Unchanged surrounding text stays unmarked.
- `{{NEW_TEXT}}` — full new text (HTML-escape first), then wrap each added run with `<span class="prose-diff__added">…</span>`. Unchanged text stays unmarked and matches the unmarked text in `{{OLD_TEXT}}` exactly.
- `{{COMMENT_BLOCK}}` — empty string when no `comment` was passed to `suggest_edit`. When present:

  ```html
  <div class="prose-diff__comment">{{COMMENT}}</div>
  ```

  with `{{COMMENT}}` HTML-escaped.

Pass the substituted HTML to `show_widget`. Then in the conversational reply, briefly state what the change does (one sentence). Then wait for the user.

### When widgets really aren't available

If both `show_widget` and `visualize:show_widget` return "tool not found", render the same information as plain Markdown:

- Outline → nested list using `level` for indentation.
- Diff → describe the change in one or two sentences.

## Graceful degradation

| Condition | Behavior |
|-----------|----------|
| Prose running, MCP connected | Full assistance via MCP tools. |
| Prose running, MCP not installed (OSS build) | "Open Prose → Settings → Integrations → Install MCP Server, then restart Claude." |
| Mac App Store build of Prose | Sandbox blocks MCP. Offer pasted-content workflow. Don't suggest install. |
| Prose not running | Suggest launching, or work with pasted content. |
