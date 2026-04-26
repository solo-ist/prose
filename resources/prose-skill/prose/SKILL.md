---
name: prose
description: Use Prose's MCP tools (get_outline, read_document, suggest_edit, open_file, create_and_open_file) to read, outline, and propose edits to the document the user has open in Prose. Activates when the user asks to edit, restructure, summarize, get an outline of, or work on a document in Prose, or when Prose MCP tools are available in the session.
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

## Widget rendering

When `show_widget` is available on the current Claude surface (Claude Code, claude.ai web, Claude Desktop Cowork on supported builds), render select MCP responses as interactive widgets. When it isn't available, fall back to the same information rendered as plain prose or fenced code.

### Outline navigator widget

Render after `get_outline` returns **3 or more headings**. Skip the widget for shorter outlines — describe the structure in text instead.

```jsx
const headings = outline.headings; // [{ text, level, nodeId }, ...]

<div style={{
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--text-sm)',
  color: 'var(--color-text-primary)'
}}>
  <div style={{
    fontWeight: 600,
    marginBottom: 8,
    color: 'var(--color-text-secondary)'
  }}>
    Document Outline
  </div>
  {headings.map((h) => (
    <button
      key={h.nodeId ?? h.text}
      className="interactive"
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        paddingLeft: (h.level - 1) * 16,
        padding: '4px 8px',
        borderRadius: 4,
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: 'var(--color-text-primary)'
      }}
      onClick={() => sendPrompt(
        `Read the section under heading ${JSON.stringify(h.text)} and summarize it.`
      )}
    >
      {h.text}
    </button>
  ))}
</div>
```

`JSON.stringify(h.text)` defends against headings that contain quotes, backticks, or backslashes.

### Before/after diff widget

Render after `suggest_edit` returns successfully. The tool returns `{ suggested: true, suggestionId }`.

**Important:** the actual accept or reject happens in Prose's diff UI, not via this widget. Prose's MCP does not expose a programmatic accept tool. The widget's buttons signal Claude's *next conversational turn* — they don't apply or revert the edit. Make this clear in the widget copy.

The widget needs four values that aren't all in the `suggest_edit` response — assemble them from the call context:

- **`oldText`** — the original node text. Use the node's `text` field from your most recent `read_document`, or the `search` argument you passed to `suggest_edit`.
- **`newText`** — the `content` argument you passed to `suggest_edit`.
- **`comment`** — the optional `comment` argument you passed (or omit if none).
- **`suggestionId`** — from the `suggest_edit` response (`{ suggested: true, suggestionId }`).

```jsx
const { oldText, newText, comment, suggestionId } = edit;

<div style={{
  fontFamily: 'var(--font-mono, monospace)',
  fontSize: 'var(--text-sm)',
  borderRadius: 8,
  overflow: 'hidden',
  border: '1px solid var(--color-border)'
}}>
  {comment && (
    <div style={{
      padding: '8px 12px',
      background: 'var(--color-surface-secondary)',
      fontSize: 'var(--text-xs)',
      color: 'var(--color-text-secondary)'
    }}>
      {comment}
    </div>
  )}
  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
    <div style={{
      padding: 12,
      background: 'var(--color-diff-removed-bg, #fef2f2)',
      borderRight: '1px solid var(--color-border)'
    }}>
      <div style={{
        color: 'var(--color-diff-removed, #ef4444)',
        fontSize: 'var(--text-xs)',
        fontWeight: 600,
        marginBottom: 4
      }}>
        Before
      </div>
      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--color-text-primary)' }}>
        {oldText}
      </pre>
    </div>
    <div style={{
      padding: 12,
      background: 'var(--color-diff-added-bg, #f0fdf4)'
    }}>
      <div style={{
        color: 'var(--color-diff-added, #22c55e)',
        fontSize: 'var(--text-xs)',
        fontWeight: 600,
        marginBottom: 4
      }}>
        After
      </div>
      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--color-text-primary)' }}>
        {newText}
      </pre>
    </div>
  </div>
  <div style={{
    display: 'flex',
    gap: 8,
    padding: '8px 12px',
    background: 'var(--color-surface)',
    borderTop: '1px solid var(--color-border)'
  }}>
    <button
      className="interactive"
      style={{
        padding: '4px 12px',
        borderRadius: 4,
        fontSize: 'var(--text-sm)',
        cursor: 'pointer',
        background: 'var(--color-accent)',
        color: 'white',
        border: 'none'
      }}
      onClick={() => sendPrompt(
        `The user wants to keep the suggestion with id ${JSON.stringify(suggestionId)}. Remind them to click the accept control in Prose's diff overlay, then ask what to change next.`
      )}
    >
      Looks good
    </button>
    <button
      className="interactive"
      style={{
        padding: '4px 12px',
        borderRadius: 4,
        fontSize: 'var(--text-sm)',
        cursor: 'pointer',
        background: 'none',
        border: '1px solid var(--color-border)',
        color: 'var(--color-text-primary)'
      }}
      onClick={() => sendPrompt(
        `The user rejected the suggestion with id ${JSON.stringify(suggestionId)}. Propose a different approach.`
      )}
    >
      Try again
    </button>
  </div>
</div>
```

Both buttons drive Claude's next turn. "Looks good" tells Claude the user intends to accept (and to continue the conversation); "Try again" tells Claude to revise. The actual edit is accepted or rejected in Prose's diff UI, not here.

### When not to render a widget

- Short conversational answers that aren't tool results.
- `get_outline` returns fewer than 3 headings — describe the structure in text.
- A `suggest_edit` retry after a targeting failure — don't widgetize a failed attempt.
- `show_widget` isn't available on the current surface — render the same info as plain Markdown.
- The user is rapidly iterating on edits and a widget per turn would be visual noise.

## Graceful degradation

| Condition | Behavior |
|-----------|----------|
| Prose running, MCP connected | Full assistance via MCP tools. |
| Prose running, MCP not installed (OSS build) | "Open Prose → Settings → Integrations → Install MCP Server, then restart Claude." |
| Mac App Store build of Prose | Sandbox blocks MCP. Offer pasted-content workflow. Don't suggest install. |
| Prose not running | Suggest launching, or work with pasted content. |
| `show_widget` unavailable on this surface | Plain Markdown rendering of the same information. |
