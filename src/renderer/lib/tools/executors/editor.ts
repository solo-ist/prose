/**
 * Editor tool executors - tools for modifying document content.
 */

import type { Editor } from '@tiptap/core'
import type { ToolResult } from '../../../../shared/tools/types'
import { toolSuccess, toolError } from '../../../../shared/tools/types'
import { useEditorStore } from '../../../stores/editorStore'
import { useEditorInstanceStore } from '../../../stores/editorInstanceStore'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useAnnotationStore } from '../../../extensions/ai-annotations'
import { createWordDiffAnnotations } from '../../diffUtils'
import { findNodeById, findNodeByContent, getNodesWithIds, flattenNodes } from '../../../extensions/node-ids'
import { generateId } from '../../persistence'
import { getAISuggestions } from '../../../extensions/ai-suggestions'
import { parseMarkdown, FRONTMATTER_REGEX } from '../../markdown'
import { load as parseYaml } from 'js-yaml'

/**
 * Target visible duration for a chunked streaming insertion. The number of
 * chunks is capped so total wall time stays under ~400ms even for long
 * paragraphs — long enough to perceive motion, short enough that the user
 * isn't waiting on the agent.
 */
const STREAM_TARGET_FRAME_COUNT = 24

/**
 * Decide whether the next agent insertion should stream chunk-by-chunk.
 * Falls back to instant apply when the user has disabled the setting or
 * has `prefers-reduced-motion: reduce` set at the OS level.
 */
function shouldStreamInsertion(): boolean {
  const enabled = useSettingsStore.getState().settings.editor.streamingEdits
  if (enabled === false) return false
  if (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    return false
  }
  return true
}

/**
 * Split text into word-level chunks (word + trailing whitespace per chunk),
 * then group into at most STREAM_TARGET_FRAME_COUNT chunks so total wall time
 * stays bounded for long paragraphs.
 */
function buildStreamChunks(text: string): string[] {
  // Token alternation: [word, space, word, space, ...]; either side may be empty.
  const tokens = text.split(/(\s+)/)
  const words: string[] = []
  for (let i = 0; i < tokens.length; i += 2) {
    const word = tokens[i] || ''
    const space = tokens[i + 1] || ''
    if (word || space) words.push(word + space)
  }
  if (words.length <= STREAM_TARGET_FRAME_COUNT) return words
  const groupSize = Math.ceil(words.length / STREAM_TARGET_FRAME_COUNT)
  const groups: string[] = []
  for (let i = 0; i < words.length; i += groupSize) {
    groups.push(words.slice(i, i + groupSize).join(''))
  }
  return groups
}

/** Yield to the browser so paint can happen between chunks. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve())
    } else {
      setTimeout(resolve, 16)
    }
  })
}

/**
 * Insert `text` at `from`, or replace the range `[from, to]` when `to` is
 * supplied, either instantly or in word-level chunks across animation frames.
 * Chunked transactions land within ~400ms total — inside the ProseMirror
 * history plugin's default newGroupDelay (500ms) — so the whole insertion
 * collapses into a single undo step.
 *
 * When `to` is supplied, the range delete and the first chunk insert run in
 * the same chain (a single transaction), so range replacement is atomic and
 * shares undo state with the first chunk.
 *
 * Subsequent chunks track the running insertion endpoint via an explicit
 * length accumulator (anchored once at end-of-insertion from TipTap's own
 * selection placement, then advanced by each chunk's character count), so
 * user clicks or keystrokes mid-stream can't redirect later chunks into
 * the user's cursor position.
 */
