import { Extension } from '@tiptap/core'
import { createReviewLogPlugin } from './plugin'

/**
 * The review log (#1233): every suggestion's history and the review events,
 * per document. Priority 10, below every record plugin, so its `apply` reads
 * their next state.
 */
export const ReviewLog = Extension.create({
  name: 'reviewLog',
  priority: 10,
  addProseMirrorPlugins() {
    return [createReviewLogPlugin()]
  },
})
