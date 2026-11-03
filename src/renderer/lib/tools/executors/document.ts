/**
 * Document tool executors - read-only tools for accessing document content.
 */

import type { ToolResult, DocumentMetadata, TextMatch, OutlineEntry } from '../../../../shared/tools/types'
import { toolSuccess, toolError } from '../../../../shared/tools/types'
import { useEditorStore } from '../../../stores/editorStore'
import { useTabStore } from '../../../stores/tabStore'
import type { DocumentHandle } from '../../../document/handle'
import type { ToolContext } from '../context'
import { annotationsOf } from '../../../extensions/ai-annotations'
import { getNodesWithIds, findNodeById } from '../../../extensions/node-ids'
import type { NodeWithId } from '../../../extensions/node-ids'
import { getComments, findFullyCoveredCommentIds, threadsOf, countOpenThreads } from '../../../extensions/comments'
import type { CommentReply } from '../../../extensions/comments/types'
import { getAISuggestions } from '../../../extensions/ai-suggestions'
import { isEditorReadOnly } from './editor'
import { getApi } from '../../browserApi'
import { generateId } from '../../persistence'
import { dump as dumpYaml } from 'js-yaml'

/**
 * Node representation with ID for AI targeting.
 * Container nodes (tables, blockquotes, lists, listItems) include a `children`
 * array. A table entry has no id of its own; its children are its cells.
 * Leaf nodes omit `children`.
 */
interface DocumentNode {
  id: string
  type: string
  content: string
  children?: DocumentNode[]
}

/**
 * Convert a NodeWithId tree entry to a DocumentNode tree entry.
 *
 * A table's textContent runs every cell together, so its entry carries the
 * table as GFM instead: the model needs the current table to write the updated
 * one that `edit` takes on any of its cells (#1100).
 */
function toDocumentNode(n: NodeWithId, handle: DocumentHandle): DocumentNode {
  const node: DocumentNode = {
    id: n.nodeId,
    type: n.type,
    content: n.type === 'table' ? tableMarkdown(n, handle) : n.textContent,
  }
  if (n.children && n.children.length > 0) {
    node.children = n.children.map((child) => toDocumentNode(child, handle))
  }
  return node
}

function tableMarkdown(n: NodeWithId, handle: DocumentHandle): string {
  const table = handle.state.doc.nodeAt(n.pos)
  if (!table || table.type.name !== 'table') return n.textContent
  // read_document is on every edit's path: a table that won't serialize
  // degrades to its text rather than failing the whole read.
  try {
    const doc = handle.schema.topNodeType.create(null, table)
    return handle.markdown.serializer.serialize(doc).trim()
  } catch {
    return n.textContent
  }
}

/**
 * read_document - Get the document content with node IDs for targeting.
 *
 * Returns a structured tree of nodes with their IDs, allowing the AI to
 * target specific nodes by ID when making edits.
 */
export function executeReadDocument(ctx: ToolContext): ToolResult<{
  nodes: DocumentNode[]
  markdown: string
}> {
  const { handle } = ctx
  const store = useEditorStore.getState()

  if (!handle) {
    // Fallback to raw content if editor not available
    return toolSuccess({
      nodes: prependFrontmatterNode([], store.document.frontmatter, store.pendingFrontmatter),
      markdown: store.document.content
    })
  }

  // Get nodes with their IDs as a nested tree
  const nodesWithIds = getNodesWithIds(handle.state.doc)

  // Map to DocumentNode tree
  const nodes: DocumentNode[] = nodesWithIds.map((n) => toDocumentNode(n, handle))

  // The document as it is now, pending projections landed: the store mirror
  // lags the state by the projection delay, and a read right after an edit
  // in the same turn must see the edit (#1148).
  const { frontmatter, pendingFrontmatter } = documentFrontmatter(handle)
  return toolSuccess({
    nodes: prependFrontmatterNode(nodes, frontmatter, pendingFrontmatter),
    markdown: handle.serialize()
  })
}

/**
 * The document's frontmatter and dirty flag from its tab record (#1151); the
 * AI overlay is the shown document's only.
 */
function documentFrontmatter(handle: DocumentHandle): {
  frontmatter: Record<string, unknown>
  pendingFrontmatter: Record<string, unknown> | null
  isDirty: boolean
} {
  const tab = useTabStore.getState().getTabById(handle.tabId)
  return {
    frontmatter: tab?.frontmatter ?? {},
    pendingFrontmatter: handle.isActive ? useEditorStore.getState().pendingFrontmatter : null,
    isDirty: tab?.isDirty ?? false
  }
}

/**
 * Prepend a synthetic { id: 'frontmatter' } node to the document tree when
 * the document has frontmatter (committed) or a pending overlay. Lets MCP
 * consumers target the frontmatter block via suggest_edit with
 * nodeId: 'frontmatter' (Option C, #488).
 */