async function applyInsertion(
  editor: Editor,
  text: string,
  from: number,
  to?: number
): Promise<void> {
  const hasRange = to !== undefined && to !== from
  const selection = hasRange ? { from, to: to! } : from

  if (!shouldStreamInsertion()) {
    editor.chain().focus().setTextSelection(selection).insertContent(text).run()
    return
  }
  const chunks = buildStreamChunks(text)
  if (chunks.length <= 1) {
    editor.chain().focus().setTextSelection(selection).insertContent(text).run()
    return
  }
  editor.chain().focus().setTextSelection(selection).insertContent(chunks[0]).run()
  // Anchor the running endpoint at end-of-insertion using TipTap's own
  // cursor placement (`selectionToInsertionEnd` in
  // `node_modules/@tiptap/core/src/commands/insertContentAt.ts`), which
  // leaves the cursor INSIDE the just-inserted textblock at the end of
  // its text. Earlier doc-size arithmetic landed `pos` AFTER the closing
  // paragraph token — a between-blocks position, where `tr.insertText`
  // wraps the text in a new paragraph to fit the parent context,
  // producing one paragraph per chunk.
  //
  // From there, advance `pos` by each chunk's character count rather than
  // re-reading `editor.state.selection.from` after every dispatch. Two
  // reasons: (1) subsequent chunks use raw `tr.insertText` (not
  // `insertContent(string)`), which inserts plain text inline and adds
  // exactly `chunks[i].length` PM units — so the accumulator is exact;
  // (2) if the user clicks or types mid-stream, the live selection moves
  // away from our insertion endpoint, but the accumulator stays
  // independent — keeping later chunks landing at the running insertion
  // point instead of redirecting into the user's cursor.
  let pos = editor.state.selection.from
  for (let i = 1; i < chunks.length; i++) {
    await nextFrame()
    editor.view.dispatch(editor.state.tr.insertText(chunks[i], pos))
    pos += chunks[i].length
  }
}

/**
 * Get the TipTap editor instance.
 * Returns null if editor is not available or source mode is active.
 */
function getEditor(): Editor | null {
  if (useEditorStore.getState().sourceMode) {
    return null
  }
  return useEditorInstanceStore.getState().editor
}

/**
 * Check if the editor is in a read-only mode (reMarkable OCR or preview tab).
 * AI tools should not mutate the document in these modes. Exported so that
 * document-tool executors (add_comment, resolve_comment) can apply the same gate.
 */
export function isEditorReadOnly(): boolean {
  const state = useEditorStore.getState()
  return state.isRemarkableReadOnly || state.isPreviewTab
}

/**
 * Strip markdown block-level prefix that matches the target node's type, so
 * the suggestion popover displays the visible text instead of the raw markdown
 * source the LLM might wrap a replacement in.
 *
 *   stripLeadingBlockMarkup('# New Title', 'heading', 1) -> 'New Title'
 *   stripLeadingBlockMarkup('## Hello',    'heading', 2) -> 'Hello'
 *   stripLeadingBlockMarkup('Hello',       'paragraph')  -> 'Hello'  (no-op)
 */
