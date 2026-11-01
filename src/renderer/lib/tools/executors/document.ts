/**
 * Document tool executors - read-only tools for accessing document content.
 */

import type { ToolResult, DocumentMetadata, TextMatch, OutlineEntry } from '../../../../shared/tools/types'
import { toolSuccess, toolError } from '../../../../shared/tools/types'
import { useEditorStore } from '../../../stores/editorStore'
import { resolveDocumentHandle, type DocumentHandle } from '../../../document/handle'
import { useAnnotationStore } from '../../../extensions/ai-annotations'
import { getNodesWithIds, findNodeById } from '../../../extensions/node-ids'
import type { NodeWithId } from '../../../extensions/node-ids'
import { getComments, useCommentStore, findFullyCoveredCommentIds } from '../../../extensions/comments'
import type { CommentReply } from '../../../extensions/comments/types'
import { getAISuggestions } from '../../../extensions/ai-suggestions'
import { pushReplyToShare, pushResolveToShare } from '../../sharePush'
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
export function executeReadDocument(): ToolResult<{
  nodes: DocumentNode[]
  markdown: string
}> {
  const handle = resolveDocumentHandle()
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

  return toolSuccess({
    nodes: prependFrontmatterNode(nodes, store.document.frontmatter, store.pendingFrontmatter),
    markdown: store.document.content
  })
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
export function executeReadSelection(): ToolResult<{
  text: string
  from: number
  to: number
  isEmpty: boolean
}> {
  const handle = resolveDocumentHandle()

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

  // Fall back to cached selection (preserved when editor loses focus)
  const cached = useEditorStore.getState().getLastSelection()
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
export async function executeGetMetadata(): Promise<ToolResult<DocumentMetadata>> {
  const handle = resolveDocumentHandle()
  const { document } = useEditorStore.getState()

  const content = document.content
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0
  const characterCount = content.length
  const lineCount = content.split('\n').length

  // Comment and suggestion counts
  const commentCount = handle ? getComments(handle).length : 0
  const pendingSuggestionCount = handle ? getAISuggestions(handle).length : 0
  const annotationCount = useAnnotationStore.getState().annotations.length

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
}): ToolResult<{ matches: TextMatch[]; totalCount: number }> {
  const handle = resolveDocumentHandle()

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
    window.dispatchEvent(new CustomEvent('search:show', { detail: { query } }))
  }

  return toolSuccess({ matches, totalCount })
}

/**
 * get_outline - Get the document structure as a list of headings.
 * When there are few headings (< 3), provides a summary instead.
 */
export function executeGetOutline(): ToolResult<{ outline: OutlineEntry[]; summary?: string }> {
  const handle = resolveDocumentHandle()

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
    const store = useEditorStore.getState()
    const content = store.document.content
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
}

/**
 * list_comments - Get all comments in the active document.
 *
 * Merges the live editor marks (positions) with persisted thread data
 * (replies, resolved state) from the comment store so the AI gets the
 * full thread context.
 */