function prependFrontmatterNode(
  nodes: DocumentNode[],
  frontmatter: Record<string, unknown>,
  pendingFrontmatter: Record<string, unknown> | null
): DocumentNode[] {
  const active = pendingFrontmatter ?? frontmatter
  if (!active || Object.keys(active).length === 0) return nodes

  // Serialize as YAML so the agent sees the keys it can address. If dump
  // somehow throws on in-memory data (it shouldn't, but defensively), skip
  // the synthetic node entirely rather than emitting a broken `---\n\n---`
  // block that would mislead the agent.
  let yamlBody: string
  try {
    yamlBody = dumpYaml(active, { lineWidth: -1, quotingType: '"', forceQuotes: false }).trimEnd()
  } catch {
    return nodes
  }

  return [
    {
      id: 'frontmatter',
      type: 'frontmatter',
      content: `---\n${yamlBody}\n---`,
    },
    ...nodes,
  ]
}

/**
 * read_selection - Get the currently selected text and its position.
 * Falls back to cached selection if the live selection is empty
 * (e.g., when chat input has stolen focus).
 */
export function executeReadSelection(ctx: ToolContext): ToolResult<{
  text: string
  from: number
  to: number
  isEmpty: boolean
}> {
  const { handle } = ctx

  if (!handle) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  const { from, to, empty } = handle.state.selection

  // Try live selection first
  if (!empty) {
    const text = handle.state.doc.textBetween(from, to)
    return toolSuccess({
      text,
      from,
      to,
      isEmpty: false
    })
  }

  // Fall back to cached selection (preserved when editor loses focus); the
  // cache is the shown document's.
  const cached = handle.isActive ? useEditorStore.getState().getLastSelection() : null
  if (cached && cached.text) {
    return toolSuccess({
      text: cached.text,
      from: cached.from,
      to: cached.to,
      isEmpty: false
    })
  }

  // No selection available
  return toolSuccess({
    text: '',
    from,
    to,
    isEmpty: true
  })
}

/**
 * get_metadata - Get document metadata.
 */
export async function executeGetMetadata(ctx: ToolContext): Promise<ToolResult<DocumentMetadata>> {
  const { handle } = ctx
  const fallback = useEditorStore.getState().document
  const document = handle
    ? { documentId: handle.documentId, path: handle.path, content: handle.serialize(), ...documentFrontmatter(handle) }
    : { documentId: fallback.documentId, path: fallback.path, content: fallback.content, frontmatter: fallback.frontmatter, isDirty: fallback.isDirty }

  const content = document.content
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0
  const characterCount = content.length
  const lineCount = content.split('\n').length

  // Open threads (anchor-lost ones included, as the status bar counts them), suggestions, annotations.
  const commentCount = handle ? countOpenThreads(threadsOf(handle.state)) : 0
  const pendingSuggestionCount = handle ? getAISuggestions(handle).length : 0
  const annotationCount = handle ? annotationsOf(handle.state).length : 0

  // File timestamps (only available for saved files in Electron)
  let createdAt: string | null = null
  let modifiedAt: string | null = null
  let fileSize: number | null = null

  if (document.path) {
    try {
      const api = getApi()
      const stats = await api.fileStat(document.path)
      if (stats.createdAt) {
        createdAt = stats.createdAt
        modifiedAt = stats.modifiedAt
        fileSize = stats.size
      }
    } catch {
      // File may not exist yet (unsaved)
    }
  }

  return toolSuccess({
    documentId: document.documentId,
    path: document.path,
    wordCount,
    characterCount,
    lineCount,
    frontmatter: document.frontmatter,
    isDirty: document.isDirty,
    commentCount,
    annotationCount,
    pendingSuggestionCount,
    createdAt,
    modifiedAt,
    fileSize
  })
}

/**
 * search_document - Find all occurrences of text or regex pattern.
 */
