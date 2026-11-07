/**
 * Server-level guidance sent to every MCP client (`instructions` in the
 * `initialize` and `server/discover` results). Client-neutral on purpose:
 * client-specific behaviour (widgets, install steps) stays in the Claude
 * skill (`resources/prose-skill/prose/SKILL.md`).
 */
export const PROSE_MCP_INSTRUCTIONS = [
  "Prose is a markdown editor running on the writer's computer; these tools work on the documents open in it.",
  '',
  '- The writer decides. suggest_edit proposes a change the writer accepts or rejects in Prose, and add_comment leaves a note on the text. ' +
    "Only create_and_open_file writes a file by itself (always a new one).",
  '- Read before you suggest: call read_document for node ids (get_outline for just the headings), then suggest_edit with the ' +
    'innermost nodeId and the original text in search.',
  "- Tools act on the active tab. When the writer names another document, call list_tabs, then select_tab; don't guess a path. " +
    'open_file, select_tab and create_and_open_file change the active document, so finish work on the current one first.',
  '- list_comments shows existing threads and resolve_comment closes one. Do not add a second comment on text that already has a thread.',
  "- Table cells and plain-text (.txt) documents can't take suggestions: comment instead, or offer a .md copy.",
  "- Results carry structuredContent matching each tool's outputSchema, plus the same data as text."
].join('\n')
