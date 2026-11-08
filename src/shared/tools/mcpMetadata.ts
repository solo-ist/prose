/**
 * What the MCP surface says about each tool beyond the shared registry: a
 * display title, behaviour annotations, the shape of a successful result
 * (`outputSchema`, so clients can read `structuredContent`), and — where the
 * shared description names tools an MCP client cannot call — an MCP-specific
 * description. The in-app agent keeps the shared descriptions.
 *
 * The output schemas are deliberately permissive (extra properties allowed,
 * only the always-present fields required): clients validate
 * `structuredContent` against them, so a schema stricter than the executor
 * would turn a working call into a client-side error.
 */

export interface McpToolAnnotations {
  title: string
  readOnlyHint: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint: boolean
}

export interface McpToolMetadata {
  /** Replaces the shared description on the MCP surface. */
  description?: string
  annotations: McpToolAnnotations
  outputSchema: Record<string, unknown>
}

const string = { type: 'string' }
const number = { type: 'number' }
const boolean = { type: 'boolean' }

function object(properties: Record<string, unknown>, required: string[]): Record<string, unknown> {
  return { type: 'object', properties, required }
}

const documentNode = object(
  { id: string, type: string, content: string, children: { type: 'array', items: { type: 'object' } } },
  ['id', 'type', 'content']
)

const commentEntry = object(
  {
    id: string,
    markedText: string,
    comment: string,
    createdAt: number,
    from: number,
    to: number,
    replies: { type: 'array', items: { type: 'object' } },
    resolved: boolean,
    anchorLost: boolean
  },
  ['id', 'comment']
)

const tabSummary = object(
  {
    tabId: string,
    title: string,
    path: { type: ['string', 'null'] },
    isActive: boolean,
    isDirty: boolean,
    isPreview: boolean,
    documentId: string
  },
  ['tabId', 'title', 'isActive']
)

const optionalText = { type: ['string', 'null'] }

const suggestionEntry = object(
  {
    id: string,
    status: string,
    originalText: optionalText,
    suggestedText: optionalText,
    explanation: optionalText,
    createdAt: number,
    by: string,
    byKind: string,
    feedback: { type: 'array', items: { type: 'object' } },
    revises: string,
    supersededBy: string,
    decidedBy: string,
    decidedAt: number
  },
  ['id', 'status']
)

const reviewEvent = object(
  {
    seq: number,
    at: number,
    kind: string,
    by: string,
    byKind: string,
    suggestionId: string,
    previousId: string,
    threadId: string,
    replyId: string
  },
  ['seq', 'kind']
)

