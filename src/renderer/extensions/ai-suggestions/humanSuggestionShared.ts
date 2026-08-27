import type { Node as PMNode } from '@tiptap/pm/model'
import { useSuggestionStore } from './store'
import type { AISuggestionData, SuggestionType } from './types'
import type { ReviewActor } from '../review-events'

export const HUMAN_SUGGESTION_TRANSACTION = 'humanSuggestionTransaction'

export interface HumanSuggestionTarget {
  id: string
  type: SuggestionType
  from: number
  to: number
  attrs: Record<string, unknown>
}

export function humanActor(): ReviewActor {
  return { kind: 'user', source: 'ui' }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function suggestionType(value: unknown): SuggestionType {
  if (value === 'insertion' || value === 'deletion') return value
  return 'edit'
}

export function suggestionData(
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
    humanInline: attrs.humanInline === true,
    blockConversionIntent: optionalString(attrs.blockConversionIntent) ?? null,
  }
}

export function humanMarkAttrs(args: {
  id: string
  type: SuggestionType
  originalText: string
  suggestedText: string
  createdAt: number
  documentId: string
}): Record<string, unknown> {
  return {
    id: args.id,
    type: args.type,
    originalText: args.originalText,
    suggestedText: args.suggestedText,
    explanation: '',
    createdAt: args.createdAt,
    provenanceModel: '',
    provenanceSource: 'ui',
    documentId: args.documentId,
    humanInline: true,
  }
}

export function findHumanSuggestion(doc: PMNode, id: string): HumanSuggestionTarget | null {
  let result: HumanSuggestionTarget | null = null
  doc.descendants((node, pos) => {
    for (const mark of node.marks) {
      if (mark.type.name !== 'aiSuggestion' || mark.attrs.id !== id || mark.attrs.humanInline !== true) continue
      if (result) {
        result.from = Math.min(result.from, pos)
        result.to = Math.max(result.to, pos + node.nodeSize)
      } else {
        result = {
          id,
          type: suggestionType(mark.attrs.type),
          from: pos,
          to: pos + node.nodeSize,
          attrs: mark.attrs,
        }
      }
    }
  })
  return result
}

export function hasSuggestionInRange(doc: PMNode, from: number, to: number): boolean {
  const safeFrom = Math.max(0, Math.min(from, doc.content.size))
  const safeTo = Math.max(safeFrom, Math.min(to, doc.content.size))
  const ranges = new Map<string, { from: number; to: number }>()

  doc.descendants((node, pos) => {
    for (const mark of node.marks) {
      if (mark.type.name !== 'aiSuggestion' || typeof mark.attrs.id !== 'string') continue
      const existing = ranges.get(mark.attrs.id)
      ranges.set(mark.attrs.id, existing
        ? { from: Math.min(existing.from, pos), to: Math.max(existing.to, pos + node.nodeSize) }
        : { from: pos, to: pos + node.nodeSize })
    }
  })

  if (safeFrom === safeTo) {
    // A cursor exactly at the start or end of a suggestion is beside it, not
    // inside it. This lets users continue typing around pending changes while
    // still protecting the suggestion's interior.
    return Array.from(ranges.values()).some((range) =>
      safeFrom > range.from && safeFrom < range.to
    )
  }

  return Array.from(ranges.values()).some((range) =>
    safeFrom < range.to && safeTo > range.from
  )
}

export function humanInsertionAt(doc: PMNode, position: number): HumanSuggestionTarget | null {
  const ids = new Set<string>()
  const from = Math.max(0, position - 1)
  const to = Math.min(doc.content.size, position + 1)
  doc.nodesBetween(from, to, (node) => {
    for (const mark of node.marks) {
      if (
        mark.type.name === 'aiSuggestion'
        && mark.attrs.humanInline === true
        && mark.attrs.type === 'insertion'
        && typeof mark.attrs.id === 'string'
      ) ids.add(mark.attrs.id)
    }
  })
  for (const id of ids) {
    const target = findHumanSuggestion(doc, id)
    if (target && position >= target.from && position <= target.to) return target
  }
  return null
}

export function humanInsertionCoveringRange(
  doc: PMNode,
  from: number,
  to: number,
): HumanSuggestionTarget | null {
  if (from >= to) return null
  let id: string | null = null
  let covered = 0
  let valid = true

  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText || !node.text) return valid
    const overlapFrom = Math.max(from, pos)
    const overlapTo = Math.min(to, pos + node.nodeSize)
    if (overlapFrom >= overlapTo) return valid

    const mark = node.marks.find((candidate) =>
      candidate.type.name === 'aiSuggestion'
      && candidate.attrs.humanInline === true
      && candidate.attrs.type === 'insertion'
      && typeof candidate.attrs.id === 'string'
    )
    if (!mark || (id !== null && mark.attrs.id !== id)) {
      valid = false
      return false
    }
    id = mark.attrs.id
    covered += overlapTo - overlapFrom
    return true
  })

  return valid && id && covered === to - from ? findHumanSuggestion(doc, id) : null
}

export function queueSuggestionRecord(data: AISuggestionData, isNew: boolean): void {
  queueMicrotask(() => {
    const store = useSuggestionStore.getState()
    if (isNew || !store.history.some((record) => record.id === data.id)) {
      store.recordSuggestionAdded(data, humanActor())
      return
    }

    const history = store.history.map((record) => record.id === data.id
      ? {
          ...record,
          ...data,
          documentId: data.documentId || record.documentId,
          createdBy: record.createdBy ?? humanActor(),
        }
      : record)
    useSuggestionStore.setState({ history })
    if (data.documentId) {
      void useSuggestionStore.getState().saveHistory(data.documentId, history).catch((error) => {
        console.error('[HumanSuggestions] Failed to update suggestion history:', error)
      })
    }
  })
}

export function queueSuggestionCancellation(data: AISuggestionData): void {
  queueMicrotask(() => {
    useSuggestionStore.getState().recordSuggestionDecision(data, 'rejected', humanActor())
  })
}