function stripLeadingBlockMarkup(content: string, nodeType: string, level?: number): string {
  const trimmed = content.replace(/^[\r\n]+/, '')

  if (nodeType === 'heading') {
    const lvl = typeof level === 'number' && level >= 1 && level <= 6 ? level : null
    if (lvl) {
      const re = new RegExp(`^#{${lvl}}\\s+`)
      if (re.test(trimmed)) return trimmed.replace(re, '')
    }
    // Fallback: strip any leading hash run if level is unknown
    return trimmed.replace(/^#{1,6}\s+/, '')
  }

  if (nodeType === 'blockquote') {
    return trimmed.replace(/^>\s?/gm, '')
  }

  if (nodeType === 'listItem' || nodeType === 'taskItem') {
    return trimmed.replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')
  }

  return trimmed
}

/**
 * Resolve the target document position for an editor-mutating tool call.
 * Used to sort tool calls by position (descending) before batch execution,
 * so bottom-of-document edits don't shift positions of earlier edits.
 * Returns Infinity for tools that don't target a specific position.
 */
export function resolveToolPosition(toolName: string, args: Record<string, unknown>): number {
  const editor = getEditor()
  if (!editor) return Infinity

  if (toolName === 'edit' || toolName === 'suggest_edit') {
    const nodeId = args.nodeId as string
    const search = args.search as string | undefined
    if (!nodeId) return Infinity

    let found = findNodeById(editor.state.doc, nodeId)
    if (!found && search) {
      found = findNodeByContent(editor.state.doc, search)
    }
    return found ? found.pos : Infinity
  }

  if (toolName === 'insert') {
    const position = (args.position as string) || 'cursor'
    switch (position) {
      case 'start': return 0
      case 'end': return editor.state.doc.content.size
      case 'cursor': return editor.state.selection.from
      case 'after_node':
      case 'before_node': {
        const nodeId = args.nodeId as string | undefined
        const search = args.search as string | undefined
        if (!nodeId) return Infinity
        let found = findNodeById(editor.state.doc, nodeId)
        if (!found && search) {
          found = findNodeByContent(editor.state.doc, search)
        }
        if (!found) return Infinity
        return position === 'after_node'
          ? found.pos + found.node.nodeSize
          : found.pos
      }
      default: return Infinity
    }
  }

  if (toolName === 'delete_node') {
    const nodeId = args.nodeId as string
    const search = args.search as string | undefined
    if (!nodeId) return Infinity

    let found = findNodeById(editor.state.doc, nodeId)
    if (!found && search) {
      found = findNodeByContent(editor.state.doc, search)
    }
    return found ? found.pos : Infinity
  }

  return Infinity
}

/**
 * edit - Replace the content of a node by its ID.
 * Falls back to content matching if the nodeId is stale.
 */
export async function executeEdit(
  args: {
    nodeId: string
    content: string
    comment?: string
    search?: string
  },
  provenance?: ToolProvenance
): Promise<ToolResult<{ applied: boolean; nodeId: string }>> {
  const editor = getEditor()

  if (!editor) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  if (isEditorReadOnly()) {
    return toolError('Document is read-only in this mode', 'EDITOR_READ_ONLY')
  }

  const { nodeId, content, comment, search } = args

  if (!nodeId) {
    return toolError('Node ID is required', 'INVALID_INPUT')
  }

  // Special nodeId: 'frontmatter' — direct-write the frontmatter block via
  // setFrontmatter. No overlay (edit is "direct write" semantics in Create
  // Mode; the user has already opted in by enabling the edit tool). Accepts
  // raw YAML or a ---wrapped block. Mirrors the parsing of the suggest_edit
  // frontmatter branch but commits straight to document.frontmatter.
  if (nodeId === 'frontmatter') {
    const parsed = parseFrontmatterPayload(content)
    if (parsed.kind === 'error') {
      return toolError(parsed.message, 'INVALID_FRONTMATTER')
    }
    useEditorStore.getState().setFrontmatter(parsed.frontmatter)
    return toolSuccess({ applied: true, nodeId })
  }

  // Find the node by ID, fall back to content matching if stale
  let found = findNodeById(editor.state.doc, nodeId)

  if (!found && search) {
    found = findNodeByContent(editor.state.doc, search)
  }

  if (!found) {
    const available = flattenNodes(getNodesWithIds(editor.state.doc))
    const nodeList = available.map(n => `${n.nodeId} (${n.type}: "${n.textContent.substring(0, 40)}")`).join(', ')
    return toolError(
      `Node with ID "${nodeId}" not found. Available nodes: [${nodeList}]`,
      'NODE_NOT_FOUND'
    )
  }

  const { node, pos } = found

  // Replace the node's content
  // For text-containing nodes, we replace from pos+1 to pos+node.nodeSize-1 (inside the node)
  // The node structure is: <node>[content]</node>, so content starts at pos+1
  const contentStart = pos + 1
  const contentEnd = pos + node.nodeSize - 1

  const sizeBefore = editor.state.doc.content.size
  // Range-replace via applyInsertion: the selection delete + first chunk
  // insert run in the same chain (atomic transaction). Subsequent rAF chunks
  // fall inside the history plugin's newGroupDelay (500ms) and collapse into
  // a single undo step.
  await applyInsertion(editor, content, contentStart, contentEnd)
  const sizeAfter = editor.state.doc.content.size

  // Create word-level AI annotations for provenance tracking
  if (provenance && provenance.documentId && content.length > 0) {
    createWordDiffAnnotations({
      documentId: provenance.documentId,
      originalText: node.textContent,
      newText: content,
      rangeFrom: contentStart,
      rangeTo: contentEnd + (sizeAfter - sizeBefore),
      provenance: {
        model: provenance.model,
        conversationId: provenance.conversationId,
        messageId: provenance.messageId,
      },
      explanation: comment,
    })
  }

  return toolSuccess({
    applied: true,
    nodeId
  })
}

/**
 * Parse a frontmatter payload from a suggest_edit/edit call targeting
 * nodeId: 'frontmatter'. Accepts raw YAML or a ---wrapped block. Returns
 * a structured result so callers can choose error code/category.
 */
function parseFrontmatterPayload(
  content: string
): { kind: 'ok'; frontmatter: Record<string, unknown> } | { kind: 'error'; message: string } {
  const trimmed = content.trim()
  const yamlSource = FRONTMATTER_REGEX.test(trimmed)
    ? trimmed.replace(FRONTMATTER_REGEX, '$1')
    : trimmed

  let loaded: unknown
  try {
    loaded = parseYaml(yamlSource)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { kind: 'error', message: `Frontmatter content failed to parse as YAML: ${message}` }
  }
  if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) {
    return { kind: 'error', message: 'Frontmatter content must be a YAML mapping (key: value pairs).' }
  }
  const frontmatter = loaded as Record<string, unknown>
  if (Object.keys(frontmatter).length === 0) {
    return { kind: 'error', message: 'Frontmatter mapping is empty — provide at least one key: value pair.' }
  }
  return { kind: 'ok', frontmatter }
}

