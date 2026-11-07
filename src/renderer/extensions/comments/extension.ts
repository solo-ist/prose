/**
 * Comment Mark Extension for TipTap
 *
 * Allows users to add comments to selected text. Comments are instructions
 * for AI to process. The mark is the anchor; the thread (replies, resolved,
 * anchorLost, share ids) lives in the comment threads plugin state of the
 * document's `EditorState` (#1147, plugin.ts), and every command below
 * changes mark and thread in one transaction.
 */

import { SELF, type Actor } from '../../../shared/review/actor'
import { threadActorIn } from '../review-log/transactions'
import { Mark, mergeAttributes } from '@tiptap/core'
import type { Transaction } from '@tiptap/pm/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { MarkSerializerSpec } from 'prosemirror-markdown'
import type { CommentOptions, CommentData, CommentReply } from './types'
import { createCommentThreadsPlugin } from './plugin'
import { addThreadsTo, removeThreadFrom, threadsOf, updateThreadIn } from './transactions'

export { AI_REPLACEMENT_META } from './plugin'

/**
 * Markdown serializer for comment marks - outputs just the text content
 * so comments don't appear as HTML in markdown output
 */
export const commentMarkdownSerializer: MarkSerializerSpec = {
  open: '',
  close: '',
  mixable: true,
  expelEnclosingWhitespace: true,
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    comment: {
      /**
       * Add a comment to the current selection
       */
      setComment: (attrs: { id: string; comment: string; author?: 'user' | 'ai'; actor?: Actor }) => ReturnType
      /**
       * Remove a comment by ID
       */
      unsetComment: (id?: string) => ReturnType
      /**
       * Remove all comments
       */
      unsetAllComments: () => ReturnType
      /** Resolve a thread: `resolved: true` and its marks removed, one transaction. */
      resolveThread: (id: string, by?: Actor) => ReturnType
      /** Reopen a resolved thread and put its mark back on its text (by markedText + occurrence). */
      reopenThread: (id: string, by?: Actor) => ReturnType
      /** Append a reply to a thread. */
      replyToThread: (id: string, reply: CommentReply) => ReturnType
      /** Drop a thread and its marks. `push: false` skips the share removal (the e2e seam). */
      removeThread: (id: string, opts?: { push?: boolean }) => ReturnType
      /** Patch a thread's metadata. */
      updateThread: (id: string, patch: Partial<CommentData>) => ReturnType
    }
  }
}

