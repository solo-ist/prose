/**
 * Document tool executors - read-only tools for accessing document content.
 */

import type { Editor } from '@tiptap/core'
import type { ToolResult, DocumentMetadata, TextMatch, OutlineEntry } from '../../../../shared/tools/types'
import { toolSuccess, toolError } from '../../../../shared/tools/types'
import { useEditorStore } from '../../../stores/editorStore'
import { useEditorInstanceStore } from '../../../stores/editorInstanceStore'
import { useAnnotationStore } from '../../../extensions/ai-annotations'
import { getNodesWithIds, findNodeById } from '../../../extensions/node-ids'
import type { NodeWithId } from '../../../extensions/node-ids'
import { getComments } from '../../../extensions/comments'
import { getAISuggestions } from '../../../extensions/ai-suggestions'
import { isEditorReadOnly } from './editor'
import { getApi } from '../../browserApi'
import { generateId } from '../../persistence'

/**
 * Get the TipTap editor instance.
 * Returns null if editor is not available.
 */
function getEditor(): Editor | null {
  return useEditorInstanceStore.getState().editor
}

/**
 * Node representation with ID for AI targeting.
 * Container nodes (blockquote, lists, listItems) include a `children` array.
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
 */
function toDocumentNode(n: NodeWithId): DocumentNode {
  const node: DocumentNode = {
    id: n.nodeId,
    type: n.type,
    content: n.textContent,
  }
  if (n.children && n.children.length > 0) {
    node.children = n.children.map(toDocumentNode)
  }
  return node
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
  const editor = getEditor()
  const store = useEditorStore.getState()

  if (!editor) {
    // Fallback to raw content if editor not available
    return toolSuccess({
      nodes: [],
      markdown: store.document.content
    })
  }

  // Get nodes with their IDs as a nested tree
  const nodesWithIds = getNodesWithIds(editor.state.doc)

  // Map to DocumentNode tree
  const nodes: DocumentNode[] = nodesWithIds.map(toDocumentNode)

  return toolSuccess({
    nodes,
    markdown: store.document.content
  })
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
  const editor = getEditor()

  if (!editor) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  const { from, to, empty } = editor.state.selection

  // Try live selection first
  if (!empty) {
    const text = editor.state.doc.textBetween(from, to)
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
  const editor = getEditor()
  const { document } = useEditorStore.getState()

  const content = document.content
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0
  const characterCount = content.length
  const lineCount = content.split('\n').length

  // Comment and suggestion counts
  const commentCount = editor ? getComments(editor).length : 0
  const pendingSuggestionCount = editor ? getAISuggestions(editor).length : 0
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
  const editor = getEditor()

  if (!editor) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  const { query, regex = false, caseSensitive = false, maxResults = 50 } = args

  if (!query) {
    return toolError('Query is required', 'INVALID_INPUT')
  }

  const matches: TextMatch[] = []
  const doc = editor.state.doc
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
        const fromPos = editor.state.doc.resolve(docFrom)
        const toPos = editor.state.doc.resolve(docTo)

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
  const editor = getEditor()

  if (!editor) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  const outline: OutlineEntry[] = []
  let lineNumber = 1

  editor.state.doc.descendants((node, pos) => {
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

/** Minimal comment shape returned by list_comments */
interface CommentEntry {
  id: string
  markedText: string
  comment: string
  createdAt: number
  from: number
  to: number
}

/**
 * list_comments - Get all comments in the active document.
 */
export function executeListComments(): ToolResult<{ comments: CommentEntry[] }> {
  const editor = getEditor()

  if (!editor) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  const raw = getComments(editor)
  const comments: CommentEntry[] = raw.map((c) => ({
    id: c.id,
    markedText: c.markedText,
    comment: c.comment,
    createdAt: c.createdAt,
    from: c.from,
    to: c.to,
  }))

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
  const editor = getEditor()

  if (!editor) {
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
    const found = findNodeById(editor.state.doc, nodeId)
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
  const rangeText = editor.state.doc.textBetween(from, to, ' ')
  if (!rangeText.trim()) {
    return toolError('Cannot add a comment to an empty range — the targeted node has no text content', 'EMPTY_RANGE')
  }

  const id = generateId()

  const success = editor
    .chain()
    .focus()
    .setTextSelection({ from, to })
    .setComment({ id, comment })
    .run()

  if (!success) {
    return toolError('Failed to apply comment mark — the range may not contain markable content', 'COMMENT_FAILED')
  }

  return toolSuccess({ id })
}

/**
 * resolve_comment - Remove a comment by its ID.
 */
export function executeResolveComment(args: {
  id: string
}): ToolResult<{ resolved: boolean }> {
  const editor = getEditor()

  if (!editor) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  if (isEditorReadOnly()) {
    return toolError('Document is read-only in this mode', 'EDITOR_READ_ONLY')
  }

  const { id } = args

  if (!id) {
    return toolError('Comment ID is required', 'INVALID_INPUT')
  }

  const success = editor.commands.unsetComment(id)

  if (!success) {
    return toolError(`Comment with ID "${id}" not found`, 'COMMENT_NOT_FOUND')
  }

  return toolSuccess({ resolved: true })
}
