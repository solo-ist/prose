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
        /** Raw markdown for a block-type conversion (#673); null/absent = text replacement */
        blockConversionIntent?: string | null
      }) => ReturnType
      /**
       * Set user reply on an AI suggestion by ID
       */
      setAISuggestionReply: (id: string, reply: string) => ReturnType
      /**
       * Accept an AI suggestion by ID - replaces text with suggested text
       */
      acceptAISuggestion: (id: string) => ReturnType
      /**
       * Reject an AI suggestion by ID - removes the mark
       */
      rejectAISuggestion: (id: string) => ReturnType
      /**
       * Accept all AI suggestions
       */
      acceptAllAISuggestions: () => ReturnType
      /**
       * Reject all AI suggestions
       */
      rejectAllAISuggestions: () => ReturnType
      /**
       * Restore AI suggestions from persisted data (used after tab switch)
       */
      restoreAISuggestions: (suggestions: AISuggestionData[]) => ReturnType
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
            documentId: attrs.documentId || '',
            blockConversionIntent: attrs.blockConversionIntent ?? null,
          })

          if (result && this.options.onSuggestionAdded) {
            this.options.onSuggestionAdded(suggestionData)
          }

          return result
        },

      setAISuggestionReply:
        (id, reply) =>
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

          dispatch(tr)
          return true
        },

      acceptAISuggestion:
        (id) =>
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

          dispatch(tr)

          // Create word-level annotations after dispatch so positions reference
          // the updated document. tr.mapping.map() correctly accounts for the
          // size of the inserted content regardless of whether it was inserted
          // as a flat text node or a multi-block slice — the ReplaceStep maps
          // positions at/after markTo forward by (inserted size − replaced size)
          // in both cases.
          if (docId && suggestedText.length > 0) {
            const provenance = {
              model,
              conversationId: attrs.provenanceConversationId || '',
              messageId: attrs.provenanceMessageId || '',
            }
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
              })
            }
          } else {
            console.warn('[AISuggestion] Cannot create annotation - missing docId:', { docId, suggestedText: suggestedText.length })
          }

          if (this.options.onSuggestionAccepted) {
            this.options.onSuggestionAccepted(id)
          }

          return true
        },

      rejectAISuggestion:
        (id) =>
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

          dispatch(tr)

          if (this.options.onSuggestionRejected) {
            this.options.onSuggestionRejected(id)
          }

          return true
        },

      acceptAllAISuggestions:
        () =>
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
                    blockConversionIntent: mark.attrs.blockConversionIntent ?? null
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
          for (const suggestion of suggestions) {
            tr.removeMark(suggestion.from, suggestion.to, state.schema.marks.aiSuggestion)
            if (suggestion.suggestedText.length > 0) {
              const conversion = suggestion.blockConversionIntent
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
                } else {
                  tr.replaceWith(suggestion.from, suggestion.to, state.schema.text(suggestion.suggestedText))
                }
              }
            } else {
              tr.delete(suggestion.from, suggestion.to)
            }

            if (this.options.onSuggestionAccepted) {
              this.options.onSuggestionAccepted(suggestion.id)
            }
          }

          dispatch(tr)
          return true
        },

      rejectAllAISuggestions:
        () =>
        ({ tr, state, dispatch }) => {
          if (!dispatch) return false

          const { doc } = state
          let removed = false

          doc.descendants((node, pos) => {
            node.marks.forEach((mark) => {
              if (mark.type.name === this.name) {
                tr.removeMark(pos, pos + node.nodeSize, mark.type)
                removed = true

                if (this.options.onSuggestionRejected && mark.attrs.id) {
                  this.options.onSuggestionRejected(mark.attrs.id)
                }
              }
            })
          })

          if (removed) {
            dispatch(tr)
            return true
          }

          return false
        },

      restoreAISuggestions:
        (suggestions) =>
        ({ tr, state, dispatch }) => {
          if (!dispatch || suggestions.length === 0) return false

          const { doc, schema } = state
          let restored = 0

          // Process each suggestion
          for (const suggestion of suggestions) {
            // Find the original text in the document
            const docText = doc.textContent
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
            let pos = 0
            let charCount = 0
            let foundStart = -1
            let foundEnd = -1

            doc.descendants((node, nodePos) => {
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
