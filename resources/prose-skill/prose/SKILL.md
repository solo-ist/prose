---
name: prose
description: Use Prose's MCP tools (get_outline, read_document, suggest_edit, open_file, create_and_open_file) to read, outline, and propose edits to the document the user has open in Prose. Activates when the user asks to edit, restructure, summarize, read, get an outline of, look at, or work on a document in Prose, or when Prose MCP tools are available in the session.
---

# Prose

Prose is a focused Markdown editor for macOS with native Claude integration via MCP (Model Context Protocol). This skill drives Prose from a Claude conversation: outlining documents, reading content, and proposing inline edits the user can accept or reject in the diff UI.

## Availability check

At session start (or when this skill first activates), call `get_outline` with no arguments as a connectivity probe:

- **Returns an outline** → Prose is running with MCP connected. Proceed.
- **"tool not found" / not in toolset** → MCP isn't installed. Tell the user: open Prose → Settings → Integrations → click "Install MCP Server", then restart Claude.
- **Error: server not reachable / connection refused** → MCP is installed but Prose isn't running. Ask the user to launch Prose, or offer to work with pasted content.
- **Mac App Store build of Prose** → MCP is unavailable by sandbox design. Explain this and offer to work with pasted content. Do not attempt install instructions.

Never silently underperform. If MCP isn't usable, surface why and offer an alternative.

## Tools

| Tool | Purpose |
|------|---------|
| `get_outline` | Returns document headings as a structured list. With no arguments, also serves as a connectivity probe. |
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

1. `get_outline` — confirm MCP, learn document structure.
2. `read_document` — get node IDs and current text.
3. Identify the target node by its `text` and structural position.
4. `suggest_edit` with both `nodeId` and `search` (the original node text).
5. Wait for the user to accept or reject in Prose's diff UI before queueing another edit.

## Rendering — widgets are the response shape

Prose ships two HTML widget templates in `assets/`. **The widget IS the response shape for outlines and diffs — not an optional enhancement.** Do not fall back to a Markdown list because the widget feels heavy or because Markdown is "simpler." Only fall back when `show_widget` is genuinely unavailable on this surface (every variant returns "tool not found").

Both templates are static HTML — `show_widget` does not execute callbacks, so do not add `onclick` handlers. The diff widget tells the user where to accept the change inline (in Prose's overlay).

### Outline widget

**When**: after `get_outline` returns three or more entries, render the result as a widget instead of a Markdown list.

**How**:

1. Read the file at `assets/outline.html` (sibling to this SKILL.md). On surfaces that mount skills under `/mnt/skills/user/<skill-name>/`, the absolute path is `/mnt/skills/user/prose/assets/outline.html`.
2. Build the heading items by iterating the `outline` array from the response. For each entry `{level, text, line}`, emit one item using the template inside the HTML comment at the bottom of the file:
   - `INDENT` = `(level - 1) * 16`
   - `TEXT` = HTML-escape the heading's `text` (`& < > "`)
3. Build `{{PROSE_URL}}` = `prose://open?content=` + `encodeURIComponent` of the outline rendered as Markdown headings (one per line, `#` × `level` + space + text). Cap content at 5MB.
4. Substitute the heading items for `{{HEADING_ITEMS}}` and the URL for `{{PROSE_URL}}` in the outer template.
5. Call `show_widget` (or `visualize:show_widget`) with the resulting HTML as the only argument.

For documents with **fewer than 3 headings**, do not render the widget. Use the `summary` field from the response and answer in one or two conversational sentences.

### Diff widget

**When**: after `suggest_edit` returns `{ suggested: true, suggestionId }`, render the diff as a widget. Do this every time, not just for "interesting" edits.

**How**:

1. Read `assets/diff.html` (or `/mnt/skills/user/prose/assets/diff.html` on mounted surfaces).
2. Compute an inline word-level diff between the original node text and your new `content`. The widget shows both texts in full, side-by-side, with the parts that differ highlighted in place — so the eye can skim the unchanged surrounding text and land on what changed.
3. Substitute four placeholders:
   - `{{COMMENT_BLOCK}}` — empty string if no `comment` was passed to `suggest_edit`. If a comment was passed, render `<div class="prose-diff__comment">{{COMMENT}}</div>` with `{{COMMENT}}` HTML-escaped.
   - `{{OLD_TEXT}}` — the **full original** text (HTML-escape `& < > "` first), then wrap each removed run with `<span class="prose-diff__removed">…</span>`. Unchanged surrounding text stays unmarked.
   - `{{NEW_TEXT}}` — the **full new** text (HTML-escape first), then wrap each added run with `<span class="prose-diff__added">…</span>`. Unchanged text stays unmarked and matches the unmarked text in `{{OLD_TEXT}}` exactly.
   - `{{PROSE_URL}}` — `prose://open?content=` + `encodeURIComponent` of the **plain** new text (no diff-markup spans, no HTML escaping — just the raw text the user would see if they accepted). Cap at 5MB; truncate longer content and append `[truncated]` before encoding.
4. Call `show_widget` with the resulting HTML.

The widget includes an "Open in Prose" deep-link button that opens the suggested content in a new Prose tab via the `prose://` URL scheme. The hint next to it directs the user to accept/reject in Prose's diff overlay (where MCP put the suggestion). Don't add other buttons — Prose's MCP does not expose a programmatic accept tool, so any button claiming to do that would be a lie.

**Diff granularity**: word-level (treat a "word" as a contiguous run of word characters or a contiguous run of punctuation). Don't mark character-level differences inside a word — for `integraton` → `integration`, mark the whole word in each column rather than just the missing `i`. For whole-paragraph rewrites where every word changed, marking the entire text as one span is acceptable.

After rendering the widget, in the conversational reply, briefly state what the change does (one sentence). Then wait for the user.

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