/**
 * insert - Insert text at the specified position.
 *
 * Positions:
 *   - `cursor` — at the current selection (legacy; depends on where the
 *     user has parked the cursor, so only correct when they said "here")
 *   - `start` / `end` — document boundaries
 *   - `after_node` / `before_node` — relative to a node located by
 *     `nodeId` (preferred for "add to section X" — anchor on the
 *     section's heading nodeId from `read_document`)
 */
export async function executeInsert(
  args: {
    text: string
    position?: 'cursor' | 'start' | 'end' | 'after_node' | 'before_node'
    nodeId?: string
    comment?: string
    search?: string
  },
  provenance?: ToolProvenance
): Promise<ToolResult<{ inserted: boolean; position: string }>> {
  const editor = getEditor()

  if (!editor) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  if (isEditorReadOnly()) {
    return toolError('Document is read-only in this mode', 'EDITOR_READ_ONLY')
  }

  const { text, position = 'cursor', nodeId, comment, search } = args

  if (!text) {
    return toolError('Text to insert is required', 'INVALID_INPUT')
  }

  // Resolve insertion range. Most positions collapse to a single point
  // (insertFrom === insertTo), but `cursor` honors any active selection
  // so a highlighted-then-asked-to-insert flow replaces the selection
  // instead of leaving it stranded next to the new content.
  let insertFrom: number
  let insertTo: number
  switch (position) {
    case 'start':
      insertFrom = 0
      insertTo = 0
      break
    case 'end':
      insertFrom = editor.state.doc.content.size
      insertTo = editor.state.doc.content.size
      break
    case 'after_node':
    case 'before_node': {
      if (!nodeId) {
        return toolError(
          `nodeId is required when position is "${position}"`,
          'INVALID_INPUT'
        )
      }
      let found = findNodeById(editor.state.doc, nodeId)
      if (!found && search) {
        found = findNodeByContent(editor.state.doc, search)
      }
      if (!found) {
        const available = flattenNodes(getNodesWithIds(editor.state.doc))
        const nodeList = available
          .map(n => `${n.nodeId} (${n.type}: "${n.textContent.substring(0, 40)}")`)
          .join(', ')
        return toolError(
          `Anchor node "${nodeId}" not found. Available nodes: [${nodeList}]`,
          'NODE_NOT_FOUND'
        )
      }
      insertFrom =
        position === 'after_node' ? found.pos + found.node.nodeSize : found.pos
      insertTo = insertFrom
      break
    }
    case 'cursor':
    default:
      // Use the full selection range so non-empty selections are
      // replaced by the inserted text. Matches the pre-#546 behavior
      // and is what users intuitively expect when they highlight a
      // span and ask the agent to write replacement prose.
      insertFrom = editor.state.selection.from
      insertTo = editor.state.selection.to
      break
  }

  try {
    const sizeBefore = editor.state.doc.content.size
    // Route through applyInsertion so the chunked-streaming path applies
    // uniformly, and so range replacement (cursor case with non-empty
    // selection) is atomic with the first chunk's insert.
    await applyInsertion(editor, text, insertFrom, insertTo)
    const sizeAfter = editor.state.doc.content.size

    // Create AI annotation for provenance tracking.
    // Inserted PM range = [insertFrom, insertFrom + insertedSize], where
    // insertedSize accounts for both the doc-size delta and the original
    // selection that got replaced. For a collapsed selection (the common
    // case) this reduces to `sizeAfter - sizeBefore`.
    if (provenance && provenance.documentId && text.length > 0) {
      // Use the actual PM size delta (plus any replaced range size) instead of
      // string length: insertContent() may produce multi-paragraph nodes where
      // string length != PM position delta, and the doc delta nets out any
      // selection that was replaced.
      const insertedSize = (sizeAfter - sizeBefore) + (insertTo - insertFrom)
      // Route through createWordDiffAnnotations for visual consistency with
      // edit/suggest_edit-accept annotations (word-level underline, explanation
      // in tooltip). originalText is empty for pure insertions; the util
      // promotes the type to 'insertion' automatically.
      createWordDiffAnnotations({
        documentId: provenance.documentId,
        originalText: '',
        newText: text,
        rangeFrom: insertFrom,
        rangeTo: insertFrom + insertedSize,
        provenance: {
          model: provenance.model,
          conversationId: provenance.conversationId,
          messageId: provenance.messageId,
        },
        explanation: comment,
      })
    }

    return toolSuccess({
      inserted: true,
      position
    })
  } catch (e) {
    return toolError(`Failed to insert text: ${e}`, 'INSERT_FAILED')
  }
}

