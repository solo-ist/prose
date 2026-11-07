/**
 * AI Suggestion Mark Extension for TipTap
 *
 * Allows AI to add edit suggestions to text that appear as purple highlights.
 * Users can click to see the suggested change and accept/reject it.
 */

import { Mark, mergeAttributes } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import type { Schema, Node as PMNode } from '@tiptap/pm/model'
import { DOMParser as ProseMirrorDOMParser, Slice } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import type { MarkSerializerSpec } from 'prosemirror-markdown'
import type { AISuggestionOptions, AISuggestionData, SuggestionType } from './types'
import { SELF, type Actor } from '../../../shared/review/actor'
import { decideSuggestionsIn, feedbackIn, reviseSuggestionIn } from '../review-log/transactions'
import { generateId } from '../../lib/persistence'
import { addAnnotationsTo, annotationsOf } from '../ai-annotations/transactions'
import { buildWordDiffAnnotations } from '../../lib/diffUtils'
import { pipelineLog } from '../../lib/aiPipelineLog'
import { AI_REPLACEMENT_META } from '../comments'

/**
 * Transaction meta set by the four accept/reject commands. A writer resolving a
 * suggestion is intent, not a transient strip, so the persist path may write the
 * resulting set even when it is empty (#1126).
 */
export const AI_SUGGESTION_RESOLVED_META = 'aiSuggestionResolved'

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
 * Takes the editor's markdown storage (or a document handle's codec).
 * Returns null when there is no markdown parser (e.g., during tests) so
 * callers can fall back to the text path.
 */
export function parseMarkdownToSlice(
  markdown: { parser?: { parse?: (content: string) => unknown } } | undefined,
  schema: Schema,
  text: string
): Slice | null {
  const parser = markdown?.parser
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
  const slice = parseMarkdownToSlice(editor.storage?.markdown, schema, suggestedText)
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

  const slice = parseMarkdownToSlice(editor.storage?.markdown, schema, intentMarkdown)
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
        /** Who proposed it (#1232) */
        actor?: Actor | null
        documentId?: string
        /** Raw markdown for a block-type conversion (#673); null/absent = text replacement */
        blockConversionIntent?: string | null
      }) => ReturnType
      /**
       * Set user reply on an AI suggestion by ID
       */
      setAISuggestionReply: (id: string, reply: string, by?: Actor) => ReturnType
      /**
       * Revise a pending suggestion (#1233): its mark is replaced, over the same
       * range, by a new suggestion that links back to it; the old one is
       * superseded in the review log.
       */
      reviseAISuggestion: (id: string, revision: { suggestedText: string; explanation?: string; by: Actor; newId?: string }) => ReturnType
      /**
       * Accept an AI suggestion by ID - replaces text with suggested text
       */
      acceptAISuggestion: (id: string, by?: Actor) => ReturnType
      /**
       * Reject an AI suggestion by ID - removes the mark
       */
      rejectAISuggestion: (id: string, by?: Actor) => ReturnType
      /**
       * Accept all AI suggestions
       */
      acceptAllAISuggestions: (by?: Actor) => ReturnType
      /**
       * Reject all AI suggestions
       */
      rejectAllAISuggestions: (by?: Actor) => ReturnType
    }
  }
}

