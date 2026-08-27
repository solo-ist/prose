/**
 * AI Suggestion Mark Extension for TipTap
 *
 * Allows AI to add edit suggestions to text that appear as purple highlights.
 * Users can click to see the suggested change and accept/reject it.
 */

import { Mark, mergeAttributes } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import type { Schema, Node as PMNode } from '@tiptap/pm/model'
import { DOMParser as ProseMirrorDOMParser, Fragment, Slice } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { MarkSerializerSpec } from 'prosemirror-markdown'
import type {
  AISuggestionOptions,
  AISuggestionData,
  SuggestionFeedback,
  SuggestionType,
} from './types'
import type { ReviewActor } from '../review-events'
import { useAnnotationStore } from '../ai-annotations'
import { createWordDiffAnnotations } from '../../lib/diffUtils'
import { pipelineLog } from '../../lib/aiPipelineLog'

/**
 * Returns true when `text` contains block-level structure that would be lost
 * if inserted as a flat schema.text() node — specifically, when it has at
 * least one blank-line paragraph separator (the CommonMark block delimiter).
 *
 * Single-run content (a sentence, a phrase, inline edits) never contains
 * `\n\n`, so the fast path is the overwhelmingly common case.
 */
function isMultiBlock(text: string): boolean {
  return text.includes('\n\n')
}

/**
 * Parse a markdown string into a ProseMirror Slice using the editor's
 * configured tiptap-markdown parser, preserving block structure (paragraphs,
 * headings, lists, etc.). Used for multi-block suggestion acceptance and for
 * block-anchor insertions (after_node / before_node) so that content is placed
 * as a document-level sibling rather than being absorbed into the anchor node.
 *
 * Returns null if the editor doesn't have a markdown parser in storage
 * (e.g., during tests) so callers can fall back to the text path.
 */
export function parseMarkdownToSlice(editor: Editor, schema: Schema, text: string): Slice | null {
  const parser = editor.storage?.markdown?.parser
  if (!parser || typeof parser.parse !== 'function') return null

  // tiptap-markdown's storage.markdown.parser.parse() returns an HTML *string*
  // (NOT a ProseMirror Node), verified against the bundled tiptap-markdown
  // version — a 3-paragraph suggestion round-trips to 3 paragraph nodes. Parsed
  // without inline:true so block structure (paragraph breaks, headings) survives.
  // The typeof guard is a safety net: if a future library upgrade changes this to
  // return a Node, we degrade gracefully to the flat schema.text() path (the
  // multi-block fix stops firing, but nothing breaks). If that ever happens,
  // handle the Node return here rather than relying on the silent fallback.
  const html = parser.parse(text) as string
  if (typeof html !== 'string') return null

  // Parse the markdown-derived HTML into an inert, detached document via
  // DOMParser instead of assigning innerHTML on a live element. Per the project
  // security rule we never inject LLM-derived HTML into the live DOM; a document
  // from DOMParser.parseFromString executes no scripts and fires no event
  // handlers — we only read its structure to build a ProseMirror slice.
  const parsedDoc = new DOMParser().parseFromString(html, 'text/html')

  // parseSlice returns a slice with maxOpen ends (openStart/openEnd = 1 for a
  // fragment of paragraphs). That open slice is exactly what makes tr.replace
  // close the host node at markFrom, insert the inner blocks as siblings, and
  // reopen at markTo — so a whole-paragraph replacement yields clean sibling
  // paragraphs (verified: a 3-paragraph suggestion produces 3 paragraph nodes).
  // Caveat: replacing a *heading's* content with multi-block text merges the
  // first block into the heading; that's the related insert-anchor case in #571.
  return ProseMirrorDOMParser.fromSchema(schema).parseSlice(parsedDoc.body)
}

/**
 * Parse a single-line suggestion whose only markdown structure is inline
 * marks (bold/italic/code/links) into a ProseMirror slice, returning the
 * slice and its visible text. Returns null — meaning "use the byte-for-byte
 * schema.text() path" — for anything else:
 *   • plain text with no markdown syntax (visible text === raw text), so the
 *     overwhelmingly common case keeps its exact current behaviour;
 *   • multi-line input (block structure is the multi-block path's job;
 *     soft-breaks would desync annotation offsets);
 *   • parses to multiple blocks or a non-textblock (e.g. `- item` → list);
 *   • produces non-text inline nodes (images, breaks) whose positions don't
 *     map 1:1 onto visible-text offsets used by word-diff annotations.
 *
 * Why: suggestions arrive as markdown (read_document serializes the doc as
 * markdown, so the model replies in kind), but acceptance inserted the raw
 * string — `**bold**` landed as literal asterisks in the WYSIWYG doc
 * (TestFlight v1.6.1 report). The returned visible text must be used as the
 * annotation `newText` so word-diff offsets index the rendered document.
 */
function parseInlineSuggestion(
  editor: Editor,
  schema: Schema,
  suggestedText: string
): { slice: Slice; text: string } | null {
  if (suggestedText.includes('\n')) return null
  const slice = parseMarkdownToSlice(editor, schema, suggestedText)
  if (!slice || slice.content.childCount !== 1) return null
  const block = slice.content.firstChild
  if (!block || !block.isTextblock) return null
  let marksOnly = true
  block.content.forEach((inline) => {
    if (!inline.isText) marksOnly = false
  })
  if (!marksOnly) return null
  const text = block.textContent
  if (text === suggestedText) return null
  return { slice, text }
}

/**
 * Visible text of a parsed slice — top-level blocks' text joined by newline.
 * Used as the popover display text and the annotation `newText` for
 * block-converted suggestions (#673): annotation offsets must index the
 * rendered document, not the raw markdown source.
 */
export function sliceVisibleText(slice: Slice): string {
  const parts: string[] = []
  slice.content.forEach((child) => {
    parts.push(child.textContent)
  })
  return parts.join('\n')
}

/** Parse insertion content even when the markdown extension is unavailable. */
function parseInsertionSlice(editor: Editor, schema: Schema, text: string): Slice | null {
  const parsed = parseMarkdownToSlice(editor, schema, text)
  if (parsed) return parsed

  const blocks = text
    .split(/\r?\n(?:[ \t]*\r?\n)+/)
    .map((paragraph) => paragraph.replace(/\r?\n/g, ' ').trim())
    .filter(Boolean)
    .map((paragraph) => schema.nodes.paragraph.create(null, schema.text(paragraph)))
  return blocks.length > 0 ? new Slice(Fragment.fromArray(blocks), 0, 0) : null
}

/**
 * Locate a node carrying a persistent node ID without coupling this extension
 * to the NodeIds extension. The latter is optional in some focused tests.
 */
function findNodeWithId(
  doc: PMNode,
  nodeId: string,
): { node: PMNode; pos: number } | null {
  let found: { node: PMNode; pos: number } | null = null
  doc.descendants((node, pos) => {
    if (node.attrs.nodeId === nodeId) {
      found = { node, pos }
      return false
    }
    return !found
  })
  return found
}

/** Find an anchor by its visible text, preferring the occurrence nearest a
 * persisted position. Node IDs are regenerated when markdown is parsed, so
 * the text is the durable recovery key for block insertions. */
function findNodeWithText(
  doc: PMNode,
  text: string | undefined,
  preferredPos?: number,
): { node: PMNode; pos: number } | null {
  const expected = text?.trim()
  if (!expected) return null
  const matches: Array<{ node: PMNode; pos: number }> = []
  doc.descendants((node, pos) => {
    if (node.isBlock && node.textContent.trim() === expected) {
      matches.push({ node, pos })
    }
  })
  if (matches.length === 0) return null
  if (preferredPos === undefined) return matches[0]
  return matches.reduce((nearest, candidate) =>
    Math.abs(candidate.pos - preferredPos) < Math.abs(nearest.pos - preferredPos)
      ? candidate
      : nearest,
  )
}

/**
 * Find the complete sibling-block range belonging to an insertion. The mark
 * itself can only cover inline content, so rejection must expand it to the
 * surrounding blocks or it would leave empty paragraphs behind. The anchor ID
 * identifies the parent and the first inserted sibling even after positions
 * have shifted through unrelated edits.
 */