/** Provenance context for AI-generated content tracking */
interface ToolProvenance {
  model: string
  conversationId: string
  messageId: string
  documentId: string
}

/**
 * suggest_edit - Show an AI suggestion as a highlighted mark on text.
 * The user can click the highlighted text to see the suggestion and accept/reject it.
 * Falls back to content matching if the nodeId is stale.
 */
export function executeSuggestEdit(
  args: {
    nodeId: string
    content: string
    comment?: string
    search?: string
  },
  provenance?: ToolProvenance
): ToolResult<{ suggested: boolean; suggestionId: string }> {
  const editor = getEditor()

  if (!editor) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  if (isEditorReadOnly()) {
    return toolError('Document is read-only in this mode', 'EDITOR_READ_ONLY')
  }

  const { nodeId, comment, search } = args
  let { content } = args

  if (!nodeId) {
    return toolError('Node ID is required', 'INVALID_INPUT')
  }

  // Special nodeId: 'frontmatter' targets the frontmatter block directly
  // (Option C, #488). Routes through the FrontmatterEditor overlay (vs edit's
  // direct write) without requiring --- delimiters.
  if (nodeId === 'frontmatter') {
    const parsed = parseFrontmatterPayload(content)
    if (parsed.kind === 'error') {
      return toolError(parsed.message, 'INVALID_FRONTMATTER')
    }
    useEditorStore.getState().setPendingFrontmatter(parsed.frontmatter)
    return toolSuccess({ suggested: true, suggestionId: generateId() })
  }

  // Detect and stage frontmatter from the incoming content (Option B, #488).
  // When Claude adds frontmatter via suggest_edit the --- delimiters render
  // as a thematic break/heading in TipTap. Extract frontmatter, then commit it
  // as a pending overlay only AFTER we know the suggest_edit will succeed
  // (avoids the "error toast + unexpected overlay" failure mode where a stale
  // nodeId would still pop the overlay).
  let frontmatterToStage: Record<string, unknown> | null = null
  if (content.trimStart().startsWith('---')) {
    const { content: body, frontmatter } = parseMarkdown(content)
    if (Object.keys(frontmatter).length > 0) {
      // Real frontmatter — stage for later commit.
      frontmatterToStage = frontmatter
      content = body
    } else {
      // parseMarkdown matched the regex but produced no object. Two cases:
      //   (a) malformed YAML attempt — should error (e.g., `## title: foo`)
      //   (b) legitimate body content with a YAML scalar inside the fences
      //       (e.g., `---\nsome text\n---\nbody`) — should pass through unchanged
      //       to preserve #490's protection for thematic-break-style bodies.
      // Distinguish by parsing the fence interior directly: if yaml.load
      // throws, it's malformed (a). If it returns a scalar/array/null without
      // throwing, it's legitimate body (b).
      const fenceMatch = content.trimStart().match(FRONTMATTER_REGEX)
      if (fenceMatch) {
        let yamlThrew = false
        try {
          parseYaml(fenceMatch[1])
        } catch {
          yamlThrew = true
        }
        if (yamlThrew) {
          return toolError(
            'Content is wrapped in --- delimiters but the YAML inside failed to parse. ' +
              'Either pass valid YAML between the delimiters, or call suggest_edit with ' +
              "nodeId: 'frontmatter' to update the frontmatter block directly.",
            'INVALID_FRONTMATTER'
          )
        }
        // YAML parsed but yielded no object — leave content unchanged so we
        // don't silently drop a body block. See #490.
      }
    }
  }

  // Critical bug prevention (#488): when frontmatter was the only payload
  // (body is empty after stripping), skip the AI suggestion mark entirely.
  // Inserting an empty suggestion onto the nearest body node (usually H1)
  // was the root cause of the spurious heading highlight. Commit the staged
  // frontmatter here — frontmatter-only path doesn't need node lookup.
  //
  // #516 — tighten this fall-through: require nodeId === 'frontmatter' OR
  // that the nodeId resolves to a real node. A bogus/stale nodeId should not
  // silently pop the overlay alongside the error toast; it must return
  // NODE_NOT_FOUND with guidance so the agent can correct its call.
  if (frontmatterToStage && !content.trim()) {
    if (nodeId !== 'frontmatter') {
      const resolvedForFm = findNodeById(editor.state.doc, nodeId)
      if (!resolvedForFm) {
        const available = flattenNodes(getNodesWithIds(editor.state.doc))
        const nodeList = available.map(n => `${n.nodeId} (${n.type}: "${n.textContent.substring(0, 40)}")`).join(', ')
        return toolError(
          `Node with ID "${nodeId}" not found, and the content is frontmatter-only. ` +
            `Use nodeId: 'frontmatter' to target the frontmatter block directly. ` +
            `Available body nodes: [${nodeList}]`,
          'NODE_NOT_FOUND'
        )
      }
    }
    useEditorStore.getState().setPendingFrontmatter(frontmatterToStage)
    return toolSuccess({ suggested: true, suggestionId: generateId() })
  }

  // Find the node by ID, fall back to content matching if stale
  let found = findNodeById(editor.state.doc, nodeId)

  if (!found && search) {
    found = findNodeByContent(editor.state.doc, search)
  }

  if (!found) {
    const available = flattenNodes(getNodesWithIds(editor.state.doc))
    const nodeList = available.map(n => `${n.nodeId} (${n.type}: "${n.textContent.substring(0, 40)}")`).join(', ')
    return toolError(
      `Node with ID "${nodeId}" not found. Available nodes: [${nodeList}]`,
      'NODE_NOT_FOUND'
    )
  }

  const { node, pos } = found
  const suggestionId = generateId()

  // Get the original text content
  const originalText = node.textContent

  // Normalize suggested text to match the target node's shape. If the target
  // is a heading and the LLM wrapped the replacement in markdown syntax (e.g.
  // "# New Title" for an H1), strip the matching prefix so the diff popover
  // shows just the visible text instead of the raw markdown source.
  const suggestedText = stripLeadingBlockMarkup(content, node.type.name, node.attrs?.level)

  // Defensive guard (#578): a localized edit (e.g., fix a typo in the first
  // sentence) must never silently overwrite the majority of a large node.
  // When a node is large (≥200 chars) and the suggested replacement is smaller
  // than 25% of the original, the suggestion is almost certainly a partial
  // edit that would cause silent data loss if accepted. Surface an error
  // instead so the agent can re-scope its call.
  //
  // This threshold intentionally does NOT fire for:
  //   • Deletions/truncations where the agent explicitly targets a large node
  //     and produces a replacement close to or greater than 25% of the original.
  //   • Normal edits (typo fix on a short node, or a rewrite of comparable length).
  //   • Empty suggestions (handled upstream — the check below would fire, but
  //     empty is a separate case worth a distinct message).
  //
  // The root cause of #578: the entire body was collapsed into a single large
  // paragraph node, so a "fix first sentence" call targeted 1800 chars but the
  // model returned only ~80 chars — a 4% ratio, caught by this guard.
  const LARGE_NODE_THRESHOLD = 200
  const DESTRUCTIVE_RATIO_THRESHOLD = 0.25
  if (
    originalText.length >= LARGE_NODE_THRESHOLD &&
    suggestedText.length > 0 &&
    suggestedText.length < originalText.length * DESTRUCTIVE_RATIO_THRESHOLD
  ) {
    return toolError(
      `Suggestion rejected: the proposed replacement (${suggestedText.length} chars) is less than ` +
        `${Math.round(DESTRUCTIVE_RATIO_THRESHOLD * 100)}% of the target node's content ` +
        `(${originalText.length} chars), which usually means a localized edit was about to ` +
        `overwrite the entire node. To fix a small issue, narrow the scope: target a shorter ` +
        `nodeId (or use the \`search\` parameter) matching only the sentence or phrase you intend ` +
        `to change. Deliberately shortening or summarizing a node over ${LARGE_NODE_THRESHOLD} ` +
        `chars is intentionally blocked here to prevent silent data loss — apply it as smaller ` +
        `targeted edits instead.`,
      'SUGGESTION_DESTRUCTIVE'
    )
  }

  // Node lookup succeeded AND the suggestion cleared the destructive-edit guard —
  // only now is it safe to commit staged frontmatter, so neither a stale nodeId
  // (NODE_NOT_FOUND) nor a rejected destructive edit can pop the frontmatter
  // overlay alongside an error toast (preserving the invariant from #488).
  if (frontmatterToStage) {
    useEditorStore.getState().setPendingFrontmatter(frontmatterToStage)
  }

  // Select the text content of the node and apply the AI suggestion mark
  const contentStart = pos + 1
  const contentEnd = pos + node.nodeSize - 1

  editor
    .chain()
    .focus()
    .setTextSelection({ from: contentStart, to: contentEnd })
    .setAISuggestion({
      id: suggestionId,
      type: 'edit',
      originalText,
      suggestedText,
      explanation: comment || '',
      provenanceModel: provenance?.model || '',
      provenanceConversationId: provenance?.conversationId || '',
      provenanceMessageId: provenance?.messageId || '',
      documentId: provenance?.documentId || '',
    })
    .run()

  return toolSuccess({
    suggested: true,
    suggestionId
  })
}

