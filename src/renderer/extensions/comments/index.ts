export { Comment, getComments, mergeCommentsForPersistence, commentMarkdownSerializer, findFullyCoveredCommentIds } from './extension'
export type { CommentMark, CommentData, CommentReply, CommentOptions } from './types'
export { useCommentStore, countOpenThreads } from './store'

/**
 * Event fired to open a comment thread's popover on its marked text. Dispatched
 * from the Activity panel and from chat tool-result cards; CommentPopover
 * listens. A bare string constant here (a dependency-free module) so any UI can
 * import it without pulling in a heavy component — avoids import cycles.
 */
export const OPEN_COMMENT_EVENT = 'prose:open-comment'