function insertionBlockRange(
  doc: PMNode,
  anchorNodeId: string | undefined,
  markFrom: number,
  markTo: number,
  anchorText?: string,
): { from: number; to: number } | null {
  if (anchorNodeId) {
    const anchor = findNodeWithId(doc, anchorNodeId)
    if (anchor) {
      const $anchor = doc.resolve(anchor.pos)
      const parentDepth = $anchor.depth
      const parent = $anchor.node(parentDepth)
      const parentStart = $anchor.start(parentDepth)
      const insertionStart = anchor.pos + anchor.node.nodeSize
      let first: { pos: number; nodeSize: number } | null = null
      let last: { pos: number; nodeSize: number } | null = null

      parent.forEach((child, offset) => {
        const pos = parentStart + offset
        const end = pos + child.nodeSize
        if (pos < insertionStart || end <= markFrom || pos >= markTo) return
        if (!first) first = { pos, nodeSize: child.nodeSize }
        last = { pos, nodeSize: child.nodeSize }
      })

      if (first && last) {
        return { from: first.pos, to: last.pos + last.nodeSize }
      }
    }
  }

  // Node IDs are regenerated when markdown is parsed. A persisted insertion
  // therefore needs its anchor text as a second recovery key when a live
  // revision or decision arrives after a document reload.
  const textAnchor = findNodeWithText(doc, anchorText, markFrom)
  if (textAnchor) {
    const $anchor = doc.resolve(textAnchor.pos)
    const parentDepth = $anchor.depth
    const parent = $anchor.node(parentDepth)
    const parentStart = $anchor.start(parentDepth)
    const insertionStart = textAnchor.pos + textAnchor.node.nodeSize
    let first: { pos: number; nodeSize: number } | null = null
    let last: { pos: number; nodeSize: number } | null = null

    parent.forEach((child, offset) => {
      const pos = parentStart + offset
      const end = pos + child.nodeSize
      if (pos < insertionStart || end <= markFrom || pos >= markTo) return
      if (!first) first = { pos, nodeSize: child.nodeSize }
      last = { pos, nodeSize: child.nodeSize }
    })
    if (first && last) return { from: first.pos, to: last.pos + last.nodeSize }
  }

  // Legacy/manual insertion marks have no anchor metadata. Expand to the
  // top-level blocks containing the marked range as a safe fallback.
  let first: { pos: number; nodeSize: number } | null = null
  let last: { pos: number; nodeSize: number } | null = null
  doc.forEach((child, offset) => {
    const end = offset + child.nodeSize
    if (offset < markTo && end > markFrom) {
      if (!first) first = { pos: offset, nodeSize: child.nodeSize }
      last = { pos: offset, nodeSize: child.nodeSize }
    }
  })
  return first && last
    ? { from: first.pos, to: last.pos + last.nodeSize }
    : null
}

/** Find the marked inline range inside complete inserted blocks. */
function insertionContentRange(
  doc: PMNode,
  from: number,
  to: number,
): { from: number; to: number } | null {
  let first: number | null = null
  let last: number | null = null
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText || !node.text) return
    if (first === null) first = pos
    last = pos + node.nodeSize
  })
  return first === null || last === null ? null : { from: first, to: last }
}

/**
 * Resolve the complete block targeted by a pending deletion. Keeping this
 * geometry separate from the marked inline range lets a deletion accept as a
 * real node removal while rejection only removes the review mark.
 */
function deletionBlockRange(
  doc: PMNode,
  targetNodeId: string | undefined,
  markFrom: number,
  markTo: number,
): { from: number; to: number } | null {
  if (targetNodeId) {
    const target = findNodeWithId(doc, targetNodeId)
    if (target) {
      const $target = doc.resolve(target.pos)
      const parent = $target.parent
      // Preserve a valid empty textblock when it is the document's only
      // child. For all other cases remove the complete target node.
      if (parent.type.name === 'doc' && parent.childCount === 1 && target.node.isTextblock) {
        return {
          from: target.pos + 1,
          to: target.pos + target.node.nodeSize - 1,
        }
      }
      return { from: target.pos, to: target.pos + target.node.nodeSize }
    }
  }

  // Legacy/manual deletion marks have no target metadata. Expand to the
  // smallest textblock intersecting the marked range, preserving its parent
  // structure and avoiding a partial deletion that leaves a ghost mark.
  let result: { from: number; to: number } | null = null
  doc.nodesBetween(markFrom, markTo, (node, pos) => {
    if (!result && node.isTextblock && pos <= markFrom && pos + node.nodeSize >= markTo) {
      result = { from: pos, to: pos + node.nodeSize }
    }
    return !result
  })
  return result ?? { from: markFrom, to: markTo }
}

/** Resolve the complete block span immediately following an insertion anchor. */
function insertedBlockRangeAfterAnchor(
  doc: PMNode,
  anchorNodeId: string | undefined,
  expectedSize: number,
  anchorText?: string,
  preferredPos?: number,
): { from: number; to: number } | null {
  if (expectedSize <= 0) return null
  const anchor = findNodeWithId(doc, anchorNodeId) ?? findNodeWithText(doc, anchorText, preferredPos)
  if (!anchor) return null

  const $anchor = doc.resolve(anchor.pos)
  const parentDepth = $anchor.depth
  const parent = $anchor.node(parentDepth)
  const parentStart = $anchor.start(parentDepth)
  const insertionStart = anchor.pos + anchor.node.nodeSize
  let from: number | null = null
  let to: number | null = null
  let size = 0

  parent.forEach((child, offset) => {
    const pos = parentStart + offset
    if (pos < insertionStart || to !== null) return
    if (from === null) from = pos
    size += child.nodeSize
    if (size === expectedSize) to = pos + child.nodeSize
    if (size > expectedSize) {
      from = null
      to = null
    }
  })

  return from !== null && to !== null ? { from, to } : null
}

/** Find a contiguous run of sibling blocks by its parsed size and visible
 * text. This recovers insertions when the anchor ID and persisted positions
 * are stale after markdown was re-parsed. */
function findBlockSequence(
  doc: PMNode,
  expectedSize: number,
  expectedText: string,
  preferredFrom?: number,
  preferredTo?: number,
): { from: number; to: number } | null {
  const matches: Array<{ from: number; to: number }> = []

  const visit = (parent: PMNode, parentPos: number): void => {
    const children: Array<{ node: PMNode; pos: number }> = []
    parent.forEach((node, offset) => {
      const pos = parent.type.name === 'doc' ? offset : parentPos + 1 + offset
      children.push({ node, pos })
    })

    for (let start = 0; start < children.length; start += 1) {
      let size = 0
      const text: string[] = []
      for (let end = start; end < children.length; end += 1) {
        const child = children[end]
        size += child.node.nodeSize
        text.push(child.node.textContent)
        if (size > expectedSize) break
        if (size === expectedSize && text.join('\n') === expectedText) {
          matches.push({ from: children[start].pos, to: child.pos + child.node.nodeSize })
          break
        }
      }
    }

    children.forEach(({ node, pos }) => {
      if (node.content.size > 0) visit(node, pos)
    })
  }

  visit(doc, -1)
  if (matches.length === 0) return null
  const intersectsPreferred = matches.find(({ from, to }) =>
    preferredFrom !== undefined && preferredTo !== undefined && from < preferredTo && to > preferredFrom,
  )
  if (intersectsPreferred) return intersectsPreferred
  if (preferredFrom === undefined) return matches[0]
  return matches.reduce((nearest, candidate) =>
    Math.abs(candidate.from - preferredFrom) < Math.abs(nearest.from - preferredFrom)
      ? candidate
      : nearest,
  )
}

/**
 * Block-type conversion on accept (#673): parse the suggestion's original
 * markdown (`blockConversionIntent` mark attr) and replace the WHOLE host
 * textblock with the parsed block(s) as a closed slice — converting the
 * node's type (paragraph → heading/blockquote/list/codeBlock, heading level
 * changes). A closed slice (openStart/openEnd = 0) substitutes complete
 * nodes; an open slice here would merge the parsed content back into the
 * host node and lose the conversion.
 *
 * `from`/`to` are the suggestion mark's range in the CURRENT doc coordinates
 * of `tr` — callers batching multiple conversions must process end-to-start.
 *
 * Returns the inserted geometry for annotation creation, or null when the
 * host node or parser is unavailable (caller falls through to the text
 * replacement paths).
 */
function applyBlockConversion(
  tr: Transaction,
  doc: PMNode,
  editor: Editor,
  schema: Schema,
  from: number,
  to: number,
  intentMarkdown: string
): { insertedAt: number; insertedSize: number; singleTextblock: boolean; visibleText: string } | null {
  let blockPos = -1
  let blockNodeSize = 0
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock) {
      blockPos = pos
      blockNodeSize = node.nodeSize
      return false
    }
    return true
  })
  if (blockPos < 0) return null

  const slice = parseMarkdownToSlice(editor, schema, intentMarkdown)
  if (!slice || slice.content.childCount === 0) return null

  const closed = new Slice(slice.content, 0, 0)
  tr.replace(blockPos, blockPos + blockNodeSize, closed)

  return {
    insertedAt: blockPos,
    insertedSize: slice.content.size,
    singleTextblock: slice.content.childCount === 1 && slice.content.firstChild!.isTextblock,
    visibleText: sliceVisibleText(slice),
  }
}

/**
 * Markdown serializer for AI suggestion marks - outputs just the text content
 */
export const aiSuggestionMarkdownSerializer: MarkSerializerSpec = {
  open: '',
  close: '',
  mixable: true,
  expelEnclosingWhitespace: true,
}

export const aiSuggestionProposalPluginKey = new PluginKey('aiSuggestionProposals')

interface SuggestionProposalAttrs {
  id: string
  type: SuggestionType
  originalText: string
  suggestedText: string
  explanation: string
  userReply?: string
  humanInline?: boolean
  provenanceSource?: 'ui' | 'chat' | 'mcp' | 'unknown'
  provenanceModel?: string
}