export const Comment = Mark.create<CommentOptions>({
  name: 'comment',

  addOptions() {
    return {
      HTMLAttributes: {},
      onCommentBlocked: undefined,
    }
  },

  addStorage() {
    return {
      markdown: {
        serialize: commentMarkdownSerializer,
      },
    }
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-comment-id'),
        renderHTML: (attributes) => {
          if (!attributes.id) return {}
          return { 'data-comment-id': attributes.id }
        },
      },
      comment: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-comment'),
        renderHTML: (attributes) => {
          return { 'data-comment': attributes.comment || '' }
        },
      },
      createdAt: {
        default: null,
        parseHTML: (element) => {
          const val = element.getAttribute('data-comment-created')
          return val ? parseInt(val, 10) : null
        },
        renderHTML: (attributes) => {
          if (!attributes.createdAt) return {}
          return { 'data-comment-created': String(attributes.createdAt) }
        },
      },
      occurrenceIndex: {
        default: 0,
        parseHTML: (element) => {
          const val = element.getAttribute('data-comment-occurrence')
          return val !== null ? parseInt(val, 10) : 0
        },
        renderHTML: (attributes) => {
          return { 'data-comment-occurrence': String(attributes.occurrenceIndex ?? 0) }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-comment-id]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes || {}, HTMLAttributes, {
        class: 'comment-mark',
      }),
      0,
    ]
  },

  addCommands() {
    return {
      setComment:
        (attrs) =>
        ({ commands, state, tr }) => {
          const { from, to } = state.selection

          // Same-type marks are exclusive in ProseMirror: setMark on a range
          // that fully covers an existing comment mark silently REPLACES it,
          // orphaning that thread's store entry (replies included) — the next
          // persistence merge then deletes the thread outright (#830). Refuse
          // the add and let the caller point at the existing thread instead.
          // Partial overlaps are fine: the old mark survives as a split.
          const covered = findFullyCoveredCommentIds(state.doc, from, to)
          if (covered.length > 0) {
            this.options.onCommentBlocked?.(covered)
            return false
          }

          // Get the selected text
          const markedText = state.doc.textBetween(from, to, ' ')

          // Compute how many non-overlapping occurrences of markedText appear
          // in the document strictly before the selection start (from).
          // This is the 0-based occurrence index for this comment.
          //
          // IMPORTANT: `from` is a ProseMirror position (counts node-boundary
          // tokens), while `matchIdx` is a char offset into doc.textContent.
          // Convert `from` to char-space first via textBetween so the comparison
          // is in the same coordinate system.
          const docText = state.doc.textContent
          const charsBefore = state.doc.textBetween(0, from, '').length
          let occurrenceIndex = 0
          if (markedText) {
            let searchOffset = 0
            while (true) {
              const matchIdx = docText.indexOf(markedText, searchOffset)
              if (matchIdx === -1 || matchIdx >= charsBefore) break
              occurrenceIndex++
              searchOffset = matchIdx + markedText.length
            }
          }

          const commentData: CommentData = {
            id: attrs.id,
            markedText,
            comment: attrs.comment,
            createdAt: Date.now(),
            // Default to a human author; `add_comment` passes 'ai' so the thread
            // renders under the Prose identity instead of "You".
            author: attrs.author ?? 'user',
            // Who wrote it (#1232): the caller's actor, else the writer for a
            // human comment. An 'ai' comment with no actor reads as unattributed.
            ...(attrs.actor ? { actor: attrs.actor } : attrs.author === 'ai' ? {} : { actor: SELF }),
            occurrenceIndex,
            from,
            to,
          }

          const result = commands.setMark(this.name, {
            id: attrs.id,
            comment: attrs.comment,
            createdAt: commentData.createdAt,
            occurrenceIndex,
          })

          // The thread rides in the same transaction as its mark (#1147).
          if (result) addThreadsTo(tr, [{ ...commentData, replies: [], resolved: false }])

          return result
        },

      unsetComment:
        (id) =>
        ({ tr, state, dispatch }) => {
          if (!dispatch) return false

          const { doc } = state
          let removed = false

          doc.descendants((node, pos) => {
            node.marks.forEach((mark) => {
              if (mark.type.name === this.name) {
                // If no ID specified, remove all; otherwise match ID
                if (!id || mark.attrs.id === id) {
                  tr.removeMark(pos, pos + node.nodeSize, mark.type)
                  removed = true
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

      unsetAllComments:
        () =>
        ({ commands }) => {
          return commands.unsetComment()
        },

      resolveThread:
        (id, by) =>
        ({ tr, state, dispatch }) => {
          const thread = threadsOf(state).find((c) => c.id === id)
          if (!thread) return false
          if (dispatch) {
            threadActorIn(tr, by ?? SELF)
            updateThreadIn(tr, id, { resolved: true })
            removeMarksOf(tr, id)
          }
          return true
        },

      reopenThread:
        (id, by) =>
        ({ tr, state, dispatch }) => {
          const thread = threadsOf(state).find((c) => c.id === id)
          if (!thread) return false
          if (dispatch) {
            threadActorIn(tr, by ?? SELF)
            updateThreadIn(tr, id, { resolved: false })
            // Re-anchor the mark that resolving removed; the plugin reads the
            // outcome from the marks (anchorLost when the text is gone).
            applyCommentMarks(tr, [{ ...thread, resolved: false }])
          }
          return true
        },

      replyToThread:
        (id, reply) =>
        ({ tr, state, dispatch }) => {
          const thread = threadsOf(state).find((c) => c.id === id)
          if (!thread) return false
          if (dispatch) updateThreadIn(tr, id, { replies: [...(thread.replies ?? []), reply] })
          return true
        },

      removeThread:
        (id, opts = {}) =>
        ({ tr, state, dispatch }) => {
          const thread = threadsOf(state).find((c) => c.id === id)
          if (!thread) return false
          if (dispatch) {
            removeThreadFrom(tr, id, { quiet: opts.push === false })
            removeMarksOf(tr, id)
          }
          return true
        },

      updateThread:
        (id, patch) =>
        ({ tr, state, dispatch }) => {
          const thread = threadsOf(state).find((c) => c.id === id)
          if (!thread) return false
          if (dispatch) updateThreadIn(tr, id, patch)
          return true
        },
    }
  },

  // Style inline comment marks by thread state (read from the comment store):
  // pending (no replies) → pink dashed underline; open thread (has replies) →
  // the default amber. Resolved threads remove their mark, so only these two
  // render in the document.
  addProseMirrorPlugins() {
    return [createCommentThreadsPlugin()]
  },
})

/** Remove every mark of thread `id` from the document `tr` holds. */
function removeMarksOf(tr: Transaction, id: string): void {
  const type = tr.doc.type.schema.marks.comment
  const ranges: Array<{ from: number; to: number }> = []
  tr.doc.descendants((node, pos) => {
    if (node.marks.some((m) => m.type === type && m.attrs.id === id)) ranges.push({ from: pos, to: pos + node.nodeSize })
  })
  for (const r of ranges) tr.removeMark(r.from, r.to, type)
}

export interface AnchorOutcome {
  anchored: string[]
  lost: string[]
}

/**
 * Re-apply comment marks for `comments` to the document `tr` holds, as part
 * of `tr`: a session's seed transaction, a reload, a thread merge, a re-open
 * (#1145, #1147). Pure: the caller dispatches or applies the transaction; the
 * threads plugin reads the outcome from the marks (`anchorLost` for a thread
 * whose text is gone).
 *
 * Creation (setComment) and persistence (getComments) count the occurrences
 * of markedText in the raw textContent, so the Nth occurrence is found in
 * that same string; the space-stripped search is the fallback for a
 * cross-block comment, whose markedText carries block separators (#665,
 * #1137). Resolved threads are history only and get no mark. A thread whose
 * text is gone is reported as lost and kept by persistence (#769).
 */
export function applyCommentMarks(tr: Transaction, comments: CommentData[]): AnchorOutcome {
  const doc = tr.doc
  const schema = doc.type.schema
  const docText = doc.textContent

  // Ranges already re-marked in this pass — a later addMark that fully
  // covers an earlier one replaces it (same clobber semantics as setComment,
  // #830). Creation is guarded, but legacy data can still hold same-anchor
  // threads; warn instead of losing one silently.
  const restoredRanges: Array<{ id: string; from: number; to: number }> = []
  const lostIds: string[] = []
  const anchoredIds: string[] = []

  for (const comment of comments) {
    if (comment.resolved) continue

    const rawSearchText = comment.markedText
    if (!rawSearchText) {
      console.warn('[Comment] Cannot restore comment without markedText:', comment.id)
      lostIds.push(comment.id)
      continue
    }

    const targetOccurrence = comment.occurrenceIndex ?? 0
    let range: { from: number; to: number } | null = null
    let usedOccurrence: number | null = null
    const raw = findOccurrence(docText, rawSearchText, targetOccurrence)
    if (raw) {
      range = charRangeToPositions(doc, raw.index, raw.index + rawSearchText.length, false)
      usedOccurrence = raw.occurrence
    } else {
      const searchText = rawSearchText.replace(/ /g, '')
      const docTextNorm = docText.replace(/ /g, '')
      const norm = findOccurrence(docTextNorm, searchText, targetOccurrence)
      if (norm) {
        range = charRangeToPositions(doc, norm.index, norm.index + searchText.length, true)
        usedOccurrence = norm.occurrence
      }
    }

    if (!range) {
      console.warn('[Comment] Cannot find markedText in document:', {
        id: comment.id,
        markedText: rawSearchText.substring(0, 50)
      })
      lostIds.push(comment.id)
      continue
    }
    if (usedOccurrence !== targetOccurrence) {
      // Fewer occurrences than expected (text changed); fell back to last found
      console.warn('[Comment] occurrenceIndex out of range, using last occurrence:', {
        id: comment.id,
        targetOccurrence,
        usedOccurrence
      })
    }
    const { from: foundStart, to: foundEnd } = range

    const clobbered = restoredRanges.filter((r) => r.from >= foundStart && r.to <= foundEnd)
    if (clobbered.length > 0) {
      console.warn('[Comment] Restored mark fully covers earlier restored thread(s); their marks are replaced:', {
        id: comment.id,
        clobberedIds: clobbered.map((r) => r.id),
      })
      lostIds.push(...clobbered.map((r) => r.id))
    }
    restoredRanges.push({ id: comment.id, from: foundStart, to: foundEnd })

    const mark = schema.marks.comment.create({
      id: comment.id,
      comment: comment.comment,
      createdAt: comment.createdAt,
      occurrenceIndex: comment.occurrenceIndex ?? 0,
    })
    tr.addMark(foundStart, foundEnd, mark)
    anchoredIds.push(comment.id)
  }

  return { anchored: anchoredIds, lost: lostIds }
}

/**
 * Ids of comment threads whose marks would be entirely consumed by applying a
 * same-type mark across [from, to] (#830). A thread is only at risk when every
 * text node carrying its mark lies fully inside the range — a node sticking
 * out (or a second anchor elsewhere in the doc) survives setMark as a split.
 */
export function findFullyCoveredCommentIds(
  doc: ProseMirrorNode,
  from: number,
  to: number
): string[] {
  const intersecting = new Set<string>()
  const survives = new Set<string>()

  doc.descendants((node, pos) => {
    node.marks.forEach((mark) => {
      if (mark.type.name !== 'comment' || !mark.attrs.id) return
      const nodeFrom = pos
      const nodeTo = pos + node.nodeSize
      if (nodeFrom < to && nodeTo > from) {
        intersecting.add(mark.attrs.id)
        // Part of this node extends beyond the range — the split remains.
        if (nodeFrom < from || nodeTo > to) survives.add(mark.attrs.id)
      } else {
        // Anchored (also) outside the range entirely — untouched by setMark.
        survives.add(mark.attrs.id)
      }
    })
  })

  return [...intersecting].filter((id) => !survives.has(id))
}

/**
 * Extract all comments from the editor
 */
export function getComments(editor: { state: { doc: ProseMirrorNode } }): CommentData[] {
  // Map to collect all text nodes for each comment ID
  const commentMap = new Map<string, {
    texts: string[]
    comment: string
    createdAt: number
    from: number
    to: number
  }>()

  editor.state.doc.descendants((node, pos) => {
    node.marks.forEach((mark) => {
      if (mark.type.name === 'comment' && mark.attrs.id) {
        const existing = commentMap.get(mark.attrs.id)

        if (existing) {
          // Add this node's text to the existing comment
          existing.texts.push(node.textContent)
          // Extend the range to include this node
          existing.to = pos + node.nodeSize
        } else {
          // First occurrence of this comment ID
          commentMap.set(mark.attrs.id, {
            texts: [node.textContent],
            comment: mark.attrs.comment || '',
            createdAt: mark.attrs.createdAt || Date.now(),
            from: pos,
            to: pos + node.nodeSize,
          })
        }
      }
    })
  })

  // Convert map to array, joining all text nodes with paragraph separator
  const docText = editor.state.doc.textContent
  const comments: CommentData[] = []
  commentMap.forEach((data, id) => {
    const markedText = editor.state.doc.textBetween(data.from, data.to, ' ')

    // Compute occurrenceIndex: how many non-overlapping prior occurrences of
    // markedText exist in the full document text before data.from.
    //
    // IMPORTANT: `data.from` is a ProseMirror position, not a char offset.
    // Convert to char-space via textBetween before comparing against matchIdx.
    const charsBefore = editor.state.doc.textBetween(0, data.from, '').length
    let occurrenceIndex = 0
    if (markedText) {
      let searchOffset = 0
      while (true) {
        const matchIdx = docText.indexOf(markedText, searchOffset)
        if (matchIdx === -1 || matchIdx >= charsBefore) break
        occurrenceIndex++
        searchOffset = matchIdx + markedText.length
      }
    }

    comments.push({
      id,
      markedText,
      comment: data.comment,
      createdAt: data.createdAt,
      occurrenceIndex,
      from: data.from,
      to: data.to,
    })
  })

  return comments
}

/**
 * Merge live comment marks (current positions, from `getComments`) with the
 * threads (replies + resolved state, which the marks don't carry) into the
 * canonical shape to persist, export or bake into a share artifact.
 *
 * - Live marks win for position/markedText/occurrenceIndex.
 * - Threads contribute replies + resolved + author (the mark doesn't carry
 *   author, so it must be re-grafted or it resets to user).
 * - Resolved threads have no mark (restore skips them), so they're appended
 *   as history-only entries.
 *
 * This is the persistence-shaped sibling of executeListComments' tool-facing
 * merge — keep the two in step. Saving raw getComments() instead of this is the
 * bug that drops replies/resolved on every tab-switch save.
 */
export function mergeCommentsForPersistence(
  editor: Parameters<typeof getComments>[0],
  stored: readonly CommentData[]
): CommentData[] {
  const liveMarks = getComments(editor)
  const storedById = new Map(stored.map((c) => [c.id, c]))
  const liveIds = new Set(liveMarks.map((m) => m.id))

  const merged = liveMarks.map((m) => {
    const s = storedById.get(m.id)
    // Spread the stored thread FIRST so store-only fields (authorName,
    // publishRev, shareId, occurrenceIndex) survive; the live mark then
    // overrides the anchor-derived fields (positions, markedText). A live
    // mark means the anchor exists — clear any stale anchorLost flag.
    return s
      ? { ...s, ...m, replies: s.replies ?? [], resolved: s.resolved ?? false, author: s.author ?? 'user', anchorLost: false }
      : m
  })

  // Resolved (markless) threads survive only as metadata — keep them.
  const resolvedOnly = stored.filter((c) => c.resolved && !liveIds.has(c.id))

  // Open markless threads are anchor-lost (#769): the reviewer's comment
  // outlives the text it pointed at. The plugin sets the flag as soon as a
  // mark goes; a thread that reaches here without it is flagged, never
  // dropped (a deleted text resolves its thread in the plugin, #928).
  const lostOnly = stored
    .filter((c) => !c.resolved && !liveIds.has(c.id))
    .map((c) => (c.anchorLost === true ? c : { ...c, anchorLost: true }))

  return [...merged, ...resolvedOnly, ...lostOnly]
}

/**
 * Map a normalised char offset (spaces stripped) back to the real char offset
 * within an original string. Used by restoreComments when matching comment text
 * across block boundaries (#665).
 *
 * Example: original = "hello world", stripped = "helloworld"
 *   mapNormOffsetToChar(original, 5) → 6 (the 'w' after the space)
 */
function mapNormOffsetToChar(original: string, normOffset: number): number {
  let norm = 0
  for (let i = 0; i < original.length; i++) {
    if (original[i] !== ' ') {
      if (norm === normOffset) return i
      norm++
    }
  }
  return original.length
}

/**
 * The Nth non-overlapping occurrence of `needle` in `haystack`, walked the
 * same way setComment and getComments count occurrenceIndex. When the text has
 * fewer occurrences than expected (it changed since the comment was made) the
 * last one is returned, with `occurrence` saying which one that was.
 */
function findOccurrence(
  haystack: string,
  needle: string,
  target: number,
): { index: number; occurrence: number } | null {
  if (!needle) return null
  let occurrence = 0
  let offset = 0
  let last: { index: number; occurrence: number } | null = null
  while (true) {
    const index = haystack.indexOf(needle, offset)
    if (index === -1) break
    last = { index, occurrence }
    if (occurrence === target) return last
    occurrence++
    offset = index + needle.length
  }
  return last
}

/**
 * Map a [start, end) char range to ProseMirror positions by walking the text
 * nodes in document order. With `stripSpaces` the range is in space-stripped
 * coordinates (the #665 cross-block search); otherwise it is an offset into
 * `doc.textContent`.
 */
function charRangeToPositions(
  doc: ProseMirrorNode,
  start: number,
  end: number,
  stripSpaces: boolean,
): { from: number; to: number } | null {
  let count = 0
  let from = -1
  let to = -1
  doc.descendants((node, nodePos) => {
    if (from !== -1 && to !== -1) return false
    if (node.isText && node.text) {
      const measured = stripSpaces ? node.text.replace(/ /g, '') : node.text
      const nodeStart = count
      const nodeEnd = count + measured.length
      if (from === -1 && start >= nodeStart && start < nodeEnd) {
        const offset = start - nodeStart
        from = nodePos + (stripSpaces ? mapNormOffsetToChar(node.text, offset) : offset)
      }
      if (from !== -1 && end > nodeStart && end <= nodeEnd) {
        const offset = end - nodeStart
        // In stripped coordinates the end is exclusive, so map the last
        // matched char and step past it; mapping `offset` itself would land
        // on the next non-space char and swallow any space in between.
        to = nodePos + (stripSpaces ? mapNormOffsetToChar(node.text, offset - 1) + 1 : offset)
        return false
      }
      count = nodeEnd
    }
    return true
  })
  return from === -1 || to === -1 ? null : { from, to }
}

export default Comment
