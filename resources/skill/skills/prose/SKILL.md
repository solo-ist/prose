---
name: Prose
description: Use this skill when the user is working with the Prose markdown editor — reading, editing, or navigating documents via Prose MCP tools, or creating markdown content for Prose.
---

# Prose Skill

Prose is a focused markdown editor for macOS with an MCP server that lets you read and edit documents directly from a Claude conversation. This skill guides you on how to use Prose MCP tools effectively and when to use the Prose artifact editor.

## Session startup: connectivity check

Run `get_outline` with no arguments as a cheap probe at session start. If it returns an outline, Prose MCP is connected and you can proceed. Do not silently skip this check.

## Graceful degradation

Handle each case explicitly — never silently underperform:

- **Prose not running**: Suggest the user launch Prose, or offer to work with pasted content.
- **MCP not installed (OSS build)**: Route the user to Prose → Settings → Integrations → "Install MCP Server". Explain that this one-time step links Claude to the running app.
- **App Store build (MAS)**: MCP is unavailable by design due to sandboxing. Explain this clearly and offer to work with pasted content or the Prose artifact editor.

## Reading documents

- Use `get_outline` to get document structure (headings, node IDs) without reading the full content.
- Use `read_document` to fetch the full content of the active document.

**Serialization mismatch trap**: `read_document` returns markdown with syntax (`**bold**`, `- item`, `## heading`). Plain-text search against formatted content will fail. When targeting a specific passage, prefer node-ID targeting over text matching.

## Suggesting edits

Use `suggest_edit` to propose changes. Prose shows a diff UI — the user accepts or rejects each suggestion.

**One suggestion at a time**: Never fire multiple parallel `suggest_edit` calls. The diff UI handles one suggestion at a time; parallel calls overwhelm the UI.

**Node-ID targeting**: When editing a specific node (heading, paragraph, list item), use the node ID from `get_outline` or the document response. Node IDs survive formatting changes; text matches do not.

**Edit-targeting failures**: If `suggest_edit` fails to find the target, the most likely cause is markdown syntax in the match text. Strip formatting from the target and retry, or switch to node-ID targeting.

## Widget rendering (Claude Code and claude.ai)

When the `show_widget` tool is available, render interactive widgets for Prose MCP responses instead of paraphrasing them as plain text.

### Outline navigator (for `get_outline` with ≥3 headings)

Render a clickable tree view of the document headings. On click, call `sendPrompt("Read the '<heading>' section")` to navigate to that section.

```widget
type: outline-navigator
headings: <headings from get_outline response>
on_click: sendPrompt("Read the '<heading>' section")
style: imagine/interactive
```

### Before/after diff widget (for `suggest_edit`)

Render a side-by-side comparison of the original and proposed text, with Accept and Reject affordances. Drive follow-up turns via `sendPrompt("Accept the suggestion")` and `sendPrompt("Reject the suggestion")`.

```widget
type: diff
before: <original text>
after: <proposed text>
on_accept: sendPrompt("Accept the suggestion")
on_reject: sendPrompt("Reject the suggestion")
style: imagine/interactive
```

Use Imagine design system CSS variables for both widgets. Match chat aesthetics. No dark-mode breakage.

**When not to render a widget**: If the response is a simple text answer with no interactive value (e.g., "The document has 3 paragraphs"), skip the widget and respond in plain text.

## Artifact-based editing

For small tweaks to existing markdown inside a conversation, prefer the Prose artifact editor over MCP edits. The artifact is a quick-edit surface with live preview and a jump-to-desktop button.

Use the Prose artifact for:
- Quick edits to pasted or generated content
- Drafting short new documents
- Reviewing LLM-generated markdown before sending it to Prose

Recommend opening desktop Prose for:
- Substantial new drafts
- Structural reorganization
- Work that benefits from Prose's full feature set (AI review, spellcheck, file management, reMarkable sync)

To send artifact content to Prose, the user clicks "Open in Prose" in the artifact. Prose creates a new document from the content and focuses its window.
