import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { useEditorStore } from '../../stores/editorStore'
import { isHumanSuggesting } from '../../stores/humanSuggestionModeStore'
import type { AISuggestionData } from './types'
import {
  HUMAN_SUGGESTION_TRANSACTION,
  findHumanSuggestion,
  hasSuggestionInRange,
  humanInsertionAt,
  humanInsertionCoveringRange,
  humanMarkAttrs,
  queueSuggestionCancellation,
  queueSuggestionRecord,
  suggestionData,
  type HumanSuggestionTarget,
} from './humanSuggestionShared'

export const humanSuggestionPluginKey = new PluginKey('humanSuggestions')
const GROUP_WINDOW_MS = 1500

interface ActiveGroup {
  id: string
  type: 'insertion' | 'deletion' | 'edit'
  documentId: string
  lastChangedAt: number
}

let activeGroup: ActiveGroup | null = null

function canSuggest(): { documentId: string } | null {
  const editorState = useEditorStore.getState()
  if (
    !isHumanSuggesting()
    || editorState.sourceMode
    || editorState.isRemarkableReadOnly
    || editorState.isPreviewTab
    || !editorState.document.documentId
  ) {
    activeGroup = null
    return null
  }
  return { documentId: editorState.document.documentId }
}

function currentGroup(
  doc: PMNode,
  documentId: string,
  type: 'insertion' | 'deletion' | 'edit',
  now: number,
): HumanSuggestionTarget | null {
  if (
    !activeGroup
    || activeGroup.documentId !== documentId
    || activeGroup.type !== type
    || now - activeGroup.lastChangedAt > GROUP_WINDOW_MS
  ) return null
  return findHumanSuggestion(doc, activeGroup.id)
}

function updateOwnEdit(
  view: EditorView,
  target: HumanSuggestionTarget,
  text: string,
  documentId: string,
): boolean {
  const markType = view.state.schema.marks.aiSuggestion
  if (!markType || target.type !== 'edit' || !text) return false

  const now = Date.now()
  const attrs = {
    ...target.attrs,
    id: target.id,
    type: 'edit' as const,
    originalText: typeof target.attrs.originalText === 'string'
      ? target.attrs.originalText
      : '',
    suggestedText: `${typeof target.attrs.suggestedText === 'string' ? target.attrs.suggestedText : ''}${text}`,
    createdAt: typeof target.attrs.createdAt === 'number' ? target.attrs.createdAt : now,
    documentId,
    humanInline: true,
  }
  const tr = view.state.tr
  tr.removeMark(target.from, target.to, markType)
  tr.addMark(target.from, target.to, markType.create(attrs))
  tr.setSelection(TextSelection.create(tr.doc, target.to))
  tr.setStoredMarks([])

  activeGroup = { id: target.id, type: 'edit', documentId, lastChangedAt: now }
  return finishSuggestionTransaction(view, tr, suggestionData(attrs, target.from, target.to), false)
}

function finishSuggestionTransaction(
  view: EditorView,
  tr: Transaction,
  data: AISuggestionData,
  isNew: boolean,
): boolean {
  tr.setMeta(HUMAN_SUGGESTION_TRANSACTION, true)
  view.dispatch(tr)
  queueSuggestionRecord(data, isNew)
  return true
}

function updateOwnInsertion(
  view: EditorView,
  target: HumanSuggestionTarget,
  from: number,
  to: number,
  text: string,
  documentId: string,
): boolean {
  const markType = view.state.schema.marks.aiSuggestion
  if (!markType) return false

  const tr = view.state.tr.insertText(text, from, to)
  const insertedFrom = tr.mapping.map(from, -1)
  const insertedTo = insertedFrom + text.length
  let mapped = findHumanSuggestion(tr.doc, target.id)
  if (!mapped && text && insertedFrom < insertedTo) {
    mapped = { ...target, from: insertedFrom, to: insertedTo }
  }

  // ProseMirror does not necessarily inherit a mark when text is inserted at
  // the edge of a marked range. Include the inserted span explicitly so a
  // contiguous edit to the user's own insertion remains one suggestion.
  if (mapped && insertedFrom < insertedTo) {
    mapped = {
      ...mapped,
      from: Math.min(mapped.from, insertedFrom),
      to: Math.max(mapped.to, insertedTo),
    }
  }

  if (!mapped || mapped.from >= mapped.to) {
    tr.setMeta(HUMAN_SUGGESTION_TRANSACTION, true)
    view.dispatch(tr)
    activeGroup = null
    queueSuggestionCancellation(suggestionData(target.attrs, target.from, target.to))
    return true
  }

  const suggestedText = tr.doc.textBetween(mapped.from, mapped.to, '')
  if (!suggestedText) return false
  const now = Date.now()
  const attrs = humanMarkAttrs({
    id: target.id,
    type: 'insertion',
    originalText: '',
    suggestedText,
    createdAt: typeof target.attrs.createdAt === 'number' ? target.attrs.createdAt : now,
    documentId,
  })
  tr.removeMark(mapped.from, mapped.to, markType)
  tr.addMark(mapped.from, mapped.to, markType.create(attrs))
  tr.setSelection(TextSelection.create(tr.doc, insertedTo))
  tr.setStoredMarks([])

  const data = suggestionData(attrs, mapped.from, mapped.to)
  activeGroup = { id: target.id, type: 'insertion', documentId, lastChangedAt: now }
  return finishSuggestionTransaction(view, tr, data, false)
}