/** Build a widget that exposes a replacement's proposed wording at its anchor. */
function createProposalWidget(attrs: SuggestionProposalAttrs): HTMLElement {
  const element = document.createElement('span')
  element.className = 'ai-suggestion-mark ai-suggestion-proposal'
  element.setAttribute('data-ai-suggestion-id', attrs.id)
  element.setAttribute('data-ai-suggestion-type', attrs.type)
  element.setAttribute('data-ai-original', attrs.originalText)
  element.setAttribute('data-ai-suggested', attrs.suggestedText)
  element.setAttribute('data-ai-explanation', attrs.explanation)
  if (attrs.humanInline) element.setAttribute('data-human-inline', 'true')
  if (attrs.provenanceSource) element.setAttribute('data-provenance-source', attrs.provenanceSource)
  if (attrs.provenanceModel) element.setAttribute('data-provenance-model', attrs.provenanceModel)
  if (attrs.userReply) element.setAttribute('data-ai-user-reply', attrs.userReply)
  element.setAttribute('aria-label', `Proposed text: ${attrs.suggestedText}`)
  element.textContent = attrs.suggestedText
  return element
}

/** Collect one inline proposal widget per pending replacement mark. */
function suggestionProposalDecorations(doc: PMNode): Decoration[] {
  const ranges = new Map<string, { from: number; to: number; attrs: SuggestionProposalAttrs }>()
  doc.descendants((node, pos) => {
    const mark = node.marks.find((candidate) => candidate.type.name === 'aiSuggestion')
    if (!mark || !mark.attrs.id || mark.attrs.type !== 'edit' || !mark.attrs.suggestedText) return
    const existing = ranges.get(mark.attrs.id)
    const attrs: SuggestionProposalAttrs = {
      id: mark.attrs.id,
      type: 'edit',
      originalText: mark.attrs.originalText || '',
      suggestedText: mark.attrs.suggestedText || '',
      explanation: mark.attrs.explanation || '',
      userReply: mark.attrs.userReply || undefined,
      humanInline: mark.attrs.humanInline === true,
      provenanceSource: mark.attrs.provenanceSource || undefined,
      provenanceModel: mark.attrs.provenanceModel || undefined,
    }
    ranges.set(mark.attrs.id, existing
      ? { ...existing, to: Math.max(existing.to, pos + node.nodeSize) }
      : { from: pos, to: pos + node.nodeSize, attrs })
  })

  return Array.from(ranges.values())
    .filter(({ from, to }) => from < to && to <= doc.content.size)
    .map(({ to, attrs }) => Decoration.widget(
      to,
      () => createProposalWidget(attrs),
      { key: `ai-suggestion-proposal-${attrs.id}`, side: 1 },
    ))
}

function suggestionDataFromAttrs(
  attrs: Record<string, unknown>,
  from: number,
  to: number,
): AISuggestionData {
  const source = attrs.provenanceSource
  const provenanceSource = source === 'chat' || source === 'mcp' || source === 'unknown'
    ? source
    : undefined
  const supersedes = Array.isArray(attrs.supersedes)
    ? attrs.supersedes.filter((id): id is string => typeof id === 'string')
    : undefined

  return {
    id: typeof attrs.id === 'string' ? attrs.id : '',
    type: attrs.type === 'insertion'
      ? 'insertion'
      : attrs.type === 'deletion'
        ? 'deletion'
        : 'edit',
    originalText: typeof attrs.originalText === 'string' ? attrs.originalText : '',
    suggestedText: typeof attrs.suggestedText === 'string' ? attrs.suggestedText : '',
    explanation: typeof attrs.explanation === 'string' ? attrs.explanation : '',
    createdAt: typeof attrs.createdAt === 'number' ? attrs.createdAt : Date.now(),
    from,
    to,
    userReply: typeof attrs.userReply === 'string' ? attrs.userReply : undefined,
    provenanceModel: typeof attrs.provenanceModel === 'string' ? attrs.provenanceModel : undefined,
    provenanceConversationId: typeof attrs.provenanceConversationId === 'string'
      ? attrs.provenanceConversationId
      : undefined,
    provenanceMessageId: typeof attrs.provenanceMessageId === 'string'
      ? attrs.provenanceMessageId
      : undefined,
    provenanceSource,
    provenanceInvocationId: typeof attrs.provenanceInvocationId === 'string'
      ? attrs.provenanceInvocationId
      : undefined,
    insertionAnchorNodeId: typeof attrs.insertionAnchorNodeId === 'string'
      ? attrs.insertionAnchorNodeId
      : undefined,
    insertionAnchorText: typeof attrs.insertionAnchorText === 'string'
      ? attrs.insertionAnchorText
      : undefined,
    deletionNodeId: typeof attrs.deletionNodeId === 'string'
      ? attrs.deletionNodeId
      : undefined,
    supersedes,
    documentId: typeof attrs.documentId === 'string' ? attrs.documentId : undefined,
    blockConversionIntent: typeof attrs.blockConversionIntent === 'string'
      ? attrs.blockConversionIntent
      : null,
  }
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    aiSuggestion: {
      /**
       * Add an AI suggestion to the current selection (for edits)
       */
      setAISuggestion: (attrs: {
        id: string
        type: SuggestionType
        originalText: string
        suggestedText: string
        explanation: string
        provenanceModel?: string
        provenanceConversationId?: string
        provenanceMessageId?: string
        documentId?: string
        provenanceSource?: 'chat' | 'mcp' | 'unknown'
        provenanceInvocationId?: string
        insertionAnchorNodeId?: string
        insertionAnchorText?: string
        deletionNodeId?: string
        supersedes?: string[]
        /** Raw markdown for a block-type conversion (#673); null/absent = text replacement */
        blockConversionIntent?: string | null
      }) => ReturnType
      /**
       * Set user reply on an AI suggestion by ID
       */
      setAISuggestionReply: (id: string, reply: string, actor?: ReviewActor) => ReturnType
      /**
       * Accept an AI suggestion by ID - replaces text with suggested text
       */
      acceptAISuggestion: (id: string, actor?: ReviewActor) => ReturnType
      /**
       * Reject an AI suggestion by ID - removes the mark
       */
      rejectAISuggestion: (id: string, actor?: ReviewActor) => ReturnType
      /**
       * Accept all AI suggestions
       */
      acceptAllAISuggestions: (actor?: ReviewActor) => ReturnType
      /**
       * Reject all AI suggestions
       */
      rejectAllAISuggestions: (actor?: ReviewActor) => ReturnType
      /**
       * Restore AI suggestions from persisted data (used after tab switch)
       */
      restoreAISuggestions: (suggestions: AISuggestionData[]) => ReturnType
      /** Replace a pending block insertion while preserving review semantics. */
      reviseAISuggestion: (id: string, attrs: {
        id: string
        type: 'insertion'
        originalText: string
        suggestedText: string
        explanation: string
        provenanceModel?: string
        provenanceConversationId?: string
        provenanceMessageId?: string
        documentId?: string
        provenanceSource?: 'chat' | 'mcp' | 'unknown'
        provenanceInvocationId?: string
        insertionAnchorNodeId?: string
        insertionAnchorText?: string
        supersedes?: string[]
      }) => ReturnType
    }
  }
}