/** Suggestion data returned by list_diffs */
interface SuggestionInfo {
  id: string
  originalText: string
  suggestedText: string
  explanation?: string
}

/**
 * accept_diff - Accept pending AI suggestions.
 * If no ID provided, accepts ALL suggestions.
 */
export function executeAcceptDiff(args: {
  id?: string
}): ToolResult<{ accepted: boolean; diffId?: string; count?: number }> {
  const editor = getEditor()

  if (!editor) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  const { id } = args
  const suggestions = getAISuggestions(editor)

  if (suggestions.length === 0) {
    return toolError('No pending suggestions', 'NO_DIFFS')
  }

  if (id) {
    // Accept specific suggestion
    const target = suggestions.find((s) => s.id === id)
    if (!target) {
      return toolError(`Suggestion with id "${id}" not found`, 'DIFF_NOT_FOUND')
    }

    const success = editor.commands.acceptAISuggestion(id)
    if (success) {
      return toolSuccess({ accepted: true, diffId: id, count: 1 })
    } else {
      return toolError('Failed to accept suggestion', 'ACCEPT_FAILED')
    }
  }

  // Accept all suggestions
  const count = suggestions.length
  const success = editor.commands.acceptAllAISuggestions()

  if (success) {
    return toolSuccess({ accepted: true, count })
  } else {
    return toolError('Failed to accept suggestions', 'ACCEPT_FAILED')
  }
}