export const MCP_TOOL_METADATA: Record<string, McpToolMetadata> = {
  read_document: {
    description:
      'Get a document as a structured node tree, each node with a unique ID: the active tab, or the open document `document` ' +
      'names. Returns { nodes: DocumentNode[], markdown }. ' +
      'DocumentNode shape: { id, type, content, children?: DocumentNode[] }. Container nodes (blockquote, bulletList, orderedList, ' +
      'listItem, taskItem) carry a children array with their nested nodes; their content is the concatenated text of all descendants. ' +
      'Leaf nodes (paragraph, heading, codeBlock) have no children. A table appears as one node of type \'table\' with an empty id: its ' +
      'content is the whole table as GFM, and its children are the paragraphs inside its cells. Tables cannot take suggestions; ' +
      'comment on them instead. Node IDs are required for suggest_edit and add_comment — always target the most specific (innermost) ' +
      'node, not a container, and pass the same `document` you read. If the document has frontmatter, a synthetic node with id: \'frontmatter\', type: \'frontmatter\' is ' +
      'prepended to the nodes array — call suggest_edit with nodeId: \'frontmatter\' and the COMPLETE new YAML (with or without --- ' +
      'fences) to propose frontmatter changes; do not try to address individual fields.',
    annotations: { title: 'Read document', readOnlyHint: true, openWorldHint: false },
    outputSchema: object({ nodes: { type: 'array', items: documentNode }, markdown: string }, ['nodes', 'markdown'])
  },
  get_outline: {
    annotations: { title: 'Get outline', readOnlyHint: true, openWorldHint: false },
    outputSchema: object(
      { outline: { type: 'array', items: object({ level: number, text: string, line: number }, ['level', 'text']) }, summary: string },
      ['outline']
    )
  },
  list_comments: {
    annotations: { title: 'List comments', readOnlyHint: true, openWorldHint: false },
    outputSchema: object({ comments: { type: 'array', items: commentEntry } }, ['comments'])
  },
  add_comment: {
    annotations: { title: 'Add comment', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    outputSchema: object({ id: string }, ['id'])
  },
  resolve_comment: {
    annotations: { title: 'Resolve comment', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    outputSchema: object({ resolved: boolean }, ['resolved'])
  },
  suggest_edit: {
    description:
      'Create an inline diff suggestion on a node. The writer sees a highlighted comparison in Prose and accepts or rejects it. ' +
      'Use read_document first to get node IDs. Always include the search parameter with the original text for reliability. ' +
      'Block-type conversion is supported: content opening with block markup (e.g. "# Title", "> quote", "- item") on a top-level ' +
      'paragraph or heading converts the node to that type when accepted. Not supported: table cells (returns ' +
      'TABLE_NODE_NOT_SUPPORTED — add a comment on the table instead) and plain-text .txt documents (returns PLAIN_TEXT_DOCUMENT — ' +
      'create a .md copy via create_and_open_file instead).',
    annotations: { title: 'Suggest edit', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    outputSchema: object({ suggested: boolean, suggestionId: string }, ['suggested', 'suggestionId'])
  },
  open_file: {
    annotations: { title: 'Open file', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    outputSchema: object({ opened: boolean, path: string }, ['opened', 'path'])
  },
  create_and_open_file: {
    description:
      'Create a new markdown file in the default documents directory, save it to disk, and open it in Prose. The file is ' +
      'immediately saved (not just opened in memory) and will appear in the default save location. If filename already exists, ' +
      'automatically increments (e.g., "Untitled.md" → "Untitled 2.md"); an existing file is never overwritten.',
    annotations: { title: 'Create and open file', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    outputSchema: object({ path: string, opened: boolean }, ['path', 'opened'])
  },
  list_tabs: {
    annotations: { title: 'List tabs', readOnlyHint: true, openWorldHint: false },
    outputSchema: object({ tabs: { type: 'array', items: tabSummary } }, ['tabs'])
  },
  select_tab: {
    annotations: { title: 'Select tab', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    outputSchema: object({ selected: boolean, tabId: string, title: string, path: { type: ['string', 'null'] } }, ['selected', 'tabId'])
  },
  // The review lifecycle (#890): agents propose, revise and discuss; the writer decides in Prose.
  reply_to_comment: {
    annotations: { title: 'Reply to comment', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    outputSchema: object({ replyId: string }, ['replyId'])
  },
  reopen_comment: {
    annotations: { title: 'Reopen comment', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    outputSchema: object({ reopened: boolean }, ['reopened'])
  },
  list_suggestions: {
    annotations: { title: 'List suggestions', readOnlyHint: true, openWorldHint: false },
    outputSchema: object({ suggestions: { type: 'array', items: suggestionEntry } }, ['suggestions'])
  },
  reply_to_suggestion: {
    annotations: { title: 'Reply to suggestion', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    outputSchema: object({ suggestionId: string }, ['suggestionId'])
  },
  revise_suggestion: {
    annotations: { title: 'Revise suggestion', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    outputSchema: object({ suggestionId: string, revises: string }, ['suggestionId', 'revises'])
  },
  get_review_status: {
    annotations: { title: 'Get review status', readOnlyHint: true, openWorldHint: false },
    outputSchema: object(
      {
        pending: { type: 'array', items: string },
        accepted: number,
        rejected: number,
        superseded: number,
        openComments: number,
        lastSeq: number
      },
      ['pending', 'lastSeq']
    )
  },
  list_review_events: {
    annotations: { title: 'List review events', readOnlyHint: true, openWorldHint: false },
    outputSchema: object({ events: { type: 'array', items: reviewEvent }, nextSeq: number, more: boolean }, ['events', 'nextSeq'])
  }
}