function captureInsertion(
  view: EditorView,
  position: number,
  text: string,
  documentId: string,
): boolean {
  const markType = view.state.schema.marks.aiSuggestion
  if (!markType || !text) return false

  const activeEdit = currentGroup(view.state.doc, documentId, 'edit', Date.now())
  if (activeEdit && position === activeEdit.to) {
    return updateOwnEdit(view, activeEdit, text, documentId)
  }

  const ownInsertion = humanInsertionAt(view.state.doc, position)
  if (ownInsertion) {
    return updateOwnInsertion(view, ownInsertion, position, position, text, documentId)
  }
  if (hasSuggestionInRange(view.state.doc, position, position)) return true

  const now = Date.now()
  const existing = currentGroup(view.state.doc, documentId, 'insertion', now)
  const tr = view.state.tr.insertText(text, position)
  const insertedFrom = position
  const insertedTo = position + text.length
  let data: AISuggestionData
  let isNew = true

  if (existing && position >= existing.from && position <= existing.to) {
    const mappedFrom = tr.mapping.map(existing.from, 1)
    const mappedTo = tr.mapping.map(existing.to, -1)
    const from = Math.min(mappedFrom, insertedFrom)
    const to = Math.max(mappedTo, insertedTo)
    const attrs = humanMarkAttrs({
      id: existing.id,
      type: 'insertion',
      originalText: '',
      suggestedText: tr.doc.textBetween(from, to, ''),
      createdAt: typeof existing.attrs.createdAt === 'number' ? existing.attrs.createdAt : now,
      documentId,
    })
    tr.removeMark(mappedFrom, mappedTo, markType)
    tr.addMark(from, to, markType.create(attrs))
    data = suggestionData(attrs, from, to)
    isNew = false
  } else {
    const attrs = humanMarkAttrs({
      id: crypto.randomUUID(),
      type: 'insertion',
      originalText: '',
      suggestedText: text,
      createdAt: now,
      documentId,
    })
    tr.addMark(insertedFrom, insertedTo, markType.create(attrs))
    data = suggestionData(attrs, insertedFrom, insertedTo)
  }

  tr.setSelection(TextSelection.create(tr.doc, insertedTo))
  tr.setStoredMarks([])
  activeGroup = { id: data.id, type: 'insertion', documentId, lastChangedAt: now }
  return finishSuggestionTransaction(view, tr, data, isNew)
}

function captureReplacement(
  view: EditorView,
  from: number,
  to: number,
  text: string,
  documentId: string,
): boolean {
  const markType = view.state.schema.marks.aiSuggestion
  if (!markType || from >= to || !text) return false

  const ownInsertion = humanInsertionCoveringRange(view.state.doc, from, to)
  if (ownInsertion) return updateOwnInsertion(view, ownInsertion, from, to, text, documentId)
  if (hasSuggestionInRange(view.state.doc, from, to)) return true

  const originalText = view.state.doc.textBetween(from, to, '')
  if (!originalText) return false
  const now = Date.now()
  const attrs = humanMarkAttrs({
    id: crypto.randomUUID(),
    type: 'edit',
    originalText,
    suggestedText: text,
    createdAt: now,
    documentId,
  })
  const tr = view.state.tr
  tr.addMark(from, to, markType.create(attrs))
  tr.setSelection(TextSelection.create(tr.doc, to))
  tr.setStoredMarks([])
  activeGroup = { id: attrs.id, type: 'edit', documentId, lastChangedAt: now }
  return finishSuggestionTransaction(view, tr, suggestionData(attrs, from, to), true)
}