export function executeSearchDocument(args: {
  query: string
  regex?: boolean
  caseSensitive?: boolean
  maxResults?: number
}, ctx: ToolContext): ToolResult<{ matches: TextMatch[]; totalCount: number }> {
  const { handle } = ctx

  if (!handle) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  const { query, regex = false, caseSensitive = false, maxResults = 50 } = args

  if (!query) {
    return toolError('Query is required', 'INVALID_INPUT')
  }

  const matches: TextMatch[] = []
  const doc = handle.state.doc
  let totalCount = 0

  // Build text content with position mapping
  const textSegments: Array<{ text: string; docStart: number }> = []
  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      textSegments.push({ text: node.text, docStart: pos })
    }
  })

  // Create search pattern
  let pattern: RegExp
  try {
    if (regex) {
      pattern = new RegExp(query, caseSensitive ? 'g' : 'gi')
    } else {
      // Escape special regex characters for literal search
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      pattern = new RegExp(escaped, caseSensitive ? 'g' : 'gi')
    }
  } catch (e) {
    return toolError(`Invalid regex pattern: ${e}`, 'INVALID_REGEX')
  }

  // Search through text segments
  for (const segment of textSegments) {
    let match: RegExpExecArray | null
    pattern.lastIndex = 0 // Reset for each segment

    while ((match = pattern.exec(segment.text)) !== null) {
      totalCount++

      if (matches.length < maxResults) {
        const docFrom = segment.docStart + match.index
        const docTo = docFrom + match[0].length

        // Convert doc positions to line/column
        const fromPos = handle.state.doc.resolve(docFrom)
        const toPos = handle.state.doc.resolve(docTo)

        matches.push({
          text: match[0],
          range: {
            start: {
              line: fromPos.pos, // Simplified - using doc position
              column: 0
            },
            end: {
              line: toPos.pos,
              column: 0
            }
          },
          index: totalCount - 1
        })
      }
    }
  }

  // Trigger FindBar UI with the search term if we found matches
  if (matches.length > 0) {
    if (handle.isActive) window.dispatchEvent(new CustomEvent('search:show', { detail: { query } }))
  }

  return toolSuccess({ matches, totalCount })
}

/**
 * get_outline - Get the document structure as a list of headings.
 * When there are few headings (< 3), provides a summary instead.
 */
export function executeGetOutline(ctx: ToolContext): ToolResult<{ outline: OutlineEntry[]; summary?: string }> {
  const { handle } = ctx

  if (!handle) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  const outline: OutlineEntry[] = []
  let lineNumber = 1

  handle.state.doc.descendants((node, pos) => {
    // Track line numbers (approximate based on block nodes)
    if (node.isBlock && pos > 0) {
      lineNumber++
    }

    if (node.type.name === 'heading') {
      const level = node.attrs.level as number
      const text = node.textContent

      outline.push({
        level,
        text,
        line: lineNumber
      })
    }
  })

  // If few headings, provide a summary instead
  if (outline.length < 3) {
    const content = handle.serialize()
    const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0

    let summary = `Document has ${outline.length} heading${outline.length !== 1 ? 's' : ''}`
    if (outline.length > 0) {
      const headingList = outline.map(h => `${'  '.repeat(h.level - 1)}- ${h.text}`).join('\n')
      summary += `:\n\n${headingList}`
    }
    summary += `\n\nDocument contains ${wordCount} words.`

    return toolSuccess({ outline, summary })
  }

  return toolSuccess({ outline })
}

// ============================================================================
// Comment tools
// ============================================================================

/** Comment shape returned by list_comments (includes thread data). */
interface CommentEntry {
  id: string
  markedText: string
  comment: string
  createdAt: number
  from: number
  to: number
  replies: CommentReply[]
  resolved: boolean
  /** The thread's text was edited away; it is open but has no position (#1147). */
  anchorLost?: boolean
}

/**
 * list_comments - Get all comments in the active document.
 *
 * Merges the live editor marks (positions) with persisted thread data
 * (replies, resolved state) from the comment store so the AI gets the
 * full thread context.
 */
export function executeListComments(ctx: ToolContext): ToolResult<{ comments: CommentEntry[] }> {
  const { handle } = ctx

  if (!handle) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  // Live marks give us current positions; the document's threads (its own
  // state, #1147) hold replies + resolved state not carried by the mark.
  const liveMarks = getComments(handle)
  const threads = threadsOf(handle.state)

  const comments: CommentEntry[] = liveMarks.map((c) => {
    const thread = threads.find((p) => p.id === c.id)
    return {
      id: c.id,
      markedText: c.markedText,
      comment: c.comment,
      createdAt: c.createdAt,
      from: c.from,
      to: c.to,
      replies: thread?.replies ?? [],
      resolved: thread?.resolved ?? false,
    }
  })

  // Markless threads: resolved ones as history, anchor-lost open ones so the
  // model sees every open thread the status bar counts.
  const liveIds = new Set(liveMarks.map((c) => c.id))
  for (const p of threads) {
    if (liveIds.has(p.id)) continue
    comments.push({
      id: p.id,
      markedText: p.markedText,
      comment: p.comment,
      createdAt: p.createdAt,
      from: p.from,
      to: p.to,
      replies: p.replies ?? [],
      resolved: p.resolved === true,
      ...(p.resolved ? {} : { anchorLost: true }),
    })
  }

  return toolSuccess({ comments })
}

/**
 * add_comment - Add a comment mark to a node or explicit range.
 * The comment is tagged with author 'claude'.
 */
