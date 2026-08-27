/**
 * Extract live suggestion marks from the editor.
 *
 * A single suggestion mark can span several text nodes or blocks. Grouping by
 * ID while expanding the range preserves the complete live anchor instead of
 * keeping only the first marked node.
 */

import type { AISuggestionData, SuggestionType } from './types'

interface SuggestionMarkLike {
  type: { name: string }
  attrs: Record<string, unknown>
}

interface SuggestionNodeLike {
  marks: SuggestionMarkLike[]
  nodeSize: number
}

export interface SuggestionEditorLike {
  state: {
    doc: {
      descendants: (
        callback: (node: SuggestionNodeLike, pos: number) => boolean | void,
      ) => void
    }
  }
}

function suggestionType(value: unknown): SuggestionType {
  if (value === 'insertion' || value === 'deletion') return value
  return 'edit'
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const strings = value.filter((entry): entry is string => typeof entry === 'string')
  return strings.length > 0 ? strings : undefined
}

function suggestionFromMark(
  attrs: Record<string, unknown>,
  from: number,
  to: number,
): AISuggestionData {
  const source = attrs.provenanceSource
  const provenanceSource = source === 'ui'
    || source === 'chat'
    || source === 'mcp'
    || source === 'unknown'
    ? source
    : undefined

  return {
    id: typeof attrs.id === 'string' ? attrs.id : '',
    type: suggestionType(attrs.type),
    originalText: typeof attrs.originalText === 'string' ? attrs.originalText : '',
    suggestedText: typeof attrs.suggestedText === 'string' ? attrs.suggestedText : '',
    explanation: typeof attrs.explanation === 'string' ? attrs.explanation : '',
    createdAt: typeof attrs.createdAt === 'number' ? attrs.createdAt : Date.now(),
    from,
    to,
    userReply: optionalString(attrs.userReply),
    provenanceModel: optionalString(attrs.provenanceModel),
    provenanceConversationId: optionalString(attrs.provenanceConversationId),
    provenanceMessageId: optionalString(attrs.provenanceMessageId),
    documentId: optionalString(attrs.documentId),
    provenanceSource,
    provenanceInvocationId: optionalString(attrs.provenanceInvocationId),
    insertionAnchorNodeId: optionalString(attrs.insertionAnchorNodeId),
    insertionAnchorText: optionalString(attrs.insertionAnchorText),
    deletionNodeId: optionalString(attrs.deletionNodeId),
    supersedes: stringArray(attrs.supersedes),
    humanInline: attrs.humanInline === true,
    blockConversionIntent: optionalString(attrs.blockConversionIntent) ?? null,
  }
}

export function getAISuggestions(editor: SuggestionEditorLike): AISuggestionData[] {
  const suggestions = new Map<string, AISuggestionData>()

  editor.state.doc.descendants((node, pos) => {
    for (const mark of node.marks) {
      if (mark.type.name !== 'aiSuggestion' || typeof mark.attrs.id !== 'string') continue

      const id = mark.attrs.id
      const from = pos
      const to = pos + node.nodeSize
      const existing = suggestions.get(id)

      if (existing) {
        existing.from = Math.min(existing.from, from)
        existing.to = Math.max(existing.to, to)
      } else {
        suggestions.set(id, suggestionFromMark(mark.attrs, from, to))
      }
    }
  })

  return Array.from(suggestions.values()).sort((left, right) => left.from - right.from)
}

export function getSuggestionsWithFeedback(editor: SuggestionEditorLike): AISuggestionData[] {
  return getAISuggestions(editor).filter((suggestion) => suggestion.userReply?.trim())
}