function captureText(
  view: EditorView,
  from: number,
  to: number,
  text: string,
): boolean {
  const context = canSuggest()
  if (!context || text.includes('\n')) return false
  return from === to
    ? captureInsertion(view, from, text, context.documentId)
    : captureReplacement(view, from, to, text, context.documentId)
}

function captureDeletion(
  view: EditorView,
  from: number,
  to: number,
  direction: 'backward' | 'forward',
): boolean {
  const context = canSuggest()
  const markType = view.state.schema.marks.aiSuggestion
  if (!context || !markType || from >= to) return false

  const ownInsertion = humanInsertionCoveringRange(view.state.doc, from, to)
  if (ownInsertion) return updateOwnInsertion(view, ownInsertion, from, to, '', context.documentId)

  const originalText = view.state.doc.textBetween(from, to, '')
  if (!originalText || originalText.includes('\n')) return false
  const now = Date.now()
  const existing = currentGroup(view.state.doc, context.documentId, 'deletion', now)
  const touches = existing && from <= existing.to && to >= existing.from
  if (!touches && hasSuggestionInRange(view.state.doc, from, to)) return true
  const rangeFrom = touches && existing ? Math.min(existing.from, from) : from
  const rangeTo = touches && existing ? Math.max(existing.to, to) : to
  const id = touches && existing ? existing.id : crypto.randomUUID()
  const attrs = humanMarkAttrs({
    id,
    type: 'deletion',
    originalText: view.state.doc.textBetween(rangeFrom, rangeTo, ''),
    suggestedText: '',
    createdAt: touches && existing && typeof existing.attrs.createdAt === 'number'
      ? existing.attrs.createdAt
      : now,
    documentId: context.documentId,
  })
  const tr = view.state.tr
  if (touches && existing) tr.removeMark(existing.from, existing.to, markType)
  tr.addMark(rangeFrom, rangeTo, markType.create(attrs))
  tr.setSelection(TextSelection.create(tr.doc, direction === 'backward' ? from : to))
  tr.setStoredMarks([])

  const data = suggestionData(attrs, rangeFrom, rangeTo)
  activeGroup = { id, type: 'deletion', documentId: context.documentId, lastChangedAt: now }
  return finishSuggestionTransaction(view, tr, data, !(touches && existing))
}

function deletionRangeForKey(
  state: EditorState,
  key: 'Backspace' | 'Delete',
): { from: number; to: number; direction: 'backward' | 'forward' } | null {
  const { from, to } = state.selection
  if (from !== to) return { from, to, direction: 'backward' }

  const $cursor = state.doc.resolve(from)
  if (!$cursor.parent.isTextblock) return null
  if (key === 'Backspace') {
    if ($cursor.parentOffset === 0) return null
    return { from: from - 1, to: from, direction: 'backward' }
  }
  if ($cursor.parentOffset >= $cursor.parent.content.size) return null
  return { from, to: from + 1, direction: 'forward' }
}

export function createHumanSuggestionPlugin(): Plugin {
  return new Plugin({
    key: humanSuggestionPluginKey,
    props: {
      handleTextInput: (view, from, to, text) => captureText(view, from, to, text),
      handleKeyDown: (view, event) => {
        if (
          (event.key !== 'Backspace' && event.key !== 'Delete')
          || event.metaKey
          || event.ctrlKey
          || event.altKey
          || event.isComposing
        ) return false
        const range = deletionRangeForKey(view.state, event.key)
        return range ? captureDeletion(view, range.from, range.to, range.direction) : false
      },
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData('text/plain') ?? ''
        if (!text) return false
        const { from, to } = view.state.selection
        return captureText(view, from, to, text)
      },
      handleDOMEvents: {
        cut: (view, event) => {
          const { from, to } = view.state.selection
          if (from === to) return false
          const text = view.state.doc.textBetween(from, to, '')
          if (!text || text.includes('\n') || !event.clipboardData) return false
          if (!captureDeletion(view, from, to, 'backward')) return false
          event.clipboardData.setData('text/plain', text)
          event.preventDefault()
          return true
        },
      },
    },
  })
}
