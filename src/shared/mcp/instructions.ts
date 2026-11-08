/**
 * Server-level guidance sent to every MCP client (`instructions` in the
 * `initialize` and `server/discover` results). Client-neutral on purpose:
 * client-specific behaviour (widgets, install steps) stays in the Claude
 * skill (`resources/prose-skill/prose/SKILL.md`).
 */
export const PROSE_MCP_INSTRUCTIONS = [
  "Prose is a markdown editor running on the writer's computer; these tools work on the documents open in it.",
  '',
  '- The writer decides. You propose (suggest_edit), revise (revise_suggestion) and discuss (reply_to_suggestion, add_comment, ' +
    'reply_to_comment); the writer accepts or rejects in Prose. No tool accepts or rejects for them. ' +
    "Only create_and_open_file writes a file by itself (always a new one).",
  '- Follow the outcome through list_review_events: get_review_status gives the latest seq, and list_review_events with ' +
    '`since` returns what happened after it (accepted, rejected, feedback, replies). Decisions take as long as the writer ' +
    'needs, so poll later instead of waiting inside a call.',
  '- After a rejection, revise_suggestion on the rejected id proposes again on the same paragraph and links the two; the ' +
    'rejection stays in the history. An accepted suggestion is final: use suggest_edit for any further change.',
  '- Read before you suggest: call read_document for node ids (get_outline for just the headings), then suggest_edit with the ' +
    'innermost nodeId and the original text in search.',
  "- Document tools act on the active tab unless you pass `document` (a documentId or path from list_tabs) to work on another " +
    "open document; targeting never changes the tab the writer sees. Don't guess a path: call list_tabs. " +
    'open_file, select_tab and create_and_open_file do switch the active tab, so use them when the writer wants to see that document.',
  '- list_comments shows the threads: reply_to_comment continues one, resolve_comment closes it, reopen_comment brings it back. ' +
    'Do not add a second comment on text that already has a thread.',
  "- Table cells and plain-text (.txt) documents can't take suggestions: comment instead, or offer a .md copy.",
  "- Results carry structuredContent matching each tool's outputSchema, plus the same data as text."
].join('\n')
