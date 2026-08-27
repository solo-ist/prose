import type { CommandProps } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import type { AISuggestionData } from './types'
import type { ReviewActor } from '../review-events'
import {
  HUMAN_SUGGESTION_TRANSACTION,
  findHumanSuggestion,
  suggestionData,
  type HumanSuggestionTarget,
} from './humanSuggestionShared'

export { findHumanSuggestion as findHumanInlineSuggestion }

export interface InlineInsertionRevisionAttrs {
  id: string
  type: 'insertion'
  originalText: string
  suggestedText: string
  explanation: string
  provenanceModel?: string
  provenanceConversationId?: string
  provenanceMessageId?: string
  provenanceSource?: 'ui' | 'chat' | 'mcp' | 'unknown'
  provenanceInvocationId?: string
  documentId?: string
  supersedes?: string[]
}

export function reviseHumanInlineInsertion(
  props: CommandProps,
  target: HumanSuggestionTarget,
  attrs: InlineInsertionRevisionAttrs,
  onAdded?: (suggestion: AISuggestionData) => void,
): boolean {
  if (
    !props.dispatch
    || target.type !== 'insertion'
    || !attrs.suggestedText
    || attrs.suggestedText.includes('\n')
  ) return false

  const markType = props.state.schema.marks.aiSuggestion
  if (!markType) return false
  const createdAt = Date.now()
  const to = target.from + attrs.suggestedText.length
  const markAttrs = {
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
    documentId: attrs.documentId || '',
    supersedes: attrs.supersedes || null,
    humanInline: true,
  }

  props.tr.replaceWith(
    target.from,
    target.to,
    props.state.schema.text(attrs.suggestedText),
  )
  props.tr.addMark(target.from, to, markType.create(markAttrs))
  props.tr.setSelection(TextSelection.create(props.tr.doc, to))
  props.tr.setStoredMarks([])
  props.tr.setMeta(HUMAN_SUGGESTION_TRANSACTION, true)
  props.dispatch(props.tr)

  onAdded?.({
    ...suggestionData(markAttrs, target.from, to),
    supersedes: attrs.supersedes,
  })
  return true
}

export function resolveHumanInlineSuggestion(
  props: CommandProps,
  target: HumanSuggestionTarget,
  decision: 'accept' | 'reject',
  actor: ReviewActor,
  onAccepted?: (suggestion: AISuggestionData, actor: ReviewActor) => void,
  onRejected?: (suggestion: AISuggestionData, actor: ReviewActor) => void,
): boolean {
  if (!props.dispatch) return false
  const suggestion = suggestionData(target.attrs, target.from, target.to)
  const markType = props.state.schema.marks.aiSuggestion
  if (!markType) return false

  if (target.type === 'edit' && decision === 'accept') {
    if (suggestion.suggestedText) {
      props.tr.replaceWith(target.from, target.to, props.state.schema.text(suggestion.suggestedText))
    } else {
      props.tr.delete(target.from, target.to)
    }
  } else if (
    (decision === 'accept' && target.type === 'deletion')
    || (decision === 'reject' && target.type === 'insertion')
  ) {
    props.tr.delete(target.from, target.to)
  } else {
    props.tr.removeMark(target.from, target.to, markType)
  }

  props.tr.setMeta(HUMAN_SUGGESTION_TRANSACTION, true)
  props.dispatch(props.tr)
  if (decision === 'accept') onAccepted?.(suggestion, actor)
  else onRejected?.(suggestion, actor)
  return true
}

export function collectSuggestionIds(doc: PMNode): string[] {
  const ranges = new Map<string, number>()
  doc.descendants((node, pos) => {
    for (const mark of node.marks) {
      if (mark.type.name !== 'aiSuggestion' || typeof mark.attrs.id !== 'string') continue
      const current = ranges.get(mark.attrs.id)
      ranges.set(mark.attrs.id, current === undefined ? pos : Math.min(current, pos))
    }
  })
  return Array.from(ranges.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([id]) => id)
}

function findTextRangeNear(
  doc: PMNode,
  text: string,
  preferredFrom: number,
): { from: number; to: number } | null {
  if (!text) return null
  const exactTo = preferredFrom + text.length
  if (
    preferredFrom >= 0
    && exactTo <= doc.content.size
    && doc.textBetween(preferredFrom, exactTo, '') === text
  ) return { from: preferredFrom, to: exactTo }

  const matches: Array<{ from: number; to: number }> = []
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    let index = node.text.indexOf(text)
    while (index >= 0) {
      matches.push({ from: pos + index, to: pos + index + text.length })
      index = node.text.indexOf(text, index + 1)
    }
  })
  if (matches.length === 0) return null
  return matches.reduce((nearest, candidate) =>
    Math.abs(candidate.from - preferredFrom) < Math.abs(nearest.from - preferredFrom)
      ? candidate
      : nearest,
  )
}

export function restoreHumanInlineSuggestions(
  tr: Transaction,
  state: EditorState,
  suggestions: AISuggestionData[],
): number {
  const markType = state.schema.marks.aiSuggestion
  if (!markType) return 0
  let restored = 0

  for (const suggestion of suggestions) {
    const expectedText = suggestion.type === 'insertion'
      ? suggestion.suggestedText
      : suggestion.originalText
    const range = findTextRangeNear(tr.doc, expectedText, suggestion.from)
    if (!range) {
      console.warn('[HumanSuggestions] Could not restore suggestion:', suggestion.id)
      continue
    }

    tr.addMark(range.from, range.to, markType.create({
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
      provenanceSource: suggestion.provenanceSource || 'ui',
      provenanceInvocationId: suggestion.provenanceInvocationId || '',
      documentId: suggestion.documentId || '',
      humanInline: true,
    }))
    restored += 1
  }

  return restored
}
