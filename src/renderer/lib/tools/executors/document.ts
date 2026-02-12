/**
 * Document tool executors - read-only tools for accessing document content.
 */

import type { Editor } from '@tiptap/core'
import type { ToolResult, DocumentMetadata, TextMatch, OutlineEntry } from '../../../../shared/tools/types'
import { toolSuccess, toolError } from '../../../../shared/tools/types'
import { useEditorStore } from '../../../stores/editorStore'
import { useEditorInstanceStore } from '../../../stores/editorInstanceStore'
import { useAnnotationStore } from '../../../extensions/ai-annotations'
import { getNodesWithIds } from '../../../extensions/node-ids'
import { getComments } from '../../../extensions/comments'
import { getAISuggestions } from '../../../extensions/ai-suggestions'
import { getApi } from '../../browserApi'

/**
 * Get the TipTap editor instance.
 * Returns null if editor is not available.
 */
function getEditor(): Editor | null {
  return useEditorInstanceStore.getState().editor
}

/**
 * Node representation with ID for AI targeting.
 */
interface DocumentNode {
  id: string
  type: string
  content: string
}

/**
 * read_document - Get the document content with node IDs for targeting.
 *
 * Returns a structured list of nodes with their IDs, allowing the AI to
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

  // Get nodes with their IDs
  const nodesWithIds = getNodesWithIds(editor.state.doc)

  // Format as structured list
  const nodes: DocumentNode[] = nodesWithIds.map((n) => ({
    id: n.nodeId,
    type: n.type,
    content: n.textContent
  }))

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
