/**
 * artifactImport.ts — merge comments embedded in an opened Prose HTML
 * artifact into the document's comment store (#768 tier 3: the sneakernet
 * loop — a reviewer annotates the artifact offline, downloads the annotated
 * copy, sends the file back; opening it in Prose lands their comments as
 * real threads).
 *
 * Merge semantics live in commentMerge.ts (shared with the #769 gateway
 * sync). Anchoring is not done here — restoreComments derives marks from
 * markedText + occurrenceIndex on load, as always.
 */
import { extractCommentsFromHtml } from './htmlExport'
import { loadComments, saveComments } from './persistence'
import type { CommentData } from '../extensions/comments/types'
import { useCommentStore } from '../extensions/comments/store'
import { useNotificationStore } from '../stores/notificationStore'
import { cleanString, cleanReply, mergeCommentThreads } from './commentMerge'

function isImportableThread(c: unknown): c is CommentData {
  const t = c as CommentData
  return !!t && typeof t.id === 'string' && typeof t.markedText === 'string' && typeof t.comment === 'string'
}

function cleanThread(incoming: CommentData, fallbackPublishRev: string | null): CommentData {
  return {
    id: cleanString(incoming.id, 128),
    markedText: cleanString(incoming.markedText),
    comment: cleanString(incoming.comment),
    createdAt: typeof incoming.createdAt === 'number' ? incoming.createdAt : Date.now(),
    author: incoming.author === 'ai' ? 'ai' : 'user',
    ...(incoming.authorName ? { authorName: cleanString(incoming.authorName, 100) } : {}),
    occurrenceIndex: typeof incoming.occurrenceIndex === 'number' ? incoming.occurrenceIndex : 0,
    from: 0,
    to: 0,
    replies: (incoming.replies ?? []).filter((r) => r && typeof r.id === 'string').map(cleanReply),
    resolved: incoming.resolved === true,
    publishRev: incoming.publishRev ?? fallbackPublishRev ?? undefined,
  }
}

/**
 * Import embedded comments from artifact HTML into `documentId`'s stored
 * comments. Returns the number of new threads + replies merged in (0 when the
 * HTML carries no comments block or nothing new).
 */
export async function importArtifactComments(rawHtml: string, documentId: string): Promise<number> {
  const block = extractCommentsFromHtml(rawHtml)
  if (!block || block.comments.length === 0) return 0

  const incoming = block.comments
    .filter(isImportableThread)
    .map((c) => cleanThread(c, block.publishRev ?? null))

  const existing = await loadComments(documentId)
  const { merged, added } = mergeCommentThreads(existing, incoming)

  if (added > 0) {
    // Annotation-persistence invariant rule 3: if this document is the one
    // currently OPEN, the merge must land in the live store before any
    // await — a concurrent routine save reading stale pendingComments would
    // otherwise write the pre-import set over the just-imported one (the
    // exact race caught live in shareSync; PR #901 review flagged the same
    // hole here for re-imports of an already-open document).
    const store = useCommentStore.getState()
    const isOpenDocument = store.documentId === documentId
    if (isOpenDocument) useCommentStore.setState({ pendingComments: merged })
    await saveComments(documentId, merged)
    if (isOpenDocument) {
      // Reload → needsRestore → the Editor restore effect re-derives marks.
      await useCommentStore.getState().loadComments(documentId)
    }
    useNotificationStore.getState().notify({
      message: `Imported ${added} comment${added === 1 ? '' : 's'} from the shared copy.`,
      durationMs: 5000,
    })
  }
  return added
}