export const AISuggestion = Mark.create<AISuggestionOptions>({
  name: 'aiSuggestion',

  addOptions() {
    return {
      HTMLAttributes: {},
      onSuggestionAdded: undefined,
      onSuggestionFeedback: undefined,
      onSuggestionAccepted: undefined,
      onSuggestionRejected: undefined,
    }
  },

  addStorage() {
    return {
      markdown: {
        serialize: aiSuggestionMarkdownSerializer,
      },
    }
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-ai-suggestion-id'),
        renderHTML: (attributes) => {
          if (!attributes.id) return {}
          return { 'data-ai-suggestion-id': attributes.id }
        },
      },
      type: {
        default: 'edit',
        parseHTML: (element) => element.getAttribute('data-ai-suggestion-type') || 'edit',
        renderHTML: (attributes) => {
          return { 'data-ai-suggestion-type': attributes.type || 'edit' }
        },
      },
      originalText: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-ai-original'),
        renderHTML: (attributes) => {
          return { 'data-ai-original': attributes.originalText || '' }
        },
      },
      suggestedText: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-ai-suggested'),
        renderHTML: (attributes) => {
          return { 'data-ai-suggested': attributes.suggestedText || '' }
        },
      },
      explanation: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-ai-explanation'),
        renderHTML: (attributes) => {
          return { 'data-ai-explanation': attributes.explanation || '' }
        },
      },
      createdAt: {
        default: null,
        parseHTML: (element) => {
          const val = element.getAttribute('data-ai-created')
          return val ? parseInt(val, 10) : null
        },
        renderHTML: (attributes) => {
          if (!attributes.createdAt) return {}
          return { 'data-ai-created': String(attributes.createdAt) }
        },
      },
      userReply: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-ai-user-reply'),
        renderHTML: (attributes) => {
          if (!attributes.userReply) return {}
          return { 'data-ai-user-reply': attributes.userReply }
        },
      },
      provenanceModel: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-provenance-model'),
        renderHTML: (attributes) => {
          if (!attributes.provenanceModel) return {}
          return { 'data-provenance-model': attributes.provenanceModel }
        },
      },
      provenanceConversationId: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-provenance-conversation'),
        renderHTML: (attributes) => {
          if (!attributes.provenanceConversationId) return {}
          return { 'data-provenance-conversation': attributes.provenanceConversationId }
        },
      },
      provenanceMessageId: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-provenance-message'),
        renderHTML: (attributes) => {
          if (!attributes.provenanceMessageId) return {}
          return { 'data-provenance-message': attributes.provenanceMessageId }
        },
      },
      provenanceSource: {
        default: 'unknown',
        parseHTML: (element) => element.getAttribute('data-provenance-source') || 'unknown',
        renderHTML: (attributes) => {
          if (!attributes.provenanceSource) return {}
          return { 'data-provenance-source': attributes.provenanceSource }
        },
      },
      provenanceInvocationId: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-provenance-invocation'),
        renderHTML: (attributes) => {
          if (!attributes.provenanceInvocationId) return {}
          return { 'data-provenance-invocation': attributes.provenanceInvocationId }
        },
      },
      insertionAnchorNodeId: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-ai-insertion-anchor'),
        renderHTML: (attributes) => {
          if (!attributes.insertionAnchorNodeId) return {}
          return { 'data-ai-insertion-anchor': attributes.insertionAnchorNodeId }
        },
      },
      insertionAnchorText: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-ai-insertion-anchor-text'),
        renderHTML: (attributes) => {
          if (!attributes.insertionAnchorText) return {}
          return { 'data-ai-insertion-anchor-text': attributes.insertionAnchorText }
        },
      },
      deletionNodeId: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-ai-deletion-node'),
        renderHTML: (attributes) => {
          if (!attributes.deletionNodeId) return {}
          return { 'data-ai-deletion-node': attributes.deletionNodeId }
        },
      },
      supersedes: {
        default: null,
        parseHTML: (element) => {
          const value = element.getAttribute('data-ai-supersedes')
          if (!value) return null
          try {
            const parsed = JSON.parse(value)
            return Array.isArray(parsed) ? parsed : null
          } catch {
            return null
          }
        },
        renderHTML: (attributes) => {
          if (!Array.isArray(attributes.supersedes) || attributes.supersedes.length === 0) return {}
          return { 'data-ai-supersedes': JSON.stringify(attributes.supersedes) }
        },
      },
      documentId: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-document-id'),
        renderHTML: (attributes) => {
          if (!attributes.documentId) return {}
          return { 'data-document-id': attributes.documentId }
        },
      },
      // Raw markdown of a block-type conversion (#673) — set by
      // executeSuggestEdit when the suggestion's content opens with block
      // markup differing from the host node. The accept path parses it and
      // replaces the whole host node, converting its type.
      blockConversionIntent: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-ai-block-intent'),
        renderHTML: (attributes) => {
          if (!attributes.blockConversionIntent) return {}
          return { 'data-ai-block-intent': attributes.blockConversionIntent }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-ai-suggestion-id]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes || {}, HTMLAttributes, {
        class: 'ai-suggestion-mark',
      }),
      0,
    ]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: aiSuggestionProposalPluginKey,
        state: {
          init: (_config, state) => DecorationSet.create(
            state.doc,
            suggestionProposalDecorations(state.doc),
          ),
          apply: (tr, pluginState, _oldState, newState) => {
            if (!tr.docChanged) return pluginState
            return DecorationSet.create(
              newState.doc,
              suggestionProposalDecorations(newState.doc),
            )
          },
        },
        props: {
          decorations(state) {
            return aiSuggestionProposalPluginKey.getState(state) ?? DecorationSet.empty
          },
        },
      }),
    ]
  },

  addCommands() {
    return {
      setAISuggestion:
        (attrs) =>
        ({ commands, state }) => {
          const { from, to } = state.selection
          const createdAt = Date.now()

          const suggestionData: AISuggestionData = {
            id: attrs.id,
            type: attrs.type,
            originalText: attrs.originalText,
            suggestedText: attrs.suggestedText,
            explanation: attrs.explanation,
            createdAt,
            from,
            to,
            provenanceModel: attrs.provenanceModel || undefined,
            provenanceConversationId: attrs.provenanceConversationId || undefined,
            provenanceMessageId: attrs.provenanceMessageId || undefined,
            documentId: attrs.documentId || undefined,
            provenanceSource: attrs.provenanceSource || 'unknown',
            provenanceInvocationId: attrs.provenanceInvocationId || undefined,
            insertionAnchorNodeId: attrs.insertionAnchorNodeId || undefined,
            insertionAnchorText: attrs.insertionAnchorText || undefined,
            deletionNodeId: attrs.deletionNodeId || undefined,
            supersedes: attrs.supersedes,
            blockConversionIntent: attrs.blockConversionIntent ?? null,
          }

          const result = commands.setMark(this.name, {
            id: attrs.id,
            type: attrs.type,
            originalText: attrs.originalText,
            suggestedText: attrs.suggestedText,
            explanation: attrs.explanation,
            createdAt,
            provenanceModel: attrs.provenanceModel || '',
            provenanceConversationId: attrs.provenanceConversationId || '',
            provenanceMessageId: attrs.provenanceMessageId || '',
            provenanceSource: attrs.provenanceSource || 'unknown',
            provenanceInvocationId: attrs.provenanceInvocationId || '',
            insertionAnchorNodeId: attrs.insertionAnchorNodeId || '',
            insertionAnchorText: attrs.insertionAnchorText || '',
            deletionNodeId: attrs.deletionNodeId || '',
            supersedes: attrs.supersedes || null,
            documentId: attrs.documentId || '',
            blockConversionIntent: attrs.blockConversionIntent ?? null,
          })

          if (result && this.options.onSuggestionAdded) {
            this.options.onSuggestionAdded(suggestionData)
          }

          return result
        },

      setAISuggestionReply:
        (id, reply, actor = { kind: 'user', source: 'ui' }) =>
        ({ tr, state, dispatch }) => {
          if (!dispatch) return false

          const { doc } = state
          const positions: Array<{ pos: number; nodeSize: number; mark: typeof state.schema.marks.aiSuggestion }> = []
          let existingAttrs: Record<string, unknown> | null = null

          // Find all nodes with this suggestion mark
          doc.descendants((node, pos) => {
            node.marks.forEach((mark) => {
              if (mark.type.name === this.name && mark.attrs.id === id) {
                if (!existingAttrs) {
                  existingAttrs = mark.attrs
                }
                positions.push({ pos, nodeSize: node.nodeSize, mark: mark.type })
              }
            })
          })

          if (positions.length === 0 || !existingAttrs) return false
          const attrs = existingAttrs

          // Calculate the full range
          const markFrom = positions[0].pos
          const lastPos = positions[positions.length - 1]
          const markTo = lastPos.pos + lastPos.nodeSize

          // Remove the old mark and add new one with userReply
          tr.removeMark(markFrom, markTo, state.schema.marks.aiSuggestion)
          tr.addMark(
            markFrom,
            markTo,
            state.schema.marks.aiSuggestion.create({
              ...attrs,
              userReply: reply
            })
          )

          dispatch(tr)

          const updatedSuggestion: AISuggestionData = {
            ...suggestionDataFromAttrs(attrs, markFrom, markTo),
            userReply: reply,
          }
          const feedback: SuggestionFeedback = {
            text: reply,
            createdAt: Date.now(),
            actor,
          }
          if (this.options.onSuggestionFeedback) {
            this.options.onSuggestionFeedback(updatedSuggestion, feedback)
          }
          return true
        },

      acceptAISuggestion:
        (id, actor = { kind: 'user', source: 'ui' }) =>
        ({ tr, state, dispatch, editor }) => {
          if (!dispatch) return false

          const { doc } = state
          let suggestionAttrs: Record<string, unknown> | null = null
          const positions: Array<{ pos: number; nodeSize: number }> = []

          // Find all nodes with this suggestion mark (mark can span multiple text nodes
          // when inline formatting like bold/italic is present)
          doc.descendants((node, pos) => {
            node.marks.forEach((mark) => {
              if (mark.type.name === this.name && mark.attrs.id === id) {
                if (!suggestionAttrs) {
                  suggestionAttrs = mark.attrs
                }
                positions.push({ pos, nodeSize: node.nodeSize })
              }
            })
          })

          if (positions.length === 0 || !suggestionAttrs) return false

          // Calculate the full range from first to last node
          const markFrom = positions[0].pos
          const lastPos = positions[positions.length - 1]
          const markTo = lastPos.pos + lastPos.nodeSize
          const acceptedSuggestion = suggestionDataFromAttrs(suggestionAttrs, markFrom, markTo)

          // Get the suggested text
          const suggestedText = (suggestionAttrs as { suggestedText?: string }).suggestedText || ''

          // Remove the mark first
          tr.removeMark(markFrom, markTo, state.schema.marks.aiSuggestion)

          const isInsertion = (suggestionAttrs as { type?: string }).type === 'insertion'
          const isDeletion = (suggestionAttrs as { type?: string }).type === 'deletion'

          // Replace the text with suggested text, or delete if empty.
          //
          // Block-conversion path (#673): the suggestion carries a
          // blockConversionIntent (raw markdown opening with block markup that
          // differs from the host node, e.g. `# Title` on a paragraph). Parse
          // it and replace the WHOLE host node — converting its type.
          //
          // Multi-block path (#578 structural fix): when suggestedText contains
          // `\n\n` it has paragraph-level structure that schema.text() would
          // collapse into a single inline run. Parse it through the
          // tiptap-markdown parser instead to preserve block nodes.
          //
          // Inline-markdown path: a single-line suggestion carrying inline
          // syntax (`**bold**`, `*italic*`, `` `code` ``, links) parses into
          // real marks instead of landing as literal characters; the parsed
          // visible text replaces suggestedText for annotation offsets.
          //
          // Plain single-block path (the overwhelmingly common case — a
          // sentence or phrase edit with no markdown): schema.text() is kept
          // byte-for-byte so annotation position math and current behaviour
          // are untouched.
          const blockIntent =
            (suggestionAttrs as { blockConversionIntent?: string | null }).blockConversionIntent ?? null
          let annotationNewText = suggestedText
          let acceptPath: 'insertion' | 'deletion' | 'blockConversion' | 'multiBlock' | 'inline' | 'literal' | 'delete' = 'literal'
          let conversion: ReturnType<typeof applyBlockConversion> = null
          let acceptedDeletionRange: { from: number; to: number } | null = null
          if (isInsertion) {
            // Insertions are already present in the document as marked blocks.
            // Accepting only removes the review mark; replacing the range with
            // suggestedText would duplicate or flatten parsed markdown.
            acceptPath = 'insertion'
          } else if (isDeletion) {
            acceptedDeletionRange = deletionBlockRange(
              state.doc,
              typeof (suggestionAttrs as { deletionNodeId?: unknown }).deletionNodeId === 'string'
                ? (suggestionAttrs as { deletionNodeId: string }).deletionNodeId
                : undefined,
              markFrom,
              markTo,
            )
            if (acceptedDeletionRange) {
              tr.delete(acceptedDeletionRange.from, acceptedDeletionRange.to)
            } else {
              tr.delete(markFrom, markTo)
            }
            acceptPath = 'deletion'
          } else if (suggestedText.length > 0) {
            if (blockIntent) {
              conversion = applyBlockConversion(tr, state.doc, editor, state.schema, markFrom, markTo, blockIntent)
            }
            if (conversion) {
              annotationNewText = conversion.visibleText
              acceptPath = 'blockConversion'
            } else if (isMultiBlock(suggestedText)) {
              acceptPath = 'multiBlock'
              const slice = parseMarkdownToSlice(editor, state.schema, suggestedText)
              if (slice) {
                tr.replace(markFrom, markTo, slice)
              } else {
                // Parser unavailable — fall back to flat text rather than dropping the edit.
                acceptPath = 'literal'
                tr.replaceWith(markFrom, markTo, state.schema.text(suggestedText))
              }
            } else {
              const inline = parseInlineSuggestion(editor, state.schema, suggestedText)
              if (inline) {
                acceptPath = 'inline'
                tr.replace(markFrom, markTo, inline.slice)
                annotationNewText = inline.text
              } else {
                tr.replaceWith(markFrom, markTo, state.schema.text(suggestedText))
              }
            }
          } else {
            acceptPath = 'delete'
            tr.delete(markFrom, markTo)
          }
          pipelineLog('accept:path', {
            id,
            path: acceptPath,
            markFrom,
            markTo,
            suggestedTextPreview: suggestedText.substring(0, 60),
          })

          // Create AI annotation for provenance tracking
          const attrs = suggestionAttrs as {
            type?: string
            provenanceModel?: string
            provenanceConversationId?: string
            provenanceMessageId?: string
            documentId?: string
            originalText?: string
            explanation?: string
          }

          // Use fallbacks: store's documentId, or 'unknown' for model
          const annotationStore = useAnnotationStore.getState()
          const docId = attrs.documentId || annotationStore.documentId
          const model = attrs.provenanceModel || 'unknown'
          const originalText = attrs.originalText || ''
          const explanation = attrs.explanation || ''

          // Capture annotations overlapping the replaced range BEFORE
          // dispatch (#674) — position mapping will collapse them; passing
          // them to createWordDiffAnnotations lets unchanged words keep
          // their prior provenance marks (parity with executeEdit's
          // priorAnnotations capture in executors/editor.ts).
          const priorAnnotations = docId
            ? annotationStore.annotations.filter(
                (a) => !a.detached && a.documentId === docId && a.to > markFrom && a.from < markTo
              )
            : []

          dispatch(tr)

          // Create word-level annotations in a MICROTASK (#674). TipTap
          // applies the command's transaction after the command body returns
          // — creating annotations inline here would run BEFORE the
          // aiAnnotations plugin maps existing annotations through this
          // transaction, and addAnnotation's position-update pause would
          // then swallow that mapping pass entirely. The result was stale
          // positions on every pre-existing annotation (collapse-detection
          // starved → entries never detached, decorations drifted). Deferring
          // lets the plugin map (and detach) old annotations first; the new
          // annotation's coordinates come from tr.mapping and stay valid.
          if (docId && isDeletion) {
            const provenance = {
              model,
              conversationId: attrs.provenanceConversationId || '',
              messageId: attrs.provenanceMessageId || '',
            }
            queueMicrotask(() => {
              const deletionPoint = tr.mapping.map(
                acceptedDeletionRange?.from ?? markFrom,
                -1,
              )
              annotationStore.addAnnotation({
                documentId: docId,
                type: 'deletion',
                from: deletionPoint,
                to: deletionPoint,
                content: originalText,
                provenance,
                explanation: explanation || undefined,
              })
            })
          } else if (docId && suggestedText.length > 0) {
            const provenance = {
              model,
              conversationId: attrs.provenanceConversationId || '',
              messageId: attrs.provenanceMessageId || '',
            }
            queueMicrotask(() => {
              if (conversion && conversion.singleTextblock) {
                // Converted node sits at its pre-replace position (nothing
                // before it shifted); content starts one position inside the
                // node's opening token — word-diff offsets index that content.
                createWordDiffAnnotations({
                  documentId: docId,
                  originalText,
                  newText: annotationNewText,
                  rangeFrom: conversion.insertedAt + 1,
                  rangeTo: conversion.insertedAt + 1 + conversion.visibleText.length,
                  provenance,
                  explanation: explanation || undefined,
                })
              } else if (conversion) {
                // Wrapper conversion (blockquote/list) or multi-node result:
                // nested structure breaks linear text-offset math — record a
                // single full-range annotation over the inserted content.
                useAnnotationStore.getState().addAnnotation({
                  documentId: docId,
                  type: 'replacement',
                  from: conversion.insertedAt,
                  to: conversion.insertedAt + conversion.insertedSize,
                  content: conversion.visibleText,
                  provenance,
                  explanation: explanation || undefined,
                })
              } else {
                // Coordinate-consistency note (#677 review): priorAnnotations
                // carry PRE-dispatch from/to, while rangeFrom is mapped
                // through tr. This command's only position-shifting step is
                // the mark-range replacement itself (removeMark doesn't move
                // positions), so map(markFrom, -1) === markFrom and
                // diffUtils' originalContentStart (= rangeFrom) stays in the
                // same coordinate space as the prior annotations.
                const newFrom = tr.mapping.map(markFrom, -1)
                const newTo = tr.mapping.map(markTo, 1)
                console.log('[AISuggestion] Creating annotation:', { docId, model, from: newFrom, to: newTo })
                createWordDiffAnnotations({
                  documentId: docId,
                  originalText,
                  // Parsed visible text when the inline-markdown path fired —
                  // word-diff offsets must index the rendered document, not the
                  // raw markdown source.
                  newText: annotationNewText,
                  rangeFrom: newFrom,
                  rangeTo: newTo,
                  provenance,
                  explanation: explanation || undefined,
                  priorAnnotations,
                })
              }
            })
          } else {
            console.warn('[AISuggestion] Cannot create annotation - missing docId:', { docId, suggestedText: suggestedText.length })
          }

          if (this.options.onSuggestionAccepted) {
            this.options.onSuggestionAccepted(acceptedSuggestion, actor)
          }

          return true
        },

      rejectAISuggestion:
        (id, actor = { kind: 'user', source: 'ui' }) =>
        ({ tr, state, dispatch }) => {
          if (!dispatch) return false

          const { doc } = state
          let suggestionAttrs: Record<string, unknown> | null = null
          const positions: Array<{ pos: number; nodeSize: number }> = []

          // Find all nodes with this suggestion mark (mark can span multiple text nodes
          // when inline formatting like bold/italic is present)
          doc.descendants((node, pos) => {
            node.marks.forEach((mark) => {
              if (mark.type.name === this.name && mark.attrs.id === id) {
                if (!suggestionAttrs) suggestionAttrs = mark.attrs
                positions.push({ pos, nodeSize: node.nodeSize })
              }
            })
          })

          if (positions.length === 0 || !suggestionAttrs) return false

          // Calculate the full range from first to last node
          const markFrom = positions[0].pos
          const lastPos = positions[positions.length - 1]
          const markTo = lastPos.pos + lastPos.nodeSize
          const rejectedSuggestion = suggestionDataFromAttrs(suggestionAttrs, markFrom, markTo)

          if (suggestionAttrs.type === 'insertion') {
            // The candidate blocks were inserted when the suggestion was
            // created. Rejection must remove those blocks as well as the mark;
            // deleting only the inline mark would leave rejected prose in the
            // document (and often an empty paragraph behind).
            const range = insertionBlockRange(
              doc,
              typeof suggestionAttrs.insertionAnchorNodeId === 'string'
                ? suggestionAttrs.insertionAnchorNodeId
                : undefined,
              markFrom,
              markTo,
            )
            if (range) {
              tr.delete(range.from, range.to)
            } else {
              tr.removeMark(markFrom, markTo, state.schema.marks.aiSuggestion)
            }
          } else {
            // Remove the mark across the entire range
            tr.removeMark(markFrom, markTo, state.schema.marks.aiSuggestion)
          }

          dispatch(tr)

          if (this.options.onSuggestionRejected) {
            this.options.onSuggestionRejected(rejectedSuggestion, actor)
          }

          return true
        },

      acceptAllAISuggestions:
        (actor = { kind: 'user', source: 'ui' }) =>
        ({ tr, state, dispatch, editor }) => {
          if (!dispatch) return false

          const { doc } = state

          // Collect all suggestions with their positions and data
          // We need to process from end to start to avoid position shifts
          const suggestions: Array<{
            id: string
            type: SuggestionType
            createdAt: number
            from: number
            to: number
            suggestedText: string
            blockConversionIntent: string | null
            originalText: string
            explanation: string
            provenanceModel: string
            provenanceConversationId: string
            provenanceMessageId: string
            provenanceSource: 'chat' | 'mcp' | 'unknown'
            provenanceInvocationId: string
            insertionAnchorNodeId?: string
            deletionNodeId?: string
            supersedes: string[]
            documentId: string
            userReply?: string
          }> = []

          // First pass: collect all unique suggestion IDs and their ranges
          const seenIds = new Set<string>()
          doc.descendants((node) => {
            node.marks.forEach((mark) => {
              if (mark.type.name === this.name && mark.attrs.id && !seenIds.has(mark.attrs.id)) {
                seenIds.add(mark.attrs.id)

                // Find full range of this suggestion
                const positions: Array<{ pos: number; nodeSize: number }> = []
                doc.descendants((n, p) => {
                  n.marks.forEach((m) => {
                    if (m.type.name === this.name && m.attrs.id === mark.attrs.id) {
                      positions.push({ pos: p, nodeSize: n.nodeSize })
                    }
                  })
                })

                if (positions.length > 0) {
                  const from = positions[0].pos
                  const lastPos = positions[positions.length - 1]
                  const to = lastPos.pos + lastPos.nodeSize

                  suggestions.push({
                    id: mark.attrs.id,
                    type: mark.attrs.type === 'insertion'
                      ? 'insertion'
                      : mark.attrs.type === 'deletion'
                        ? 'deletion'
                        : 'edit',
                    createdAt: mark.attrs.createdAt || Date.now(),
                    from,
                    to,
                    suggestedText: mark.attrs.suggestedText || '',
                    blockConversionIntent: mark.attrs.blockConversionIntent ?? null,
                    originalText: mark.attrs.originalText || '',
                    explanation: mark.attrs.explanation || '',
                    provenanceModel: mark.attrs.provenanceModel || '',
                    provenanceConversationId: mark.attrs.provenanceConversationId || '',
                    provenanceMessageId: mark.attrs.provenanceMessageId || '',
                    provenanceSource: mark.attrs.provenanceSource || 'unknown',
                    provenanceInvocationId: mark.attrs.provenanceInvocationId || '',
                    insertionAnchorNodeId: mark.attrs.insertionAnchorNodeId || undefined,
                    deletionNodeId: mark.attrs.deletionNodeId || undefined,
                    supersedes: Array.isArray(mark.attrs.supersedes) ? mark.attrs.supersedes : [],
                    userReply: mark.attrs.userReply || undefined,
                    documentId: mark.attrs.documentId || ''
                  })
                }
              }
            })
          })

          if (suggestions.length === 0) return false

          // Sort by position descending so we can apply from end to start
          suggestions.sort((a, b) => b.from - a.from)

          // Apply each suggestion. Processing end-to-start means earlier
          // suggestions' positions are not shifted by later ones — which also
          // makes the block-conversion whole-node replacement safe here: each
          // suggestion's pre-dispatch coordinates stay valid because all
          // later (higher-position) replacements have already been applied.
          // Path selection mirrors acceptAISuggestion: blockConversion →
          // multiBlock → inline → literal.
          // Collected per-suggestion data for post-dispatch annotation
          // creation (#674): accept-all previously created NO annotations,
          // so batch-accepted edits never appeared in the history panel.
          const applied: Array<{
            suggestion: (typeof suggestions)[number]
            conversion: ReturnType<typeof applyBlockConversion>
            annotationNewText: string
            deletionRange: { from: number; to: number } | null
          }> = []

          for (const suggestion of suggestions) {
            tr.removeMark(suggestion.from, suggestion.to, state.schema.marks.aiSuggestion)
            let conversion: ReturnType<typeof applyBlockConversion> = null
            let annotationNewText = suggestion.suggestedText
            let deletionRange: { from: number; to: number } | null = null
            if (suggestion.type === 'insertion') {
              // Insertion candidates already exist as marked blocks. Accepting
              // them means keeping the blocks and removing only the mark.
            } else if (suggestion.type === 'deletion') {
              deletionRange = deletionBlockRange(
                doc,
                suggestion.deletionNodeId,
                suggestion.from,
                suggestion.to,
              )
              if (deletionRange) {
                tr.delete(deletionRange.from, deletionRange.to)
              } else {
                tr.delete(suggestion.from, suggestion.to)
              }
              applied.push({ suggestion, conversion, annotationNewText, deletionRange })
            } else if (suggestion.suggestedText.length > 0) {
              conversion = suggestion.blockConversionIntent
                ? applyBlockConversion(
                    tr,
                    doc,
                    editor,
                    state.schema,
                    suggestion.from,
                    suggestion.to,
                    suggestion.blockConversionIntent
                  )
                : null
              if (conversion) {
                pipelineLog('accept:path', { id: suggestion.id, path: 'blockConversion', batch: true })
                annotationNewText = conversion.visibleText
              } else if (isMultiBlock(suggestion.suggestedText)) {
                const slice = parseMarkdownToSlice(editor, state.schema, suggestion.suggestedText)
                if (slice) {
                  tr.replace(suggestion.from, suggestion.to, slice)
                } else {
                  tr.replaceWith(suggestion.from, suggestion.to, state.schema.text(suggestion.suggestedText))
                }
              } else {
                const inline = parseInlineSuggestion(editor, state.schema, suggestion.suggestedText)
                if (inline) {
                  tr.replace(suggestion.from, suggestion.to, inline.slice)
                  annotationNewText = inline.text
                } else {
                  tr.replaceWith(suggestion.from, suggestion.to, state.schema.text(suggestion.suggestedText))
                }
              }
              applied.push({ suggestion, conversion, annotationNewText, deletionRange })
            } else {
              tr.delete(suggestion.from, suggestion.to)
            }

          }

          dispatch(tr)

          if (this.options.onSuggestionAccepted) {
            for (const suggestion of suggestions) {
              this.options.onSuggestionAccepted(
                {
                  id: suggestion.id,
                  type: suggestion.type,
                  originalText: suggestion.originalText,
                  suggestedText: suggestion.suggestedText,
                  explanation: suggestion.explanation,
                  createdAt: suggestion.createdAt,
                  from: suggestion.from,
                  to: suggestion.to,
                  userReply: suggestion.userReply,
                  provenanceModel: suggestion.provenanceModel || undefined,
                  provenanceConversationId: suggestion.provenanceConversationId || undefined,
                  provenanceMessageId: suggestion.provenanceMessageId || undefined,
                  provenanceSource: suggestion.provenanceSource,
                  provenanceInvocationId: suggestion.provenanceInvocationId || undefined,
                  insertionAnchorNodeId: suggestion.insertionAnchorNodeId,
                  deletionNodeId: suggestion.deletionNodeId,
                  supersedes: suggestion.supersedes,
                  documentId: suggestion.documentId || undefined,
                  blockConversionIntent: suggestion.blockConversionIntent,
                },
                actor,
              )
            }
          }

          // Create annotations in a MICROTASK after the transaction actually
          // applies (see acceptAISuggestion — TipTap applies the tr after the
          // command body returns; inline creation would starve existing
          // annotations of this transaction's position mapping). Pre-dispatch
          // coordinates map through the full accumulated step list:
          // end-to-start processing means each suggestion's own step leaves
          // its range-start boundary stable, and later (lower-position) steps
          // shift it by their length delta — exactly what tr.mapping.map
          // computes. priorAnnotations restoration is intentionally skipped
          // in the batch path (it would need a per-step snapshot);
          // overlapping older annotations detach rather than vanish (#674).
          queueMicrotask(() => {
            const annotationStore = useAnnotationStore.getState()
            for (const { suggestion, conversion, annotationNewText, deletionRange } of applied) {
              const docId = suggestion.documentId || annotationStore.documentId
              if (!docId) {
                console.warn('[AISuggestion] acceptAll: cannot create annotation - missing docId:', suggestion.id)
                continue
              }
              // Surface the fallback (#677 review): if a tab switch ever
              // raced this microtask, the store's documentId would be the
              // NEW tab's — make that visible rather than silently
              // mis-keying the annotation.
              if (!suggestion.documentId) {
                console.warn('[AISuggestion] acceptAll: annotation documentId fell back to store documentId:', {
                  suggestionId: suggestion.id,
                  docId,
                })
              }
              const provenance = {
                model: suggestion.provenanceModel || 'unknown',
                conversationId: suggestion.provenanceConversationId,
                messageId: suggestion.provenanceMessageId,
              }
              if (suggestion.type === 'deletion') {
                const deletionPoint = tr.mapping.map(
                  deletionRange?.from ?? suggestion.from,
                  -1,
                )
                annotationStore.addAnnotation({
                  documentId: docId,
                  type: 'deletion',
                  from: deletionPoint,
                  to: deletionPoint,
                  content: suggestion.originalText,
                  provenance,
                  explanation: suggestion.explanation || undefined,
                })
              } else if (conversion && conversion.singleTextblock) {
                const base = tr.mapping.map(conversion.insertedAt, -1)
                createWordDiffAnnotations({
                  documentId: docId,
                  originalText: suggestion.originalText,
                  newText: annotationNewText,
                  rangeFrom: base + 1,
                  rangeTo: base + 1 + conversion.visibleText.length,
                  provenance,
                  explanation: suggestion.explanation || undefined,
                })
              } else if (conversion) {
                const base = tr.mapping.map(conversion.insertedAt, -1)
                annotationStore.addAnnotation({
                  documentId: docId,
                  type: 'replacement',
                  from: base,
                  to: base + conversion.insertedSize,
                  content: conversion.visibleText,
                  provenance,
                  explanation: suggestion.explanation || undefined,
                })
              } else {
                createWordDiffAnnotations({
                  documentId: docId,
                  originalText: suggestion.originalText,
                  newText: annotationNewText,
                  rangeFrom: tr.mapping.map(suggestion.from, -1),
                  rangeTo: tr.mapping.map(suggestion.to, 1),
                  provenance,
                  explanation: suggestion.explanation || undefined,
                })
              }
            }
          })

          return true
        },

      rejectAllAISuggestions:
        (actor = { kind: 'user', source: 'ui' }) =>
        ({ tr, state, dispatch }) => {
          if (!dispatch) return false

          const { doc } = state
          const rangesById = new Map<string, {
            attrs: Record<string, unknown>
            from: number
            to: number
          }>()

          doc.descendants((node, pos) => {
            node.marks.forEach((mark) => {
              if (mark.type.name !== this.name || !mark.attrs.id) return
              const existing = rangesById.get(mark.attrs.id)
              rangesById.set(mark.attrs.id, existing
                ? { ...existing, to: Math.max(existing.to, pos + node.nodeSize) }
                : { attrs: mark.attrs, from: pos, to: pos + node.nodeSize })
            })
          })

          const ranges = Array.from(rangesById.values()).sort((a, b) => b.from - a.from)
          for (const range of ranges) {
            if (range.attrs.type === 'insertion') {
              const blockRange = insertionBlockRange(
                doc,
                typeof range.attrs.insertionAnchorNodeId === 'string'
                  ? range.attrs.insertionAnchorNodeId
                  : undefined,
                range.from,
                range.to,
              )
              if (blockRange) {
                tr.delete(blockRange.from, blockRange.to)
                continue
              }
            }
            tr.removeMark(range.from, range.to, state.schema.marks.aiSuggestion)
          }

          if (ranges.length > 0) {
            dispatch(tr)
            if (this.options.onSuggestionRejected) {
              for (const range of ranges) {
                const suggestion = suggestionDataFromAttrs(range.attrs, range.from, range.to)
                this.options.onSuggestionRejected(suggestion, actor)
              }
            }
            return true
          }

          return false
        },

      reviseAISuggestion:
        (id, attrs) =>
        ({ tr, state, dispatch, editor }) => {
          if (!dispatch) return false

          const { doc, schema } = state
          let suggestionAttrs: Record<string, unknown> | null = null
          const positions: Array<{ pos: number; nodeSize: number }> = []
          doc.descendants((node, pos) => {
            node.marks.forEach((mark) => {
              if (mark.type.name === this.name && mark.attrs.id === id) {
                suggestionAttrs ??= mark.attrs
                positions.push({ pos, nodeSize: node.nodeSize })
              }
            })
          })
          if (positions.length === 0 || !suggestionAttrs) return false
          if (suggestionAttrs.type !== 'insertion') return false

          const markFrom = positions[0].pos
          const last = positions[positions.length - 1]
          const markTo = last.pos + last.nodeSize
          const anchorId = typeof suggestionAttrs.insertionAnchorNodeId === 'string'
            ? suggestionAttrs.insertionAnchorNodeId
            : undefined
          const anchorText = typeof suggestionAttrs.insertionAnchorText === 'string'
            ? suggestionAttrs.insertionAnchorText
            : undefined
          const blockRange = insertionBlockRange(doc, anchorId, markFrom, markTo, anchorText)
          const slice = parseInsertionSlice(editor, schema, attrs.suggestedText)
          if (!blockRange || !slice || slice.content.size === 0) return false

          const anchor = findNodeWithId(doc, anchorId || '') ?? findNodeWithText(doc, anchorText, markFrom)
          const actualAnchorId = typeof anchor?.node.attrs.nodeId === 'string' && anchor.node.attrs.nodeId
            ? anchor.node.attrs.nodeId
            : attrs.insertionAnchorNodeId || anchorId
          const actualAnchorText = anchor?.node.textContent || attrs.insertionAnchorText || anchorText

          tr.delete(blockRange.from, blockRange.to)
          tr.insert(blockRange.from, slice.content)
          const insertedRange = insertionContentRange(
            tr.doc,
            blockRange.from,
            blockRange.from + slice.content.size,
          )
          if (!insertedRange) return false

          const createdAt = Date.now()
          const mark = schema.marks.aiSuggestion.create({
            id: attrs.id,
            type: 'insertion',
            originalText: attrs.originalText,
            suggestedText: attrs.suggestedText,
            explanation: attrs.explanation,
            createdAt,
            provenanceModel: attrs.provenanceModel || '',
            provenanceConversationId: attrs.provenanceConversationId || '',
            provenanceMessageId: attrs.provenanceMessageId || '',
            provenanceSource: attrs.provenanceSource || 'unknown',
            provenanceInvocationId: attrs.provenanceInvocationId || '',
            insertionAnchorNodeId: actualAnchorId || '',
            insertionAnchorText: actualAnchorText || '',
            supersedes: attrs.supersedes || null,
            documentId: attrs.documentId || '',
          })
          tr.addMark(insertedRange.from, insertedRange.to, mark)
          dispatch(tr)

          this.options.onSuggestionAdded?.({
            id: attrs.id,
            type: 'insertion',
            originalText: attrs.originalText,
            suggestedText: attrs.suggestedText,
            explanation: attrs.explanation,
            createdAt,
            from: insertedRange.from,
            to: insertedRange.to,
            provenanceModel: attrs.provenanceModel || undefined,
            provenanceConversationId: attrs.provenanceConversationId || undefined,
            provenanceMessageId: attrs.provenanceMessageId || undefined,
            provenanceSource: attrs.provenanceSource,
            provenanceInvocationId: attrs.provenanceInvocationId || undefined,
            insertionAnchorNodeId: actualAnchorId || undefined,
            insertionAnchorText: actualAnchorText || undefined,
            supersedes: attrs.supersedes,
            documentId: attrs.documentId || undefined,
          })
          return true
        },

      restoreAISuggestions:
        (suggestions) =>
        ({ tr, state, dispatch, editor }) => {
          if (!dispatch || suggestions.length === 0) return false

          const { schema } = state
          let restored = 0

          // Process each suggestion
          for (const suggestion of suggestions) {
            if (!suggestion.originalText && suggestion.type === 'insertion') {
              const currentDoc = tr.doc
              const slice = parseInsertionSlice(editor, schema, suggestion.suggestedText)
              const expectedText = slice ? sliceVisibleText(slice) : ''
              let blockRange = slice
                ? insertedBlockRangeAfterAnchor(
                    currentDoc,
                    suggestion.insertionAnchorNodeId,
                    slice.content.size,
                    suggestion.insertionAnchorText,
                    suggestion.from,
                  )
                : null
              if (!blockRange && slice) {
                blockRange = findBlockSequence(
                  currentDoc,
                  slice.content.size,
                  expectedText,
                  suggestion.from,
                  suggestion.to,
                )
              }

              // A pending insertion can outlive the markdown file write that
              // originally contained its candidate blocks. Recreate those
              // blocks after the recovered anchor before applying the mark.
              const recoveredAnchor = findNodeWithId(currentDoc, suggestion.insertionAnchorNodeId || '')
                ?? findNodeWithText(currentDoc, suggestion.insertionAnchorText, suggestion.from)
              if (!blockRange && slice) {
                if (recoveredAnchor) {
                  const from = recoveredAnchor.pos + recoveredAnchor.node.nodeSize
                  tr.insert(from, slice.content)
                  blockRange = { from, to: from + slice.content.size }
                }
              }

              const contentRange = blockRange
                ? insertionContentRange(tr.doc, blockRange.from, blockRange.to)
                : null

              if (!contentRange) {
                console.warn('[AISuggestion] Could not restore insertion:', suggestion.id)
                continue
              }

              const mark = schema.marks.aiSuggestion.create({
                id: suggestion.id,
                type: suggestion.type,
                originalText: suggestion.originalText,
                suggestedText: suggestion.suggestedText,
                explanation: suggestion.explanation,
                createdAt: suggestion.createdAt,
                userReply: suggestion.userReply || null,
                provenanceModel: suggestion.provenanceModel || '',
                provenanceConversationId: suggestion.provenanceConversationId || '',
                provenanceMessageId: suggestion.provenanceMessageId || '',
                provenanceSource: suggestion.provenanceSource || 'unknown',
                provenanceInvocationId: suggestion.provenanceInvocationId || '',
                insertionAnchorNodeId:
                  (recoveredAnchor?.node.attrs.nodeId as string | undefined)
                  || suggestion.insertionAnchorNodeId
                  || '',
                insertionAnchorText:
                  recoveredAnchor?.node.textContent
                  || suggestion.insertionAnchorText
                  || '',
                supersedes: suggestion.supersedes || null,
                documentId: suggestion.documentId || '',
                blockConversionIntent: suggestion.blockConversionIntent ?? null,
              })
              tr.addMark(contentRange.from, contentRange.to, mark)
              restored++
              continue
            }

            // Find the original text in the document
            const currentDoc = tr.doc
            const docText = currentDoc.textContent
            const searchText = suggestion.originalText

            if (!searchText) {
              console.warn('[AISuggestion] Cannot restore suggestion without originalText:', suggestion.id)
              continue
            }

            // Find position of originalText in document
            const textIndex = docText.indexOf(searchText)
            if (textIndex === -1) {
              console.warn('[AISuggestion] Cannot find originalText in document:', {
                id: suggestion.id,
                originalText: searchText.substring(0, 50)
              })
              continue
            }

            // Convert text index to document position
            // We need to walk the document to find the correct ProseMirror position
            let charCount = 0
            let foundStart = -1
            let foundEnd = -1

            currentDoc.descendants((node, nodePos) => {
              if (foundStart !== -1 && foundEnd !== -1) return false // Already found

              if (node.isText && node.text) {
                const nodeText = node.text
                const nodeStart = charCount
                const nodeEnd = charCount + nodeText.length

                // Check if our target text starts in this node
                if (foundStart === -1 && textIndex >= nodeStart && textIndex < nodeEnd) {
                  // Target starts in this node
                  const offsetInNode = textIndex - nodeStart
                  foundStart = nodePos + offsetInNode
                }

                // Check if our target text ends in this node
                const targetEnd = textIndex + searchText.length
                if (foundStart !== -1 && targetEnd > nodeStart && targetEnd <= nodeEnd) {
                  const offsetInNode = targetEnd - nodeStart
                  foundEnd = nodePos + offsetInNode
                  return false // Stop searching
                }

                charCount += nodeText.length
              }
            })

            if (foundStart === -1 || foundEnd === -1) {
              console.warn('[AISuggestion] Could not map text position:', suggestion.id)
              continue
            }

            // Apply the suggestion mark
            const mark = schema.marks.aiSuggestion.create({
              id: suggestion.id,
              type: suggestion.type,
              originalText: suggestion.originalText,
              suggestedText: suggestion.suggestedText,
              explanation: suggestion.explanation,
              createdAt: suggestion.createdAt,
              userReply: suggestion.userReply || null,
              provenanceModel: suggestion.provenanceModel || '',
              provenanceConversationId: suggestion.provenanceConversationId || '',
              provenanceMessageId: suggestion.provenanceMessageId || '',
              provenanceSource: suggestion.provenanceSource || 'unknown',
              provenanceInvocationId: suggestion.provenanceInvocationId || '',
              insertionAnchorNodeId: suggestion.insertionAnchorNodeId || '',
              insertionAnchorText: suggestion.insertionAnchorText || '',
              deletionNodeId: suggestion.deletionNodeId || '',
              supersedes: suggestion.supersedes || null,
              documentId: suggestion.documentId || '',
              blockConversionIntent: suggestion.blockConversionIntent ?? null,
            })

            tr.addMark(foundStart, foundEnd, mark)
            restored++

            console.log('[AISuggestion] Restored suggestion:', {
              id: suggestion.id,
              from: foundStart,
              to: foundEnd
            })
          }

          if (restored > 0) {
            dispatch(tr)
            console.log('[AISuggestion] Restored', restored, 'of', suggestions.length, 'suggestions')
            return true
          }

          return false
        },
    }
  },
})

