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

`read_document` returns `{ nodes: [{ id, type, content }, ...], markdown }`. The `id` is what `suggest_edit` targets via `nodeId`. `markdown` is the full document text if you need it without iterating nodes. **Note**: nodes carry `content`, not `text` — don't look for a `text` field.

`suggest_edit` returns `{ suggested: true, suggestionId }` on success.

## Side effects and limitations

- `create_and_open_file` and `open_file` switch the active document and dismiss any pending `suggest_edit` overlay. Order multi-tool flows accordingly: render the diff last if you want the user to land on it.
- `create_and_open_file` saves to Prose's configured default save location (typically `~/Documents`). The `filename` parameter is just a name, not a path; if it collides, Prose auto-suffixes (`Untitled.md` → `Untitled 2.md`).
- The MCP exposes only the 5 tools above — there is **no** "get current file path" tool. If you need the active document's path (e.g., to switch back after `create_and_open_file`), ask the user or use a path they've already mentioned. Don't guess.
- `get_outline` and `read_document` are read-only; safe to call any time without disturbing UI state.

## Editing

`suggest_edit` is **node-targeted**. Parameters:

- `nodeId` (**required**) — from `read_document`.
- `content` (**required**) — replaces the node's *entire* content.
- `comment` (optional) — short rationale shown in the diff UI (≤ 20 words).
- `search` (optional but recommended) — the original node text. Pass it whenever you have it; the server uses it as a text-match fallback if `nodeId` is stale.

Workflow: `read_document` → pick the node → `suggest_edit` with both `nodeId` and `search`. One call per turn — Prose's overlay handles one suggestion at a time. Don't loop waiting for accept/reject; just return.

If `suggest_edit` returns "node not found" / "no match", call `read_document` again, locate the node by its current text, and retry with the fresh `nodeId`.

Prefer minimal diffs — replace the smallest node that contains the change. When restructuring or editing headings, verify heading text verbatim against `get_outline` first.

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