export function executeListComments(): ToolResult<{ comments: CommentEntry[] }> {
  const handle = resolveDocumentHandle()

  if (!handle) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  // Live marks give us current positions.
  const liveMarks = getComments(handle)

  // Persisted store holds replies + resolved state not carried by the mark.
  const persistedComments = useCommentStore.getState().pendingComments

  const comments: CommentEntry[] = liveMarks.map((c) => {
    const persisted = persistedComments.find((p) => p.id === c.id)
    return {
      id: c.id,
      markedText: c.markedText,
      comment: c.comment,
      createdAt: c.createdAt,
      from: c.from,
      to: c.to,
      replies: persisted?.replies ?? [],
      resolved: persisted?.resolved ?? false,
    }
  })

  // Also include resolved threads (mark removed, but store still has them).
  const resolvedIds = new Set(liveMarks.map((c) => c.id))
  for (const p of persistedComments) {
    if (!resolvedIds.has(p.id) && p.resolved) {
      comments.push({
        id: p.id,
        markedText: p.markedText,
        comment: p.comment,
        createdAt: p.createdAt,
        from: p.from,
        to: p.to,
        replies: p.replies ?? [],
        resolved: true,
      })
    }
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
}): ToolResult<{ id: string }> {
  const handle = resolveDocumentHandle()

  if (!handle) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  if (isEditorReadOnly()) {
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

  // The Comment extension's onCommentAdded hook mirrors the new comment into the
  // store (with correct occurrenceIndex) and persists it, so reply_to_comment /
  // resolve_comment can find it by ID in the same session. No manual mirror here.

  return toolSuccess({ id })
}

/**
 * Resolve the comment store entry for a given ID, falling back to the live
 * editor marks when the store doesn't have it yet.
 *
 * The comment store is only populated on tab-load (from IndexedDB) and on
 * explicit saves (tab switch, resolve, reply). When `add_comment` creates a
 * new mark inside the same "session" the mark exists only in the TipTap
 * document — `pendingComments` won't have it until the next save. This helper
 * bridges that gap so tools can act on freshly-created comments.
 */
function ensureInStore(
  id: string,
  store: ReturnType<typeof useCommentStore.getState>,
  handle: DocumentHandle | null
): boolean {
  const alreadyInStore = store.pendingComments.some((c) => c.id === id)
  if (alreadyInStore) return true

  // Fall back to live editor marks
  if (!handle) return false
  const liveMark = getComments(handle).find((c) => c.id === id)
  if (!liveMark) return false

  // Synthesize a minimal store entry from the live mark
  const synth = {
    id: liveMark.id,
    markedText: liveMark.markedText,
    comment: liveMark.comment,
    createdAt: liveMark.createdAt,
    occurrenceIndex: liveMark.occurrenceIndex ?? 0,
    from: liveMark.from,
    to: liveMark.to,
    replies: [],
    resolved: false,
  }
  useCommentStore.setState({
    pendingComments: [...store.pendingComments, synth],
  })
  return true
}

/**
 * resolve_comment - Mark a comment thread as resolved.
 *
 * Sets resolved:true on the persisted CommentData and removes the editor mark.
 * The thread remains in the store as collapsed history — it is not deleted.
 */
export function executeResolveComment(args: {
  id: string
}): ToolResult<{ resolved: boolean }> {
  const handle = resolveDocumentHandle()

  if (!handle) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  if (isEditorReadOnly()) {
    return toolError('Document is read-only in this mode', 'EDITOR_READ_ONLY')
  }

  const { id } = args

  if (!id) {
    return toolError('Comment ID is required', 'INVALID_INPUT')
  }

  // Ensure the comment is in the store (synthesizes from live mark if needed).
  const store = useCommentStore.getState()
  const found = ensureInStore(id, store, handle)
  if (!found) {
    return toolError(`Comment with ID "${id}" not found`, 'COMMENT_NOT_FOUND')
  }

  // Re-read after possible synthesis
  const currentComments = useCommentStore.getState().pendingComments
  const updated = currentComments.map((c) =>
    c.id === id ? { ...c, resolved: true } : c
  )
  useCommentStore.setState({ pendingComments: updated })

  const documentId = useCommentStore.getState().documentId
  if (documentId) {
    useCommentStore.getState().saveComments(documentId, updated)
  }

  // Remove the editor mark so the highlight disappears.
  handle.commands.unsetComment(id)

  // Share-sourced threads push resolution into the live conversation (#769).
  pushResolveToShare(id)

  return toolSuccess({ resolved: true })
}

/**
 * reply_to_comment - Append an AI reply to a comment thread.
 */
export function executeReplyToComment(args: {
  id: string
  text: string
}): ToolResult<{ replyId: string }> {
  if (isEditorReadOnly()) {
    return toolError('Document is read-only in this mode', 'EDITOR_READ_ONLY')
  }

  const { id, text } = args

  if (!id) {
    return toolError('Comment ID is required', 'INVALID_INPUT')
  }
  if (!text?.trim()) {
    return toolError('Reply text is required', 'INVALID_INPUT')
  }

  const handle = resolveDocumentHandle()

  // Ensure the comment is in the store (synthesizes from live mark if needed).
  const store = useCommentStore.getState()
  const found = ensureInStore(id, store, handle)
  if (!found) {
    return toolError(`Comment with ID "${id}" not found`, 'COMMENT_NOT_FOUND')
  }

  const reply: CommentReply = {
    id: generateId(),
    author: 'ai',
    text: text.trim(),
    createdAt: Date.now(),
  }

  // Re-read after possible synthesis
  const currentComments = useCommentStore.getState().pendingComments
  const updated = currentComments.map((c) =>
    c.id === id ? { ...c, replies: [...(c.replies ?? []), reply] } : c
  )

  useCommentStore.setState({ pendingComments: updated })

  const documentId = useCommentStore.getState().documentId
  if (documentId) {
    useCommentStore.getState().saveComments(documentId, updated)
  }

  // Share-sourced threads push the reply into the live conversation (#769).
  pushReplyToShare(id, reply.id)

  return toolSuccess({ replyId: reply.id })
}
