# Prose

Prose is a focused Markdown editor for macOS with native Claude integration via MCP (Model Context Protocol).

## When to use this skill

Use this skill when the user mentions Prose, has Prose MCP tools available (`read_document`, `get_outline`, `open_file`, `suggest_edit`, `create_and_open_file`), or asks for help editing documents in Prose.

## Availability check

At session start, use `get_outline` with no arguments as a cheap connectivity probe:

```
get_outline()
```

- **Success** → Prose is running with MCP connected. Proceed with document-aware assistance.
- **Tool not found** → MCP is not installed. Offer to guide the user through installation via Prose → Settings → Integrations → Install MCP.
- **Error: server not reachable** → Prose is not running. Suggest launching Prose, or offer to work with pasted content.
- **MAS (Mac App Store) build** → MCP is unavailable by design (sandbox restriction). Explain this and offer to work with pasted content. Never attempt install on MAS.

Never silently underperform. Always surface the limitation and offer an alternative.

## MCP tools

| Tool | Purpose |
|------|---------|
| `get_outline` | Returns document headings as a structured list. Also serves as a connectivity probe (call with no args). |
| `read_document` | Returns the full document content as Markdown. |
| `suggest_edit` | Proposes a text replacement. The user sees a diff and can accept or reject. |
| `open_file` | Opens a file at a given path in Prose. |
| `create_and_open_file` | Creates a new file with content and opens it in Prose. |

## Critical: serialization mismatch

`read_document` returns **Markdown** — syntax like `**bold**`, `- item`, `## Heading` is present verbatim.

`suggest_edit` targets text by matching against the **rendered plain text** that the editor stores internally. These are not the same string.

**The failure mode:** you read `**important word**` from `read_document` and try to match `**important word**` in `suggest_edit`. The match fails silently — the edit doesn't apply.

**The fix:**
- When targeting formatted regions, strip Markdown syntax before constructing the `old_text` parameter. For `**important word**`, use `important word` as the search string.
- Prefer targeting longer, unique plain-text phrases to reduce false matches.
- If `suggest_edit` returns a targeting error, re-read the document and retry with a more literal plain-text match.

## Editing etiquette

- **One suggestion at a time.** Never fire multiple `suggest_edit` calls in parallel. Each suggestion opens a diff view in the Prose UI — parallel calls overwhelm the user and often conflict.
- **Read before editing.** Always call `read_document` (or use the outline) before suggesting edits to an unfamiliar document. Blind edits frequently miss context.
- **Prefer minimal diffs.** Replace only the specific sentence or phrase being changed. Rewriting entire paragraphs when only one clause needs changing is disruptive.
- **Verify targeting with `get_outline` first.** For structural edits (moving sections, editing headings), confirm the heading text verbatim from the outline before targeting.

## Suggest edit workflow

1. Call `get_outline` to confirm MCP is live and understand document structure.
2. Call `read_document` to get full content.
3. Identify the target text — strip Markdown syntax to get the plain-text form.
4. Call `suggest_edit` with the plain-text `old_text` and the replacement.
5. Wait for the user to accept or reject before making additional edits.

## Widget rendering

When Prose MCP tools return structured results, render them as interactive widgets using `show_widget` (available in Claude.ai, Claude Desktop, and Cowork). Fall back to plain text when `show_widget` is unavailable.

### Outline navigator widget

Render when `get_outline` returns **3 or more headings**:

```jsx
const headings = outline.headings; // array of { text, level, nodeId }

<div style={{
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--text-sm)',
  color: 'var(--color-text-primary)'
}}>
  <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--color-text-secondary)' }}>
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
      onClick={() => sendPrompt(`Read the "${h.text}" section and summarize it.`)}
    >
      {h.text}
    </button>
  ))}
</div>
```

Clicking a heading sends a prompt to read and summarize that section. The widget re-renders each turn; use plain text if the outline hasn't changed.

### Before/after diff widget

Render when `suggest_edit` proposes a change:

```jsx
const { oldText, newText, description } = edit;

<div style={{
  fontFamily: 'var(--font-mono, monospace)',
  fontSize: 'var(--text-sm)',
  borderRadius: 8,
  overflow: 'hidden',
  border: '1px solid var(--color-border)'
}}>
  {description && (
    <div style={{ padding: '8px 12px', background: 'var(--color-surface-secondary)', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
      {description}
    </div>
  )}
  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
    <div style={{ padding: 12, background: 'var(--color-diff-removed-bg, #fef2f2)', borderRight: '1px solid var(--color-border)' }}>
      <div style={{ color: 'var(--color-diff-removed, #ef4444)', fontSize: 'var(--text-xs)', fontWeight: 600, marginBottom: 4 }}>Before</div>
      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--color-text-primary)' }}>{oldText}</pre>
    </div>
    <div style={{ padding: 12, background: 'var(--color-diff-added-bg, #f0fdf4)' }}>
      <div style={{ color: 'var(--color-diff-added, #22c55e)', fontSize: 'var(--text-xs)', fontWeight: 600, marginBottom: 4 }}>After</div>
      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--color-text-primary)' }}>{newText}</pre>
    </div>
  </div>
  <div style={{ display: 'flex', gap: 8, padding: '8px 12px', background: 'var(--color-surface)', borderTop: '1px solid var(--color-border)' }}>
    <button className="interactive" style={{ padding: '4px 12px', borderRadius: 4, fontSize: 'var(--text-sm)', cursor: 'pointer', background: 'var(--color-accent)', color: 'white', border: 'none' }}
      onClick={() => sendPrompt('Accept this edit.')}>
      Accept in Prose
    </button>
    <button className="interactive" style={{ padding: '4px 12px', borderRadius: 4, fontSize: 'var(--text-sm)', cursor: 'pointer', background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
      onClick={() => sendPrompt('Reject this edit and try a different approach.')}>
      Reject
    </button>
  </div>
</div>
```

The accept/reject buttons drive follow-up turns via `sendPrompt`. The user still confirms in the Prose diff view — this widget is a preview.

### When not to render a widget

- The response is a short conversational answer (not a document operation result).
- `get_outline` returns fewer than 3 headings — just describe the structure in text.
- `suggest_edit` is being retried after a targeting error — don't show a widget for a failed attempt.
- `show_widget` is unavailable on the current surface — fall back to a plain Markdown diff fence.

## Artifact editor

For quick in-conversation edits to Markdown (without opening Prose), use the Prose artifact editor. It provides:
- Split edit/preview pane
- Persistent draft across conversation turns
- Light/dark toggle
- Copy and download as `.md`
- "Open in Prose" button to hand off to the desktop app

**When to suggest the artifact:**
- User wants to draft or tweak a short piece of Markdown without leaving the conversation.
- No active Prose document (MCP unavailable or document not yet saved).

**When to recommend desktop Prose instead:**
- Substantial new draft (>500 words).
- Structural reorganization of an existing document.
- Multi-file or folder work.
- User is already in Prose with MCP connected — edit there directly.

## Graceful degradation summary

| Condition | Behavior |
|-----------|----------|
| Prose running, MCP connected | Full assistance via MCP tools |
| Prose running, MCP not installed (OSS) | Offer to guide through Settings → Integrations → Install MCP |
| MAS build | Explain sandbox limitation, offer pasted-content workflow |
| Prose not running | Suggest launching, or offer artifact editor / pasted content |
| `show_widget` unavailable | Plain Markdown diff or prose description |