export const AISuggestion = Mark.create<AISuggestionOptions>({
  name: 'aiSuggestion',

  addOptions() {
    return {
      HTMLAttributes: {},
      onSuggestionAdded: undefined,
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
      // Who proposed it (#1232). State only: never rendered to the DOM (so it
      // doesn't ride the clipboard) and never read back from HTML (so pasted
      // markup can't claim an actor). The popover reads it from the state.
      actor: {
        default: null,
        parseHTML: () => null,
        renderHTML: () => ({}),
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

  addCommands() {
    return {
      setAISuggestion:
        (attrs) =>
        ({ commands, state }) => {
          const { from, to } = state.selection

          const suggestionData: AISuggestionData = {
            id: attrs.id,
            type: attrs.type,
            originalText: attrs.originalText,
            suggestedText: attrs.suggestedText,
            explanation: attrs.explanation,
            createdAt: Date.now(),
            from,
            to,
            actor: attrs.actor ?? null,
            blockConversionIntent: attrs.blockConversionIntent ?? null,
          }

          const result = commands.setMark(this.name, {
            id: attrs.id,
            type: attrs.type,
            originalText: attrs.originalText,
            suggestedText: attrs.suggestedText,
            explanation: attrs.explanation,
            createdAt: Date.now(),
            provenanceModel: attrs.provenanceModel || '',
            provenanceConversationId: attrs.provenanceConversationId || '',
            provenanceMessageId: attrs.provenanceMessageId || '',
            actor: attrs.actor ?? null,
            documentId: attrs.documentId || '',
            blockConversionIntent: attrs.blockConversionIntent ?? null,
          })

          if (result && this.options.onSuggestionAdded) {
            this.options.onSuggestionAdded(suggestionData)
          }

          return result
        },

      setAISuggestionReply:
        (id, reply, by) =>
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
              ...existingAttrs,
              userReply: reply
            })
          )
          // The review log keeps every reply, with who gave it (#1233); the
          // attribute keeps the latest for the in-app chat.
          if (reply.trim()) {
            feedbackIn(tr, id, { id: generateId(), actor: by ?? SELF, text: reply.trim(), createdAt: Date.now() })
          }

          dispatch(tr)
          return true
        },

      reviseAISuggestion:
        (id, revision) =>
        ({ tr, state, dispatch }) => {
          let existingAttrs: Record<string, unknown> | null = null
          let markFrom = -1
          let markTo = -1
          state.doc.descendants((node, pos) => {
            node.marks.forEach((mark) => {
              if (mark.type.name === this.name && mark.attrs.id === id) {
                if (!existingAttrs) existingAttrs = mark.attrs
                if (markFrom === -1) markFrom = pos
                markTo = pos + node.nodeSize
              }
            })
          })
          if (!existingAttrs || markFrom === -1) return false
          if (!dispatch) return true
          const newId = revision.newId ?? generateId()
          tr.removeMark(markFrom, markTo, state.schema.marks.aiSuggestion)
          tr.addMark(
            markFrom,
            markTo,
            state.schema.marks.aiSuggestion.create({
              ...(existingAttrs as Record<string, unknown>),
              id: newId,
              suggestedText: revision.suggestedText,
              explanation: revision.explanation ?? (existingAttrs as Record<string, unknown>).explanation ?? '',
              createdAt: Date.now(),
              userReply: null,
              actor: revision.by,
            })
          )
          reviseSuggestionIn(tr, id, newId, revision.by)
          dispatch(tr)
          return true
        },

      acceptAISuggestion:
        (id, by) =>
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

          // Get the suggested text
          const suggestedText = (suggestionAttrs as { suggestedText?: string }).suggestedText || ''

          // Remove the mark first
          tr.removeMark(markFrom, markTo, state.schema.marks.aiSuggestion)

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
          let acceptPath: 'blockConversion' | 'multiBlock' | 'inline' | 'literal' | 'delete' = 'literal'
          let conversion: ReturnType<typeof applyBlockConversion> = null
          if (suggestedText.length > 0) {
            if (blockIntent) {
              conversion = applyBlockConversion(tr, state.doc, editor, state.schema, markFrom, markTo, blockIntent)
            }
            if (conversion) {
              annotationNewText = conversion.visibleText
              acceptPath = 'blockConversion'
            } else if (isMultiBlock(suggestedText)) {
              acceptPath = 'multiBlock'
              const slice = parseMarkdownToSlice(editor.storage?.markdown, state.schema, suggestedText)
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
            provenanceModel?: string
            provenanceConversationId?: string
            provenanceMessageId?: string
            actor?: Actor | null
            documentId?: string
            originalText?: string
            explanation?: string
          }

          const model = attrs.provenanceModel || 'unknown'
          const originalText = attrs.originalText || ''
          const explanation = attrs.explanation || ''

          // Records overlapping the replaced range, read from the state
          // before the replace (#674): the plugin detaches them under the
          // mapping; buildWordDiffAnnotations re-adds the ones on unchanged
          // words (parity with executeEdit's priorAnnotations capture in
          // executors/editor.ts).
          const priorAnnotations = annotationsOf(state).filter(
            (a) => !a.detached && a.to > markFrom && a.from < markTo
          )

          // Not the writer deleting a commented passage — keep its thread open (#1099).
          tr.setMeta(AI_REPLACEMENT_META, true)
          tr.setMeta(AI_SUGGESTION_RESOLVED_META, true)

          // The provenance records ride on this same transaction (#1146): the
          // annotation plugin maps the existing records through the replace
          // first and appends these after, in the coordinates of the new
          // document, so replace-and-annotate is one dispatch and the
          // microtask the store needed is gone. The plugin stamps the
          // document id from the state, whatever the mark carried (a mark
          // made before a rename or first save carries the old id).
          if (suggestedText.length > 0) {
            const provenance = {
              model,
              conversationId: attrs.provenanceConversationId || '',
              messageId: attrs.provenanceMessageId || '',
              ...(attrs.actor ? { actor: attrs.actor } : {}),
            }
            if (conversion && conversion.singleTextblock) {
              // Converted node sits at its pre-replace position (nothing
              // before it shifted); content starts one position inside the
              // node's opening token — word-diff offsets index that content.
              addAnnotationsTo(
                tr,
                buildWordDiffAnnotations({
                  originalText,
                  newText: annotationNewText,
                  rangeFrom: conversion.insertedAt + 1,
                  rangeTo: conversion.insertedAt + 1 + conversion.visibleText.length,
                  provenance,
                  explanation: explanation || undefined,
                })
              )
            } else if (conversion) {
              // Wrapper conversion (blockquote/list) or multi-node result:
              // nested structure breaks linear text-offset math — record a
              // single full-range annotation over the inserted content.
              addAnnotationsTo(tr, [
                {
                  type: 'replacement',
                  from: conversion.insertedAt,
                  to: conversion.insertedAt + conversion.insertedSize,
                  content: conversion.visibleText,
                  provenance,
                  explanation: explanation || undefined,
                },
              ])
            } else {
              // Coordinate-consistency note (#677 review): priorAnnotations
              // carry pre-replace from/to, while rangeFrom is mapped through
              // tr. This command's only position-shifting step is the
              // mark-range replacement itself (removeMark doesn't move
              // positions), so map(markFrom, -1) === markFrom and the
              // builder's originalContentStart (= rangeFrom) stays in the
              // same coordinate space as the prior annotations.
              addAnnotationsTo(
                tr,
                buildWordDiffAnnotations({
                  originalText,
                  // Parsed visible text when the inline-markdown path fired —
                  // word-diff offsets must index the rendered document, not the
                  // raw markdown source.
                  newText: annotationNewText,
                  rangeFrom: tr.mapping.map(markFrom, -1),
                  rangeTo: tr.mapping.map(markTo, 1),
                  provenance,
                  explanation: explanation || undefined,
                  priorAnnotations,
                })
              )
            }
          }
          // Who decided, for the review log (#1233); the writer unless a tool says otherwise.
          decideSuggestionsIn(tr, [id], 'accepted', by ?? SELF)
          dispatch(tr)

          if (this.options.onSuggestionAccepted) {
            this.options.onSuggestionAccepted(id)
          }

          return true
        },

      rejectAISuggestion:
        (id, by) =>
        ({ tr, state, dispatch }) => {
          if (!dispatch) return false

          const { doc } = state
          const positions: Array<{ pos: number; nodeSize: number }> = []

          // Find all nodes with this suggestion mark (mark can span multiple text nodes
          // when inline formatting like bold/italic is present)
          doc.descendants((node, pos) => {
            node.marks.forEach((mark) => {
              if (mark.type.name === this.name && mark.attrs.id === id) {
                positions.push({ pos, nodeSize: node.nodeSize })
              }
            })
          })

          if (positions.length === 0) return false

          // Calculate the full range from first to last node
          const markFrom = positions[0].pos
          const lastPos = positions[positions.length - 1]
          const markTo = lastPos.pos + lastPos.nodeSize

          // Remove the mark across the entire range
          tr.removeMark(markFrom, markTo, state.schema.marks.aiSuggestion)

          tr.setMeta(AI_SUGGESTION_RESOLVED_META, true)
          decideSuggestionsIn(tr, [id], 'rejected', by ?? SELF)
          dispatch(tr)

          if (this.options.onSuggestionRejected) {
            this.options.onSuggestionRejected(id)
          }

          return true
        },

      acceptAllAISuggestions:
        (by) =>
        ({ tr, state, dispatch, editor }) => {
          if (!dispatch) return false

          const { doc } = state

          // Collect all suggestions with their positions and data
          // We need to process from end to start to avoid position shifts
          const suggestions: Array<{
            id: string
            from: number
            to: number
            suggestedText: string
            blockConversionIntent: string | null
            originalText: string
            explanation: string
            provenanceModel: string
            provenanceConversationId: string
            provenanceMessageId: string
            actor: Actor | null
            documentId: string
          }> = []

          // First pass: collect all unique suggestion IDs and their ranges
          const seenIds = new Set<string>()
          doc.descendants((node, pos) => {
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
                    from,
                    to,
                    suggestedText: mark.attrs.suggestedText || '',
                    blockConversionIntent: mark.attrs.blockConversionIntent ?? null,
                    originalText: mark.attrs.originalText || '',
                    explanation: mark.attrs.explanation || '',
                    provenanceModel: mark.attrs.provenanceModel || '',
                    provenanceConversationId: mark.attrs.provenanceConversationId || '',
                    provenanceMessageId: mark.attrs.provenanceMessageId || '',
                    actor: mark.attrs.actor ?? null,
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
          }> = []

          for (const suggestion of suggestions) {
            tr.removeMark(suggestion.from, suggestion.to, state.schema.marks.aiSuggestion)
            let conversion: ReturnType<typeof applyBlockConversion> = null
            let annotationNewText = suggestion.suggestedText
            if (suggestion.suggestedText.length > 0) {
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
                const slice = parseMarkdownToSlice(editor.storage?.markdown, state.schema, suggestion.suggestedText)
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
              applied.push({ suggestion, conversion, annotationNewText })
            } else {
              tr.delete(suggestion.from, suggestion.to)
            }

            if (this.options.onSuggestionAccepted) {
              this.options.onSuggestionAccepted(suggestion.id)
            }
          }

          // Not the writer deleting a commented passage — keep its thread open (#1099).
          tr.setMeta(AI_REPLACEMENT_META, true)
          tr.setMeta(AI_SUGGESTION_RESOLVED_META, true)

          // The provenance records ride on this transaction (#1146; see
          // acceptAISuggestion). Pre-dispatch coordinates map through the
          // full accumulated step list: end-to-start processing means each
          // suggestion's own step leaves its range-start boundary stable, and
          // later (lower-position) steps shift it by their length delta —
          // exactly what tr.mapping.map computes. priorAnnotations
          // restoration is intentionally skipped in the batch path (it would
          // need a per-step snapshot); overlapping older annotations detach
          // rather than vanish (#674).
          for (const { suggestion, conversion, annotationNewText } of applied) {
            const provenance = {
              model: suggestion.provenanceModel || 'unknown',
              conversationId: suggestion.provenanceConversationId,
              messageId: suggestion.provenanceMessageId,
              ...(suggestion.actor ? { actor: suggestion.actor } : {}),
            }
            if (conversion && conversion.singleTextblock) {
              const base = tr.mapping.map(conversion.insertedAt, -1)
              addAnnotationsTo(
                tr,
                buildWordDiffAnnotations({
                  originalText: suggestion.originalText,
                  newText: annotationNewText,
                  rangeFrom: base + 1,
                  rangeTo: base + 1 + conversion.visibleText.length,
                  provenance,
                  explanation: suggestion.explanation || undefined,
                })
              )
            } else if (conversion) {
              const base = tr.mapping.map(conversion.insertedAt, -1)
              addAnnotationsTo(tr, [
                {
                  type: 'replacement',
                  from: base,
                  to: base + conversion.insertedSize,
                  content: conversion.visibleText,
                  provenance,
                  explanation: suggestion.explanation || undefined,
                },
              ])
            } else {
              addAnnotationsTo(
                tr,
                buildWordDiffAnnotations({
                  originalText: suggestion.originalText,
                  newText: annotationNewText,
                  rangeFrom: tr.mapping.map(suggestion.from, -1),
                  rangeTo: tr.mapping.map(suggestion.to, 1),
                  provenance,
                  explanation: suggestion.explanation || undefined,
                })
              )
            }
          }
          decideSuggestionsIn(tr, applied.map(({ suggestion }) => suggestion.id), 'accepted', by ?? SELF)
          dispatch(tr)

          return true
        },

      rejectAllAISuggestions:
        (by) =>
        ({ tr, state, dispatch }) => {
          if (!dispatch) return false

          const { doc } = state
          let removed = false
          const rejectedIds = new Set<string>()

          doc.descendants((node, pos) => {
            node.marks.forEach((mark) => {
              if (mark.type.name === this.name) {
                tr.removeMark(pos, pos + node.nodeSize, mark.type)
                removed = true
                if (mark.attrs.id) rejectedIds.add(mark.attrs.id as string)

                if (this.options.onSuggestionRejected && mark.attrs.id) {
                  this.options.onSuggestionRejected(mark.attrs.id)
                }
              }
            })
          })

          if (removed) {
            tr.setMeta(AI_SUGGESTION_RESOLVED_META, true)
            decideSuggestionsIn(tr, [...rejectedIds], 'rejected', by ?? SELF)
            dispatch(tr)
            return true
          }

          return false
        },

    }
  },
})

