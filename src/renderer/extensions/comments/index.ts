export { Comment, getComments, mergeCommentsForPersistence, commentMarkdownSerializer, findFullyCoveredCommentIds, applyCommentMarks } from './extension'
export { AI_REPLACEMENT_META } from './plugin'
export {
  commentThreadsPluginKey,
  threadPluginState,
  threadsOf,
  selectThreads,
  selectOpenThreadCount,
  countOpenThreads,
  addThreadsTo,
  updateThreadIn,
  removeThreadFrom,
  mergeThreadsInto,
  loadThreadsInto,
  EMPTY_THREADS
} from './transactions'
export type { CommentThreadsPluginState, SharePush, ThreadMeta, MarkSpan } from './transactions'
export type { CommentData, CommentReply, CommentOptions } from './types'

/**
 * Event fired to open a comment thread's popover on its marked text. Dispatched
 * from the Activity panel and from chat tool-result cards; CommentPopover
 * listens. A bare string constant here (a dependency-free module) so any UI can
 * import it without pulling in a heavy component — avoids import cycles.
 */
export const OPEN_COMMENT_EVENT = 'prose:open-comment'