/**
 * reject_diff - Reject pending AI suggestions.
 * If no ID provided, rejects ALL suggestions.
 */
export function executeRejectDiff(args: {
  id?: string
}): ToolResult<{ rejected: boolean; diffId?: string; count?: number }> {
  const editor = getEditor()

  if (!editor) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  const { id } = args
  const suggestions = getAISuggestions(editor)

  if (suggestions.length === 0) {
    return toolError('No pending suggestions', 'NO_DIFFS')
  }

  if (id) {
    // Reject specific suggestion
    const target = suggestions.find((s) => s.id === id)
    if (!target) {
      return toolError(`Suggestion with id "${id}" not found`, 'DIFF_NOT_FOUND')
    }

    const success = editor.commands.rejectAISuggestion(id)
    if (success) {
      return toolSuccess({ rejected: true, diffId: id, count: 1 })
    } else {
      return toolError('Failed to reject suggestion', 'REJECT_FAILED')
    }
  }

  // Reject all suggestions
  const count = suggestions.length
  const success = editor.commands.rejectAllAISuggestions()

  if (success) {
    return toolSuccess({ rejected: true, count })
  } else {
    return toolError('Failed to reject suggestions', 'REJECT_FAILED')
  }
}

/**
 * delete_node - Remove a node from the document by ID.
 * Falls back to content matching if the nodeId is stale.
 */