export function executeAddComment(args: {
  nodeId?: string
  from?: number
  to?: number
  comment: string
}, ctx: ToolContext): ToolResult<{ id: string }> {
  const { handle } = ctx

  if (!handle) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  if (isEditorReadOnly(handle)) {
    return toolError('Document is read-only in this mode', 'EDITOR_READ_ONLY')
  }

  const { nodeId, comment } = args
  let from = args.from
  let to = args.to

  if (!comment) {
    return toolError('comment text is required', 'INVALID_INPUT')
  }

  if (nodeId) {
    // Resolve range from nodeId
    const found = findNodeById(handle.state.doc, nodeId)
    if (!found) {
      return toolError(`Node with ID "${nodeId}" not found`, 'NODE_NOT_FOUND')
    }
    from = found.pos + 1
    to = found.pos + found.node.nodeSize - 1
  }

  if (from === undefined || to === undefined) {
    return toolError('Provide either nodeId or from/to positions', 'INVALID_INPUT')
  }

  if (from >= to) {
    return toolError('Cannot add a comment to an empty range — the targeted node has no text content', 'EMPTY_RANGE')
  }

  // Range may be non-empty in positions but contain no actual text content
  // (e.g., a paragraph with only a hardBreak, or whitespace-only). In that case
  // setComment would apply the mark to the boundary, which can bleed into the
  // preceding node. Require at least one non-whitespace character to attach to.
  const rangeText = handle.state.doc.textBetween(from, to, ' ')
  if (!rangeText.trim()) {
    return toolError('Cannot add a comment to an empty range — the targeted node has no text content', 'EMPTY_RANGE')
  }

  // nodeId targets resolve to the whole node, so repeat add_comment calls on
  // the same node produce exactly-equal ranges — which would silently replace
  // the existing thread's mark and orphan its store entry (#830). Surface the
  // existing thread so the model replies or resolves instead of duplicating.
  const covered = findFullyCoveredCommentIds(handle.state.doc, from, to)
  if (covered.length > 0) {
    return toolError(
      `A comment thread already covers this text (id "${covered[0]}"). Use reply_to_comment to continue that discussion, or resolve_comment to close it before adding a new comment.`,
      'COMMENT_EXISTS'
    )
  }

  const id = generateId()

  const success = handle
    .chain()
    .focus()
    .setTextSelection({ from, to })
    .setComment({ id, comment, author: 'ai' })
    .run()

  if (!success) {
    return toolError('Failed to apply comment mark — the range may not contain markable content', 'COMMENT_FAILED')
  }

  // setComment adds the thread in the mark's own transaction (#1147), so
  // reply_to_comment / resolve_comment find it by id at once.

  return toolSuccess({ id })
}

/**
 * resolve_comment - Mark a comment thread as resolved.
 *
 * Sets resolved:true on the thread and removes the editor mark, in one
 * transaction on the document (#1147). The thread remains as collapsed
 * history — it is not deleted.
 */
export function executeResolveComment(args: {
  id: string
}, ctx: ToolContext): ToolResult<{ resolved: boolean }> {
  const { handle } = ctx

  if (!handle) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  if (isEditorReadOnly(handle)) {
    return toolError('Document is read-only in this mode', 'EDITOR_READ_ONLY')
  }

  const { id } = args

  if (!id) {
    return toolError('Comment ID is required', 'INVALID_INPUT')
  }

  if (!threadsOf(handle.state).some((c) => c.id === id)) {
    return toolError(`Comment with ID "${id}" not found`, 'COMMENT_NOT_FOUND')
  }

  // Resolved and unmarked together; the session persists the thread and
  // pushes the resolve to a share (#769).
  handle.commands.resolveThread(id)

  return toolSuccess({ resolved: true })
}

/**
 * reply_to_comment - Append an AI reply to a comment thread.
 */
export function executeReplyToComment(args: {
  id: string
  text: string
}, ctx: ToolContext): ToolResult<{ replyId: string }> {
  const { handle } = ctx
  if (!handle) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }
  if (isEditorReadOnly(handle)) {
    return toolError('Document is read-only in this mode', 'EDITOR_READ_ONLY')
  }

  const { id, text } = args

  if (!id) {
    return toolError('Comment ID is required', 'INVALID_INPUT')
  }
  if (!text?.trim()) {
    return toolError('Reply text is required', 'INVALID_INPUT')
  }

  if (!threadsOf(handle.state).some((c) => c.id === id)) {
    return toolError(`Comment with ID "${id}" not found`, 'COMMENT_NOT_FOUND')
  }

  const reply: CommentReply = {
    id: generateId(),
    author: 'ai',
    text: text.trim(),
    createdAt: Date.now(),
  }

  // One transaction on the document; the session persists the thread and
  // pushes the reply to a share (#769).
  handle.commands.replyToThread(id, reply)

  return toolSuccess({ replyId: reply.id })
}
