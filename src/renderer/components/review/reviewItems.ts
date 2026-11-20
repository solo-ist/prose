/**
 * What Quick Review steps through (#891): every pending AI suggestion and
 * tracked change of a document, in document order. A tracked change is shown
 * like a suggestion: its deleted text as the original, its inserted text as
 * the suggestion.
 */

import type { Editor } from '@tiptap/core'
import { getAISuggestions } from '../../extensions/ai-suggestions/extension'
import type { AISuggestionData } from '../../extensions/ai-suggestions/types'
import { trackedChangesIn } from '../../extensions/tracked-changes/changes'

/** A card's data: a suggestion's, or a tracked change's with its own type (a pure deletion included). */
export type ReviewItem = Omit<AISuggestionData, 'type'> & {
  type: AISuggestionData['type'] | 'deletion'
  tracked?: boolean
}

export function reviewItems(editor: Pick<Editor, 'state'>): ReviewItem[] {
  const tracked: ReviewItem[] = trackedChangesIn(editor.state.doc).map((c) => ({
    id: c.id,
    type: c.type,
    originalText: c.deletedText,
    suggestedText: c.insertedText,
    explanation: '',
    createdAt: c.createdAt,
    from: c.from,
    to: c.to,
    actor: c.actor,
    tracked: true,
  }))
  return [...getAISuggestions(editor), ...tracked].sort((a, b) => a.from - b.from)
}