/**
 * Re-apply suggestion marks for `suggestions` to the document `tr` holds, as
 * part of `tr` (a session's seed transaction, a reload). Pure: the caller
 * dispatches or applies the transaction. Each suggestion anchors on the first
 * occurrence of its originalText; one whose text is gone is skipped. Returns
 * the number of marks applied (#1145).
 */
export function applySuggestionMarks(tr: Transaction, suggestions: AISuggestionData[]): number {
  const doc = tr.doc
  const schema = doc.type.schema
  const docText = doc.textContent
  let restored = 0

  for (const suggestion of suggestions) {
    const searchText = suggestion.originalText
    if (!searchText) {
      console.warn('[AISuggestion] Cannot restore suggestion without originalText:', suggestion.id)
      continue
    }

    const textIndex = docText.indexOf(searchText)
    if (textIndex === -1) {
      console.warn('[AISuggestion] Cannot find originalText in document:', {
        id: suggestion.id,
        originalText: searchText.substring(0, 50)
      })
      continue
    }

    // Walk the document to turn the text index into ProseMirror positions.
    let charCount = 0
    let foundStart = -1
    let foundEnd = -1
    doc.descendants((node, nodePos) => {
      if (foundStart !== -1 && foundEnd !== -1) return false
      if (node.isText && node.text) {
        const nodeText = node.text
        const nodeStart = charCount
        const nodeEnd = charCount + nodeText.length
        if (foundStart === -1 && textIndex >= nodeStart && textIndex < nodeEnd) {
          foundStart = nodePos + (textIndex - nodeStart)
        }
        const targetEnd = textIndex + searchText.length
        if (foundStart !== -1 && targetEnd > nodeStart && targetEnd <= nodeEnd) {
          foundEnd = nodePos + (targetEnd - nodeStart)
          return false
        }
        charCount += nodeText.length
      }
      return true
    })

    if (foundStart === -1 || foundEnd === -1) {
      console.warn('[AISuggestion] Could not map text position:', suggestion.id)
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
      actor: suggestion.actor ?? null,
      documentId: suggestion.documentId || '',
      blockConversionIntent: suggestion.blockConversionIntent ?? null,
    })
    tr.addMark(foundStart, foundEnd, mark)
    restored++
  }

  return restored
}

/**
 * Extract all AI suggestions from the editor
 */
export function getAISuggestions(editor: { state: { doc: PMNode } }): AISuggestionData[] {
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
          actor: mark.attrs.actor ?? undefined,
          documentId: mark.attrs.documentId || undefined,
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
