/**
 * Comment Mark Extension for TipTap
 *
 * Allows users to add comments to selected text.
 * Comments are instructions for AI to process.
 */

import { Mark, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { MarkSerializerSpec } from 'prosemirror-markdown'
import type { CommentOptions, CommentData } from './types'
import { useCommentStore } from './store'
import { pushResolveToShare } from '../../lib/sharePush'

const commentStatePluginKey = new PluginKey('commentState')

/**
 * Transaction meta marking a programmatic AI replacement — an accepted
 * suggestion or an `edit`/`insert` tool write (#1099). Those build mark-free
 * content, so any comment anchored in the replaced range vanishes without the
 * writer having deleted anything. autoResolveDeletedComments reads the meta
 * and keeps such threads open as anchorLost instead of resolving them.
 */
export const AI_REPLACEMENT_META = 'aiReplacement'

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
      setComment: (attrs: { id: string; comment: string; author?: 'user' | 'ai' }) => ReturnType
      /**
       * Remove a comment by ID
       */
      unsetComment: (id?: string) => ReturnType
      /**
       * Remove all comments
       */
      unsetAllComments: () => ReturnType
      /**
       * Restore comment marks from persisted data (used after tab switch)
       */
      restoreComments: (comments: CommentData[]) => ReturnType
    }
  }
}