/**
 * Extract all AI suggestions from the editor
 */
export function getAISuggestions(editor: {
  state: {
    doc: {
      descendants: (
        fn: (
          node: {
            marks: Array<{
              type: { name: string }
              attrs: {
                id: string
                type: SuggestionType
                originalText: string
                suggestedText: string
                explanation: string
                createdAt: number
                userReply?: string
                provenanceModel?: string
                provenanceConversationId?: string
                provenanceMessageId?: string
                documentId?: string
                provenanceSource?: 'chat' | 'mcp' | 'unknown'
                provenanceInvocationId?: string
                insertionAnchorNodeId?: string
                insertionAnchorText?: string
                deletionNodeId?: string
                supersedes?: string[]
                blockConversionIntent?: string | null
              }
            }>
            nodeSize: number
            textContent: string
          },
          pos: number
        ) => void
      ) => void
    }
  }
}): AISuggestionData[] {
  const suggestions: AISuggestionData[] = []

  editor.state.doc.descendants((node, pos) => {
    node.marks.forEach((mark) => {
      if (mark.type.name === 'aiSuggestion' && mark.attrs.id) {
        suggestions.push({
          id: mark.attrs.id,
          type: mark.attrs.type || 'edit',
          originalText: mark.attrs.originalText || '',
          suggestedText: mark.attrs.suggestedText || '',
          explanation: mark.attrs.explanation || '',
          createdAt: mark.attrs.createdAt || Date.now(),
          from: pos,
          to: pos + node.nodeSize,
          userReply: mark.attrs.userReply || undefined,
          provenanceModel: mark.attrs.provenanceModel || undefined,
          provenanceConversationId: mark.attrs.provenanceConversationId || undefined,
          provenanceMessageId: mark.attrs.provenanceMessageId || undefined,
          documentId: mark.attrs.documentId || undefined,
          provenanceSource: mark.attrs.provenanceSource || undefined,
          provenanceInvocationId: mark.attrs.provenanceInvocationId || undefined,
          insertionAnchorNodeId: mark.attrs.insertionAnchorNodeId || undefined,
          insertionAnchorText: mark.attrs.insertionAnchorText || undefined,
          deletionNodeId: mark.attrs.deletionNodeId || undefined,
          supersedes: Array.isArray(mark.attrs.supersedes) ? mark.attrs.supersedes : undefined,
          blockConversionIntent: mark.attrs.blockConversionIntent ?? null,
        })
      }
    })
  })

  // Dedupe by ID (marks can span multiple text nodes)
  const seen = new Set<string>()
  return suggestions.filter((s) => {
    if (seen.has(s.id)) return false
    seen.add(s.id)
    return true
  })
}

/**
 * Get AI suggestions that have pending user feedback (userReply set)
 */
export function getSuggestionsWithFeedback(editor: Parameters<typeof getAISuggestions>[0]): AISuggestionData[] {
  return getAISuggestions(editor).filter((s) => s.userReply && s.userReply.trim() !== '')
}

export default AISuggestion
