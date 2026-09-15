/**
 * Comment Popover — thread view for an existing comment.
 *
 * Redesigned per the Claude Design "Comment Threads" project: an anchored card
 * with a state-aware header (open / pending / resolved), the quoted text it's
 * anchored to, the original comment, a reply thread with avatars, an inline
 * composer, a "thinking" indicator while the AI processes the thread, and a
 * footer of actions (Process / Resolve / Reopen / Delete).
 *
 * Colors map to Prose's theme tokens (works in dark + light): amber = comment
 * accent, violet = AI, emerald = resolved, pink = pending.
 *
 * Positioning constrains the card's height to the space available at the chosen
 * placement (below the mark, or above when there's more room), so a long thread
 * scrolls inside the body while the header/anchor pin to the top and the
 * composer/footer pin to the bottom — the whole card always fits the viewport.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/core'
import { Trash2, X, Sparkles, CheckCheck, Send, User, MessageSquare, RotateCcw, Maximize2 } from 'lucide-react'
import { useChat } from '../hooks/useChat'
import { useAIConfigured } from '../hooks/useAIConfigured'
import { aiUnavailableMessage } from '../lib/llm'
import { useCommentStore } from '../extensions/comments/store'
import type { CommentData, CommentReply } from '../extensions/comments/types'
import { formatAge } from '../types/annotations'
import { generateId } from '../lib/persistence'
import { pushReplyToShare, pushResolveToShare } from '../lib/sharePush'
import { renderMarkdown } from './chat/ChatMessage'
import { OPEN_COMMENT_EVENT, requestCommentReview } from './editor/AIEditsHistoryPanel'
import { PROSE_ICONS, IconThumb } from '../lib/prose-icons'
import { useSettingsStore } from '../stores/settingsStore'
import { useReviewMode } from '../stores/reviewStore'
import { cn } from '../lib/utils'

const NAV_BAR_HEIGHT = 48
const VIEWPORT_PADDING = 16
const POPOVER_WIDTH = 384
const GAP = 8

interface CommentPopoverProps {
  editor: Editor
}

interface AnchorRect {
  top: number
  bottom: number
  left: number
}

interface PopoverState {
  isOpen: boolean
  commentId: string | null
  commentText: string
  anchor: AnchorRect
}

export function CommentPopover({ editor }: CommentPopoverProps) {
  const [popover, setPopover] = useState<PopoverState>({
    isOpen: false,
    commentId: null,
    commentText: '',
    anchor: { top: 0, bottom: 0, left: 0 },
  })
  const [replyText, setReplyText] = useState('')
  // Local: which comment we kicked off Process for, and whether the resolved
  // thread is expanded. Both reset when the popover opens on a new comment.
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [showResolvedThread, setShowResolvedThread] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const replyInputRef = useRef<HTMLTextAreaElement>(null)
  const { processComment, isStreaming } = useChat()
  const ai = useAIConfigured()
  // When Comment Review is already open, the popover's "Open in Review" expand
  // is a no-op — grey it out.
  const inCommentReview = useReviewMode() === 'comments'

  // Get persisted comment data (replies + resolved state)
  const pendingComments = useCommentStore((s) => s.pendingComments)
  const documentId = useCommentStore((s) => s.documentId)
  const saveComments = useCommentStore((s) => s.saveComments)

  const currentComment: CommentData | undefined = popover.commentId
    ? pendingComments.find((c) => c.id === popover.commentId)
    : undefined

  // Clear the "thinking" indicator once the AI stream finishes; the reply it
  // produced lands in the store and renders in the thread above the composer.
  useEffect(() => {
    if (!isStreaming) setProcessingId(null)
  }, [isStreaming])

  // Open the popover anchored to a comment mark. The card then follows the mark
  // as the user scrolls (see the scroll effect below). `scrollIntoView` is used
  // by the Activity "Open in document" path to bring an off-screen mark into the
  // pane first; a direct click anchors in place (no jump).
  const openForMark = useCallback(
    (id: string, markEl: HTMLElement, opts?: { scrollIntoView?: boolean }) => {
      if (opts?.scrollIntoView) {
        const scroller = editor.view.dom.closest('.overflow-auto') as HTMLElement | null
        if (scroller) {
          const sr = scroller.getBoundingClientRect()
          const mr = markEl.getBoundingClientRect()
          const delta = mr.top - (sr.top + 96)
          if (Math.abs(delta) > 4) scroller.scrollTop += delta
        } else {
          markEl.scrollIntoView({ block: 'center' })
        }
      }
      const rect = markEl.getBoundingClientRect()
      setPopover({
        isOpen: true,
        commentId: id,
        commentText: markEl.getAttribute('data-comment') || '',
        anchor: { top: rect.top, bottom: rect.bottom, left: rect.left },
      })
      setReplyText('')
      setShowResolvedThread(false)
    },
    [editor]
  )

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      const mark = target.closest('.comment-mark') as HTMLElement | null
      if (mark) {
        event.preventDefault()
        event.stopPropagation()

        const id = mark.getAttribute('data-comment-id')
        if (!id) {
          // Malformed mark — the Comment extension's renderHTML drops the
          // attribute when attrs.id is falsy. Warn loudly so the source of
          // the bad mark is debuggable, but don't silently swallow the click.
          console.warn('[CommentPopover] comment-mark clicked with no data-comment-id', mark)
          return
        }
        openForMark(id, mark)
        return
      }

      if (popoverRef.current && !popoverRef.current.contains(target)) {
        setPopover((prev) => ({ ...prev, isOpen: false }))
      }
    }

    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [openForMark])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && popover.isOpen) {
        setPopover((prev) => ({ ...prev, isOpen: false }))
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [popover.isOpen])

  // "Open in document" from the Activity panel: scroll the thread's mark to
  // center and open the popover anchored to it.
  useEffect(() => {
    const handler = (event: Event) => {
      const id = (event as CustomEvent<{ id: string }>).detail?.id
      if (!id) return
      const mark = document.querySelector(`.comment-mark[data-comment-id="${id}"]`) as HTMLElement | null
      if (!mark) return
      openForMark(id, mark, { scrollIntoView: true })
    }
    window.addEventListener(OPEN_COMMENT_EVENT, handler)
    return () => window.removeEventListener(OPEN_COMMENT_EVENT, handler)
  }, [openForMark])

  // Follow the marked text as the user scrolls or resizes: re-read the mark's
  // live position and update the anchor so the card stays pinned to its text
  // (and hides when the text scrolls out of view — see markVisible in render).
  useEffect(() => {
    if (!popover.isOpen || !popover.commentId) return
    const id = popover.commentId
    let raf = 0
    const reposition = () => {
      raf = 0
      const mark = document.querySelector(`.comment-mark[data-comment-id="${id}"]`) as HTMLElement | null
      if (!mark) return // resolved threads have no mark — leave the card put
      const mr = mark.getBoundingClientRect()
      // Project where the card will sit for the mark's new position (mirrors the
      // render placement), then close it for good once it's fully off either
      // edge — so it rides off naturally and doesn't pop back in on scroll-back.
      const vh = window.innerHeight
      const scroller = editor.view.dom.closest('.overflow-auto') as HTMLElement | null
      const minTop = scroller ? scroller.getBoundingClientRect().top : NAV_BAR_HEIGHT + VIEWPORT_PADDING
      const popH = popoverRef.current?.offsetHeight ?? 0
      const spaceBelow = vh - mr.bottom - GAP - VIEWPORT_PADDING
      const spaceAbove = mr.top - GAP - minTop
      const below = spaceBelow >= 240 || spaceBelow >= spaceAbove
      const projTop = below ? mr.bottom + GAP : mr.top - GAP - popH
      // Close for good once the card is fully above the pane top (clipped under
      // the chrome) or below the viewport — it rides off, then stays gone.
      if (projTop + popH <= minTop || projTop >= vh) {
        setPopover((prev) => (prev.commentId === id ? { ...prev, isOpen: false } : prev))
        return
      }
      setPopover((prev) =>
        prev.isOpen && prev.commentId === id
          ? { ...prev, anchor: { top: mr.top, bottom: mr.bottom, left: mr.left } }
          : prev
      )
    }
    const onChange = () => {
      if (!raf) raf = requestAnimationFrame(reposition)
    }
    // Capture phase catches scroll from the inner editor scroller (scroll events
    // don't bubble, but they do propagate in capture from window down).
    window.addEventListener('scroll', onChange, true)
    window.addEventListener('resize', onChange)
    return () => {
      window.removeEventListener('scroll', onChange, true)
      window.removeEventListener('resize', onChange)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [popover.isOpen, popover.commentId])

  const handleRemove = useCallback(() => {
    if (!popover.commentId) return
    const id = popover.commentId
    // Remove the editor mark and drop the persisted record entirely.
    editor.commands.unsetComment(id)
    const { pendingComments: current } = useCommentStore.getState()
    const updated = current.filter((c) => c.id !== id)
    useCommentStore.setState({ pendingComments: updated })
    if (documentId) saveComments(documentId, updated)
    setPopover((prev) => ({ ...prev, isOpen: false }))
  }, [editor, popover.commentId, documentId, saveComments])

  const handleResolve = useCallback(() => {
    if (!popover.commentId) return
    const id = popover.commentId
    // Mark resolved:true in the store (thread persists as history),
    // then remove the editor mark so the highlight disappears.
    const { pendingComments: current } = useCommentStore.getState()
    const updated = current.map((c) => c.id === id ? { ...c, resolved: true } : c)
    useCommentStore.setState({ pendingComments: updated })
    if (documentId) saveComments(documentId, updated)
    editor.commands.unsetComment(id)
    setShowResolvedThread(false)
    pushResolveToShare(id)
  }, [editor, popover.commentId, documentId, saveComments])

  const handleReopen = useCallback(() => {
    if (!popover.commentId) return
    const id = popover.commentId
    const { pendingComments: current } = useCommentStore.getState()
    const updated = current.map((c) => c.id === id ? { ...c, resolved: false } : c)
    useCommentStore.setState({ pendingComments: updated })
    if (documentId) saveComments(documentId, updated)
    // Re-anchor the editor mark that resolving removed, so the highlight returns.
    const thread = updated.find((c) => c.id === id)
    if (thread) editor.commands.restoreComments([thread])
    pushResolveToShare(id)
  }, [editor, popover.commentId, documentId, saveComments])

  const handleProcess = useCallback(() => {
    if (!popover.commentId || !ai.available) return
    // Keep the popover open and show the thinking indicator while the AI works.
    setProcessingId(popover.commentId)
    processComment(popover.commentId)
  }, [popover.commentId, ai.available, processComment])

  const handleClose = useCallback(() => {
    setPopover((prev) => ({ ...prev, isOpen: false }))
  }, [])

  // Open this thread in Review mode (ChatPanel listens for the event), and
  // close the popover so the two surfaces don't overlap.
  const handleReview = useCallback(() => {
    if (!popover.commentId) return
    requestCommentReview(popover.commentId)
    setPopover((prev) => ({ ...prev, isOpen: false }))
  }, [popover.commentId])

  // Add a user reply to the thread
  const handleAddReply = useCallback(() => {
    const text = replyText.trim()
    if (!text || !popover.commentId) return
    const id = popover.commentId
    const reply: CommentReply = {
      id: generateId(),
      author: 'user',
      text,
      createdAt: Date.now(),
    }
    const { pendingComments: current } = useCommentStore.getState()
    const updated = current.map((c) =>
      c.id === id ? { ...c, replies: [...(c.replies ?? []), reply] } : c
    )
    useCommentStore.setState({ pendingComments: updated })
    if (documentId) saveComments(documentId, updated)
    setReplyText('')
    replyInputRef.current?.focus()
    pushReplyToShare(id, reply.id)
  }, [replyText, popover.commentId, documentId, saveComments])

  const handleReplyKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleAddReply()
      }
    },
    [handleAddReply]
  )

  if (!popover.isOpen) return null

  const replies = currentComment?.replies ?? []
  const isResolved = currentComment?.resolved === true
  const isPending = !isResolved && replies.length === 0
  const quote = currentComment?.markedText?.trim()
  const commentText = currentComment?.comment || popover.commentText
  const commentAge = currentComment?.createdAt ? formatAge(currentComment.createdAt) : ''
  // The top-level comment can be AI-authored (left via add_comment) — render it
  // under the Prose identity, like a reply, instead of "You".
  const commentIsAI = currentComment?.author === 'ai'
  const isThinking = processingId !== null && processingId === popover.commentId && isStreaming
  // Resolved threads collapse their reply list until the user expands it.
  const repliesVisible = !isResolved || showResolvedThread

  // Placement: prefer below the mark; flip above when there's more room there.
  // maxHeight is clamped to the space available at the chosen side, so the card
  // never runs off-screen — the body scrolls inside it instead.
  const a = popover.anchor
  // Clip boundary = the real top of the editor scroll pane (right below the
  // toolbar/tabs), so the card tucks under the chrome with no gap. Falls back to
  // a nav-bar estimate if the scroller isn't found.
  const paneScroller = editor.view.dom.closest('.overflow-auto') as HTMLElement | null
  const minTop = paneScroller
    ? Math.round(paneScroller.getBoundingClientRect().top)
    : NAV_BAR_HEIGHT + VIEWPORT_PADDING
  const vw = window.innerWidth
  const vh = window.innerHeight
  const spaceBelow = vh - a.bottom - GAP - VIEWPORT_PADDING
  const spaceAbove = a.top - GAP - minTop
  const placeBelow = spaceBelow >= 240 || spaceBelow >= spaceAbove
  // Cap to a focused card (~58% of the viewport) so the popover reads as pinned
  // to the text rather than a panel covering the page; long threads scroll the
  // body. openForMark scrolls the mark near the top, so there's room either way.
  const sideSpace = Math.round(placeBelow ? spaceBelow : spaceAbove)
  const maxHeight = Math.max(190, Math.min(sideSpace, Math.round(vh * 0.58)))
  // Left-anchor to the start of the marked text (clamped on-screen) so the card
  // visibly connects to where the highlight begins, like a margin note.
  const left = Math.min(Math.max(a.left, VIEWPORT_PADDING), vw - VIEWPORT_PADDING - POPOVER_WIDTH)
  // Positions are relative to a clipping wrapper that starts at the editor pane
  // top (minTop, below the toolbar/tabs): top is offset by minTop; bottom is
  // measured from the viewport bottom (the wrapper's bottom). The wrapper's
  // overflow:hidden clips the card at the pane top so it slides *under* the
  // chrome instead of floating over the tabs.
  const vertical: React.CSSProperties = placeBelow
    ? { top: Math.round(a.bottom + GAP - minTop) }
    : { bottom: Math.round(vh - a.top + GAP) }

  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 overflow-hidden"
      style={{ top: minTop }}
    >
    <div
      ref={popoverRef}
      data-comment-popover
      className="pointer-events-auto absolute flex flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl"
      style={{
        left,
        width: POPOVER_WIDTH,
        maxHeight,
        ...vertical,
      }}
    >
      {/* Header — state-aware (pinned) */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        {isResolved ? (
          <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            <CheckCheck className="h-3.5 w-3.5" />
            Resolved
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground/80">
              <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
              Comment thread
            </div>
            {isPending && (
              <span className="inline-flex items-center gap-1 rounded-md bg-pink-500/12 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-pink-600 dark:text-pink-400">
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                Awaiting reply
              </span>
            )}
          </div>
        )}
        <div className="flex items-center gap-0.5">
          {!isResolved && (
            <button
              onClick={handleReview}
              disabled={inCommentReview}
              aria-label="Open in Review"
              title={inCommentReview ? 'Already in Review' : 'Open in Review'}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-violet-600 disabled:pointer-events-none disabled:opacity-40 dark:hover:text-violet-400"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={handleClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Body — scrollable. Includes the anchor quote so a long thread (or a long
          quote) scrolls as one, instead of the quote pinning fixed space and
          squeezing the comment. Only the header + composer + footer stay pinned. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Anchor quote */}
        {quote && (
          <div className="border-b border-border bg-muted/40 px-4 py-2.5">
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Commenting on
            </div>
            <div className="border-l-2 border-amber-500 pl-2.5 text-[12.5px] italic leading-relaxed text-foreground/70">
              {quote}
            </div>
          </div>
        )}
        {/* Original comment (topic) */}
        <div className="px-4 pt-3.5 pb-1.5">
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/20 border-l-[3px] border-l-amber-500 bg-amber-500/[0.07] px-3 py-2.5">
            <Avatar kind={commentIsAI ? 'ai' : 'user'} />
            <div className="min-w-0 flex-1">
              <div className="mb-0.5 flex items-baseline gap-2">
                <span className="text-xs font-semibold text-foreground">
                  {commentIsAI
                    ? 'Prose'
                    : currentComment?.authorName || (currentComment?.shareId ? 'Reviewer' : 'You')}
                </span>
                {commentAge && <span className="text-[11px] text-muted-foreground">{commentAge}</span>}
              </div>
              {commentIsAI ? (
                <div className="prose-chat break-words text-[13px] leading-relaxed text-foreground/90">
                  {renderMarkdown(commentText, editor)}
                </div>
              ) : (
                <div className="text-[13px] leading-relaxed text-foreground/90 break-words whitespace-pre-wrap">{commentText}</div>
              )}
            </div>
          </div>
        </div>

        {/* Replies */}
        {repliesVisible && replies.length > 0 && (
          <div className="px-4 pb-1.5 pt-0.5">
            {replies.map((reply) => (
              <ReplyRow key={reply.id} reply={reply} editor={editor} />
            ))}
            {isResolved && (
              <button
                onClick={() => setShowResolvedThread(false)}
                className="mt-1 py-1 text-[11.5px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                Hide thread
              </button>
            )}
          </div>
        )}

        {/* Collapsed resolved summary */}
        {isResolved && !showResolvedThread && replies.length > 0 && (
          <div className="flex items-center gap-2.5 px-4 pb-3.5 pt-1">
            <span className="text-[11.5px] text-muted-foreground">
              {replies.length} {replies.length === 1 ? 'reply' : 'replies'} in this thread
            </span>
            <button
              onClick={() => setShowResolvedThread(true)}
              className="text-[11.5px] font-medium text-foreground underline underline-offset-2"
            >
              Show thread
            </button>
          </div>
        )}

        {/* Thinking indicator */}
        {isThinking && (
          <div className="flex items-center gap-2.5 px-4 pb-3.5 pt-1.5">
            <Avatar kind="ai" />
            <span className="inline-flex items-center gap-1">
              <Dot delay="0s" />
              <Dot delay="0.18s" />
              <Dot delay="0.36s" />
            </span>
            <span className="text-[12.5px] text-muted-foreground">Reading the thread…</span>
          </div>
        )}
      </div>

      {/* Composer — open threads only (pinned) */}
      {!isResolved && (
        <div className="shrink-0 border-t border-border px-4 py-3">
          <div className="flex items-end gap-2 rounded-lg border border-input bg-background px-3 py-1.5 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
            <textarea
              ref={replyInputRef}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={handleReplyKeyDown}
              rows={1}
              placeholder="Reply to the thread…"
              className="max-h-[120px] flex-1 resize-none bg-transparent py-1 text-[13px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
            />
            <button
              onClick={handleAddReply}
              disabled={!replyText.trim()}
              aria-label="Send reply"
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                replyText.trim()
                  ? 'bg-foreground text-background hover:bg-foreground/85'
                  : 'cursor-default text-muted-foreground/50'
              )}
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-1.5 pl-0.5 text-[11px] text-muted-foreground">
            Enter to send · Shift+Enter for a new line
          </div>
        </div>
      )}

      {/* Footer actions (pinned) */}
      {!isResolved ? (
        <div className="flex shrink-0 items-center gap-2 border-t border-border bg-muted/40 px-4 py-2.5">
          <button
            onClick={handleProcess}
            disabled={!ai.available}
            title={!ai.available && ai.reason ? aiUnavailableMessage(ai.reason) : undefined}
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Process
          </button>
          <button
            onClick={handleResolve}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-[12.5px] font-medium text-foreground transition-colors hover:bg-accent"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Resolve
          </button>
          <button
            onClick={handleRemove}
            title="Delete thread"
            aria-label="Delete thread"
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-2 border-t border-border bg-emerald-500/[0.06] px-4 py-2.5">
          <button
            onClick={handleReopen}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-[12.5px] font-medium text-foreground transition-colors hover:bg-accent"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reopen
          </button>
          <span className="text-[11.5px] text-emerald-700 dark:text-emerald-400/80">Thread kept, collapsed.</span>
          <button
            onClick={handleRemove}
            title="Delete thread"
            aria-label="Delete thread"
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {!ai.available && ai.reason && !isResolved && (
        <div className="shrink-0 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          {aiUnavailableMessage(ai.reason)}
        </div>
      )}
    </div>
    </div>,
    document.body
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function Avatar({ kind }: { kind: 'ai' | 'user' }) {
  // AI avatar mirrors the chat agent: the selected Prose app icon (the pilcrow
  // by default), updating live when the user changes it.
  const iconId = useSettingsStore((s) => s.settings.appearance.icon)
  if (kind === 'ai') {
    const selected = PROSE_ICONS.find((i) => i.id === iconId) ?? PROSE_ICONS[0]
    return (
      <span aria-label="Prose" className="shrink-0">
        <IconThumb Component={selected.Component} size={24} />
      </span>
    )
  }
  return (
    <span
      aria-label="You"
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
    >
      <User className="h-3 w-3" />
    </span>
  )
}

function ReplyRow({ reply, editor }: { reply: CommentReply; editor: Editor }) {
  const isAI = reply.author === 'ai'
  return (
    <div className="flex items-start gap-2.5 border-t border-border/50 py-2.5">
      <Avatar kind={isAI ? 'ai' : 'user'} />
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-baseline gap-2">
          <span className="text-xs font-semibold text-foreground">{isAI ? 'Prose' : reply.authorName || 'You'}</span>
          <span className="text-[11px] text-muted-foreground">{formatAge(reply.createdAt)}</span>
        </div>
        {/* AI replies are markdown (rendered like chat); user replies stay literal. */}
        {isAI ? (
          <div className="prose-chat break-words text-[13px] leading-relaxed text-foreground/85">
            {renderMarkdown(reply.text, editor)}
          </div>
        ) : (
          <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground/85">
            {reply.text}
          </div>
        )}
      </div>
    </div>
  )
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-500"
      style={{ animationDelay: delay }}
    />
  )
}