export function executeDeleteNode(
  args: {
    nodeId: string
    search?: string
  },
  provenance?: ToolProvenance
): ToolResult<{ deleted: boolean; nodeId: string }> {
  const editor = getEditor()

  if (!editor) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  if (isEditorReadOnly()) {
    return toolError('Document is read-only in this mode', 'EDITOR_READ_ONLY')
  }

  const { nodeId, search } = args

  if (!nodeId) {
    return toolError('Node ID is required', 'INVALID_INPUT')
  }

  let found = findNodeById(editor.state.doc, nodeId)

  if (!found && search) {
    found = findNodeByContent(editor.state.doc, search)
  }

  if (!found) {
    const available = flattenNodes(getNodesWithIds(editor.state.doc))
    const nodeList = available.map(n => `${n.nodeId} (${n.type}: "${n.textContent.substring(0, 40)}")`).join(', ')
    return toolError(
      `Node with ID "${nodeId}" not found. Available nodes: [${nodeList}]`,
      'NODE_NOT_FOUND'
    )
  }

  const { node, pos } = found
  const deletedText = node.textContent
  const from = pos
  const to = pos + node.nodeSize

  editor.chain().focus().deleteRange({ from, to }).run()

  // Log a deletion annotation for provenance. Range collapses to a single
  // point at the deletion site so the annotation store treats it as a marker
  // rather than highlighting text that no longer exists.
  if (provenance && provenance.documentId) {
    useAnnotationStore.getState().addAnnotation({
      documentId: provenance.documentId,
      type: 'deletion',
      from,
      to: from,
      content: deletedText,
      provenance: {
        model: provenance.model,
        conversationId: provenance.conversationId,
        messageId: provenance.messageId,
      },
    })
  }

  return toolSuccess({ deleted: true, nodeId })
}

/**
 * move_cursor - Move the user's text cursor to a specific node.
 * Non-destructive selection change. Falls back to content matching if the
 * nodeId is stale.
 */
export function executeMoveCursor(args: {
  nodeId: string
  position?: 'start' | 'end'
  search?: string
}): ToolResult<{ moved: boolean; nodeId: string; position: 'start' | 'end' }> {
  const editor = getEditor()

  if (!editor) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  if (isEditorReadOnly()) {
    return toolError('Document is read-only in this mode', 'EDITOR_READ_ONLY')
  }

  const { nodeId, search } = args
  const position = args.position ?? 'start'

  if (!nodeId) {
    return toolError('Node ID is required', 'INVALID_INPUT')
  }

  let found = findNodeById(editor.state.doc, nodeId)

  if (!found && search) {
    found = findNodeByContent(editor.state.doc, search)
  }

  if (!found) {
    const available = flattenNodes(getNodesWithIds(editor.state.doc))
    const nodeList = available.map(n => `${n.nodeId} (${n.type}: "${n.textContent.substring(0, 40)}")`).join(', ')
    return toolError(
      `Node with ID "${nodeId}" not found. Available nodes: [${nodeList}]`,
      'NODE_NOT_FOUND'
    )
  }

  const { node, pos } = found
  // Node-content positions live inside the open/close tokens.
  const target = position === 'end' ? pos + node.nodeSize - 1 : pos + 1

  editor.chain().focus().setTextSelection(target).run()

  return toolSuccess({ moved: true, nodeId, position })
}

/**
 * List all pending AI suggestions.
 */
export function executeListDiffs(): ToolResult<{ diffs: SuggestionInfo[] }> {
  const editor = getEditor()

  if (!editor) {
    return toolError('Editor not available', 'EDITOR_NOT_AVAILABLE')
  }

  const suggestions = getAISuggestions(editor)
  const diffs: SuggestionInfo[] = suggestions.map((s) => ({
    id: s.id,
    originalText: s.originalText,
    suggestedText: s.suggestedText,
    explanation: s.explanation || undefined
  }))

  return toolSuccess({ diffs })
}