export const Comment = Mark.create<CommentOptions>({
  name: 'comment',

  addOptions() {
    return {
      HTMLAttributes: {},
      onCommentAdded: undefined,
      onCommentRemoved: undefined,
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
        ({ commands, state }) => {
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
            occurrenceIndex,
            from,
            to,
          }

          const result = commands.setMark(this.name, {
            id: attrs.id,
            comment: attrs.comment,
            createdAt: Date.now(),
            occurrenceIndex,
          })

          if (result && this.options.onCommentAdded) {
            this.options.onCommentAdded(commentData)
          }

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

                  if (this.options.onCommentRemoved && mark.attrs.id) {
                    this.options.onCommentRemoved(mark.attrs.id)
                  }
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

      restoreComments:
        (comments) =>
        ({ tr, state, dispatch }) => {
          if (!dispatch || comments.length === 0) return false

          const { doc, schema } = state
          let restored = 0

          // doc.textContent has no block separators; textBetween stored the
          // markedText with a space separator. Normalise before searching so
          // cross-block comments match (#665 fix).
          const docText = doc.textContent

          // Ranges already re-marked in this pass — a later addMark that fully
          // covers an earlier one replaces it (same clobber semantics as
          // setComment, #830). Creation is now guarded, but legacy data can
          // still hold same-anchor threads; warn instead of losing one silently.
          const restoredRanges: Array<{ id: string; from: number; to: number }> = []

          // Anchor bookkeeping (#769): threads whose text can't be found are
          // KEPT and flagged anchorLost in the store (persistence preserves
          // flagged threads); a later successful anchor clears the flag.
          const lostIds: string[] = []
          const anchoredIds: string[] = []

          for (const comment of comments) {
            // Resolved threads are stored but must not be re-marked in the
            // editor — they're history only.
            if (comment.resolved) continue

            const rawSearchText = comment.markedText
            if (!rawSearchText) {
              console.warn('[Comment] Cannot restore comment without markedText:', comment.id)
              lostIds.push(comment.id)
              continue
            }

            // Creation (setComment) and persistence (getComments) count the
            // occurrences of markedText in the raw textContent, so the Nth
            // occurrence has to be found in that same string. The restore used
            // to count in space-stripped text only: there "that he" contains
            // "the", so a short word had more matches than creation saw and
            // occurrence N landed earlier in the document, and the next
            // persist rewrote markedText from the wrong mark (#1137).
            const targetOccurrence = comment.occurrenceIndex ?? 0
            let range: { from: number; to: number } | null = null
            let usedOccurrence: number | null = null
            const raw = findOccurrence(docText, rawSearchText, targetOccurrence)
            if (raw) {
              range = charRangeToPositions(doc, raw.index, raw.index + rawSearchText.length, false)
              usedOccurrence = raw.occurrence
            } else {
              // A cross-block comment: textBetween stored markedText with a
              // space block separator that textContent does not have, so the
              // raw search cannot match. Strip spaces from both sides (#665).
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

            const clobbered = restoredRanges.filter(
              (r) => r.from >= foundStart && r.to <= foundEnd
            )
            if (clobbered.length > 0) {
              console.warn('[Comment] Restored mark fully covers earlier restored thread(s); their marks are replaced:', {
                id: comment.id,
                clobberedIds: clobbered.map((r) => r.id),
              })
              // Their marks are gone — classify as anchor-lost so persistence
              // keeps the threads (lost wins over anchored in reconciliation).
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
            restored++
            anchoredIds.push(comment.id)

            console.log('[Comment] Restored comment mark:', {
              id: comment.id,
              from: foundStart,
              to: foundEnd
            })
          }

          // Reconcile anchorLost flags in the store (#769) — flag misses, and
          // clear the flag on threads that anchored (e.g. synced threads land
          // flagged until their first successful restore).
          const lost = new Set(lostIds)
          const anchored = new Set(anchoredIds)
          const { pendingComments } = useCommentStore.getState()
          let flagsChanged = false
          const reconciled = pendingComments.map((c) => {
            if (lost.has(c.id) && c.anchorLost !== true) {
              flagsChanged = true
              return { ...c, anchorLost: true }
            }
            if (anchored.has(c.id) && c.anchorLost) {
              flagsChanged = true
              return { ...c, anchorLost: false }
            }
            return c
          })
          if (flagsChanged) {
            useCommentStore.setState({ pendingComments: reconciled })
          }

          if (restored > 0) {
            dispatch(tr)
            console.log('[Comment] Restored', restored, 'of', comments.length, 'comments')
            return true
          }

          return false
        },
    }
  },

  // Style inline comment marks by thread state (read from the comment store):
  // pending (no replies) → pink dashed underline; open thread (has replies) →
  // the default amber. Resolved threads remove their mark, so only these two
  // render in the document.
  addProseMirrorPlugins() {
    // Set when any transaction in the current dispatch is a programmatic
    // content load: TipTap tags setContent with preventUpdate:true, and user
    // edits never are. Kept per plugin instance so editors never share it, and
    // outside the plugin state because appendTransaction follow-ups (node-ids)
    // lack the meta and would overwrite a state value before the view update
    // reads it (#933). `apply` is only the hook that arms it.
    let contentLoadInDispatch = false
    // Same per-dispatch shape for AI replacements (#1099).
    let aiReplacementInDispatch = false
    return [
      new Plugin({
        key: commentStatePluginKey,
        state: {
          init: () => null,
          apply(tr) {
            if (tr.getMeta('preventUpdate') === true) contentLoadInDispatch = true
            if (tr.getMeta(AI_REPLACEMENT_META) === true) aiReplacementInDispatch = true
            return null
          },
        },
        view: (view) => {
          // A reply lands in the store without a ProseMirror transaction, so
          // nudge the view to recompute decorations when the store changes.
          // queueMicrotask defers past the current dispatch (onCommentAdded
          // fires mid-transaction) to avoid reentrant dispatches.
          const unsubscribe = useCommentStore.subscribe(() => {
            queueMicrotask(() => {
              if (view.isDestroyed) return
              view.dispatch(view.state.tr.setMeta(commentStatePluginKey, true))
            })
          })
          return {
            update: (v, prevState) => {
              // Consume unconditionally so every dispatch starts clean.
              const contentLoad = contentLoadInDispatch
              const aiReplacement = aiReplacementInDispatch
              contentLoadInDispatch = false
              aiReplacementInDispatch = false
              autoResolveDeletedComments(v, prevState, contentLoad, aiReplacement)
            },
            destroy: unsubscribe,
          }
        },
        props: {
          decorations: (state) => {
            const byId = new Map(
              useCommentStore.getState().pendingComments.map((c) => [c.id, c])
            )
            const decos: Decoration[] = []
            state.doc.descendants((node, pos) => {
              const mark = node.marks.find((m) => m.type.name === 'comment')
              if (!mark || !mark.attrs.id) return
              const data = byId.get(mark.attrs.id)
              // Unknown ids (not yet mirrored into the store) read as pending.
              const pending = data ? !data.resolved && (data.replies?.length ?? 0) === 0 : true
              if (pending) {
                decos.push(
                  Decoration.inline(pos, pos + node.nodeSize, { class: 'comment-mark--pending' })
                )
              }
            })
            return DecorationSet.create(state.doc, decos)
          },
        },
      }),
    ]
  },
})

/** Comment-mark ids currently present in a document. */
function commentMarkIds(doc: ProseMirrorNode): Set<string> {
  const ids = new Set<string>()
  doc.descendants((node) => {
    node.marks.forEach((m) => {
      if (m.type.name === 'comment' && m.attrs.id) ids.add(m.attrs.id as string)
    })
  })
  return ids
}

/**
 * Plugin view.update hook: when a genuine edit removes a comment's mark — the
 * anchoring text was deleted — auto-resolve that thread in the store so it
 * leaves the open-thread count immediately and files under resolved, matching
 * the expectation that deleting the text "handles" the comment (#928). Without
 * this the store keeps the thread as open until the next reload (saveComments
 * writes IndexedDB only, never the live store), so the local count drifts above
 * the web's (which drops the row as lost). The resolve is also pushed to the
 * share, so the web viewer files the thread under Resolved rather than as an
 * unanchored "lost" thread; the pull never re-takes resolve state, so the
 * local resolve sticks either way.
 *
 * Guards mirror the persistence "never lose a thread to a transient strip"
 * invariant: skip while a restore is pending, and skip when every mark
 * vanished in a dispatch that was a programmatic content load (doc load or
 * source-mode toggle strip them all before the restore re-applies them).
 * `contentLoad` comes from the plugin's per-dispatch flag; user edits —
 * including deleting the last comment's text — never set it (#933).
 *
 * An AI replacement (`aiReplacement`, from AI_REPLACEMENT_META) is not the
 * writer's intent: the thread stays open, flagged anchorLost so persistence
 * keeps it, and nothing is pushed — the share has no unresolve, so a resolve
 * pushed here could never be taken back (#1099). Restore re-anchors it on a
 * later load if its text survived; an undo brings the mark straight back, and
 * the flag is cleared as soon as it does.
 */
function autoResolveDeletedComments(
  view: EditorView,
  prevState: EditorState,
  contentLoad: boolean,
  aiReplacement: boolean
): void {
  if (view.state.doc === prevState.doc) return
  const store = useCommentStore.getState()
  if (store.needsRestore) return
  const prevIds = commentMarkIds(prevState.doc)
  const anyLost = store.pendingComments.some((c) => c.anchorLost === true)
  if (prevIds.size === 0 && !anyLost) return
  const currIds = commentMarkIds(view.state.doc)
  // All marks gone at once: a content load's transient strip (skip), or the
  // user deleting the text of the only remaining comment (resolve it).
  if (currIds.size === 0 && contentLoad) return
  const removedOpen = store.pendingComments.filter(
    (c) => !c.resolved && prevIds.has(c.id) && !currIds.has(c.id)
  )
  // A live mark means the anchor exists again (an undo of the replacement).
  const reanchored = store.pendingComments.filter(
    (c) => c.anchorLost === true && currIds.has(c.id)
  )
  if (removedOpen.length === 0 && reanchored.length === 0) return
  const removedIds = new Set(removedOpen.map((c) => c.id))
  const reanchoredIds = new Set(reanchored.map((c) => c.id))
  const updated = store.pendingComments.map((c) => {
    if (removedIds.has(c.id)) return aiReplacement ? { ...c, anchorLost: true } : { ...c, resolved: true }
    if (reanchoredIds.has(c.id)) return { ...c, anchorLost: false }
    return c
  })
  useCommentStore.setState({ pendingComments: updated })
  if (store.documentId) void store.saveComments(store.documentId, updated)
  if (aiReplacement) return
  // Resolve on the share too, so the web viewer files the thread under
  // Resolved rather than as an unanchored open thread.
  removedOpen.forEach((c) => pushResolveToShare(c.id))
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
export function getComments(editor: { state: { doc: { descendants: (fn: (node: { marks: Array<{ type: { name: string }; attrs: { id: string; comment: string; createdAt: number } }>; nodeSize: number; textContent: string }, pos: number) => void) => void; textBetween: (from: number, to: number, blockSeparator?: string) => string; textContent: string } } }): CommentData[] {
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
 * persisted store entries (replies + resolved state, which the marks don't
 * carry) into the canonical shape to persist.
 *
 * - Live marks win for position/markedText/occurrenceIndex.
 * - Stored entries contribute replies + resolved + author (the mark doesn't
 *   carry author, so it must be re-grafted from the store or it resets to user).
 * - Resolved threads have no mark (restoreComments skips them), so they're
 *   appended from the store as history-only entries.
 *
 * This is the persistence-shaped sibling of executeListComments' tool-facing
 * merge — keep the two in step. Saving raw getComments() instead of this is the
 * bug that drops replies/resolved on every tab-switch save.
 */
export function mergeCommentsForPersistence(
  editor: Parameters<typeof getComments>[0],
  stored: CommentData[]
): CommentData[] {
  const liveMarks = getComments(editor)

  // Safety net against transient data loss: if the document currently has NO
  // live comment marks but the store still holds unresolved threads, the marks
  // were stripped transiently (a document load or source-mode toggle fires
  // setContent before the restore re-applies them) — NOT deleted. A tab-switch
  // save landing in that window would otherwise drop every unresolved thread
  // (they'd survive the merge only as live marks). Return the stored set
  // unchanged so the threads can't be lost; the next save with marks present
  // re-syncs positions. (Mirrors the suggestion save's "never persist empty".)
  if (liveMarks.length === 0 && stored.some((c) => !c.resolved)) {
    return stored
  }

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

  // Resolved (markless) threads survive only in the store — keep them.
  const resolvedOnly = stored.filter((c) => c.resolved && !liveIds.has(c.id))

  // Anchor-lost threads (#769) are markless but must never be dropped: the
  // reviewer's comment outlives the text it pointed at. restoreComments owns
  // the flag; unresolved markless threads WITHOUT it keep today's semantics
  // (a mark deleted with its text mid-session deletes the thread) — EXCEPT
  // share-sourced threads (shareId), which always survive as anchor-lost:
  // a reviewer's comment must never silently vanish because of local edits
  // or an overlap anomaly (#857).
  const lostOnly = stored
    .filter((c) => !c.resolved && !liveIds.has(c.id) && (c.anchorLost === true || c.shareId))
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
