/**
 * Comment Mark Extension for TipTap
 *
 * Allows users to add comments to selected text.
 * Comments are instructions for AI to process.
 */

import { Mark, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { MarkSerializerSpec } from 'prosemirror-markdown'
import type { CommentOptions, CommentData } from './types'
import { useCommentStore } from './store'

const commentStatePluginKey = new PluginKey('commentState')

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
          const removedIds = new Set<string>()

          doc.descendants((node, pos) => {
            node.marks.forEach((mark) => {
              if (mark.type.name === this.name) {
                // If no ID specified, remove all; otherwise match ID
                if (!id || mark.attrs.id === id) {
                  tr.removeMark(pos, pos + node.nodeSize, mark.type)
                  removed = true

                  if (mark.attrs.id) removedIds.add(mark.attrs.id)
                }
              }
            })
          })

          if (removed) {
            dispatch(tr)
            // A single comment can span several text nodes (for example when
            // formatting splits the mark). Emit one lifecycle callback per
            // thread, after the transaction has been applied.
            if (this.options.onCommentRemoved) {
              removedIds.forEach((commentId) => this.options.onCommentRemoved?.(commentId))
            }
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

          for (const comment of comments) {
            // Resolved threads are stored but must not be re-marked in the
            // editor — they're history only.
            if (comment.resolved) continue

            const rawSearchText = comment.markedText
            if (!rawSearchText) {
              console.warn('[Comment] Cannot restore comment without markedText:', comment.id)
              continue
            }

            // Normalise the stored markedText to the same representation as
            // textContent (strip the space block-separators injected by
            // textBetween). Single-block comments are unaffected.
            const searchText = rawSearchText.replace(/ /g, '')

            // Walk occurrences of searchText and stop at the Nth one, where N
            // is comment.occurrenceIndex (default 0 for backward-compat).
            // We also search textContent with the normalised text.
            const docTextNorm = docText.replace(/ /g, '')
            const targetOccurrence = comment.occurrenceIndex ?? 0
            let currentOccurrence = 0
            let searchOffset = 0
            let normIndex = -1
            let foundTarget = false
            while (true) {
              const matchIdx = docTextNorm.indexOf(searchText, searchOffset)
              if (matchIdx === -1) break
              normIndex = matchIdx // track last found as fallback
              if (currentOccurrence === targetOccurrence) {
                foundTarget = true
                break
              }
              currentOccurrence++
              searchOffset = matchIdx + searchText.length
            }
            if (normIndex === -1) {
              console.warn('[Comment] Cannot find markedText in document:', {
                id: comment.id,
                markedText: rawSearchText.substring(0, 50)
              })
              continue
            }
            if (!foundTarget) {
              // Fewer occurrences than expected (text changed); fell back to last found
              console.warn('[Comment] occurrenceIndex out of range, using last occurrence:', {
                id: comment.id,
                targetOccurrence,
                usedOccurrence: currentOccurrence
              })
            }

            // Map the normalised char index back to a ProseMirror position by
            // walking text nodes and accumulating the char count without spaces
            // (matching the normalised search above).
            let normCount = 0
            let foundStart = -1
            let foundEnd = -1
            const normEnd = normIndex + searchText.length

            doc.descendants((node, nodePos) => {
              if (foundStart !== -1 && foundEnd !== -1) return false

              if (node.isText && node.text) {
                const nodeNorm = node.text.replace(/ /g, '')
                const nodeNormStart = normCount
                const nodeNormEnd = normCount + nodeNorm.length

                if (foundStart === -1 && normIndex >= nodeNormStart && normIndex < nodeNormEnd) {
                  // Offset within this text node in original chars.
                  // We need to map normIndex back to a char offset inside node.text.
                  const charOffset = mapNormOffsetToChar(node.text, normIndex - nodeNormStart)
                  foundStart = nodePos + charOffset
                }

                if (foundStart !== -1 && normEnd > nodeNormStart && normEnd <= nodeNormEnd) {
                  const charOffset = mapNormOffsetToChar(node.text, normEnd - nodeNormStart)
                  foundEnd = nodePos + charOffset
                  return false
                }

                normCount += nodeNorm.length
              }
            })

            if (foundStart === -1 || foundEnd === -1) {
              console.warn('[Comment] Could not map text position for comment:', comment.id)
              continue
            }

            const mark = schema.marks.comment.create({
              id: comment.id,
              comment: comment.comment,
              createdAt: comment.createdAt,
              occurrenceIndex: comment.occurrenceIndex ?? 0,
            })

            tr.addMark(foundStart, foundEnd, mark)
            restored++

            console.log('[Comment] Restored comment mark:', {
              id: comment.id,
              from: foundStart,
              to: foundEnd
            })
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
    return [
      new Plugin({
        key: commentStatePluginKey,
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
          return { destroy: unsubscribe }
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
    return s ? { ...m, replies: s.replies ?? [], resolved: s.resolved ?? false, author: s.author ?? 'user' } : m
  })

  // Resolved (markless) threads survive only in the store — keep them.
  const resolvedOnly = stored.filter((c) => c.resolved && !liveIds.has(c.id))

  return [...merged, ...resolvedOnly]
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

export default Comment
