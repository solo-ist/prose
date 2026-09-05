/**
 * Comment Review mode — the comment counterpart to Quick Review.
 *
 * Sequential, in-depth triage of OPEN comment threads, mirroring
 * QuickReviewPanel: a subheader (title + back-link + n/total + prev/next +
 * close), an action row above a draggable card, the same swipe-to-decide
 * gesture, the same keyboard model, and the same scroll-the-mark-to-center
 * editor coupling. Where Quick Review does Accept/Reject on a suggestion,
 * comment Review does Resolve/Skip on a thread, with Process (AI) in the middle.
 *
 * A top-level review takeover (a peer of QuickReviewPanel, rendered by
 * ReviewContainer when reviewMode === 'comments'), not a child of the Activity
 * tab — so it and Quick Review share one mode slot and can toggle between each
 * other. Entered from the status-bar comment count, the "Review comments" chip,
 * or a card/popover expand icon; exits via Esc or the close button.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { X, ChevronLeft, ChevronRight, CheckCheck, Sparkles, ArrowRight, Send, Check } from 'lucide-react'
import { motion, useMotionValue, useTransform, type PanInfo } from 'framer-motion'
import { useEditorInstanceStore } from '../../stores/editorInstanceStore'
import { useCommentStore } from '../../extensions/comments/store'
import { getComments } from '../../extensions/comments'
import { scrollSelectionIntoCenter } from '../../lib/diffUtils'
import { useChat } from '../../hooks/useChat'
import { useAIConfigured } from '../../hooks/useAIConfigured'
import { aiUnavailableMessage } from '../../lib/llm'
import type { CommentReply } from '../../extensions/comments/types'
import { formatAge } from '../../types/annotations'
import { generateId } from '../../lib/persistence'
import { renderMarkdown } from '../chat/ChatMessage'
import { PROSE_ICONS, IconThumb } from '../../lib/prose-icons'
import { useSettingsStore } from '../../stores/settingsStore'
import { cn } from '../../lib/utils'

interface CommentReviewPanelProps {
  /** Exit Review mode and return to the Activity list. */
  onExit: () => void
  /** Open Review focused on this thread (from a card's expand icon); else start at 0. */
  initialThreadId?: string | null
}

const SWIPE_THRESHOLD = 90

export function CommentReviewPanel({ onExit, initialThreadId }: CommentReviewPanelProps) {
  const editor = useEditorInstanceStore((s) => s.editor)
  const pendingComments = useCommentStore((s) => s.pendingComments)
  const documentId = useCommentStore((s) => s.documentId)
  const saveComments = useCommentStore((s) => s.saveComments)
  const { processComment, isStreaming } = useChat()
  const ai = useAIConfigured()

  const [index, setIndex] = useState(0)
  const [draft, setDraft] = useState('')
  const [processingId, setProcessingId] = useState<string | null>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)

  // The review set: open (unresolved) threads, oldest first.
  const openThreads = useMemo(
    () => pendingComments.filter((c) => !c.resolved).slice().sort((a, b) => a.createdAt - b.createdAt),
    [pendingComments]
  )
  const total = openThreads.length
  const current = total > 0 ? openThreads[Math.min(index, total - 1)] : undefined

  // Jump to a specific thread when entered via a card's expand icon.
  useEffect(() => {
    if (!initialThreadId) return
    const i = openThreads.findIndex((c) => c.id === initialThreadId)
    if (i >= 0) setIndex(i)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialThreadId])

  // Clamp the index as the set shrinks (resolve removes a thread).
  useEffect(() => {
    if (index > total - 1) setIndex(Math.max(0, total - 1))
  }, [total, index])

  // Clear the thinking indicator when the AI stream finishes.
  useEffect(() => {
    if (!isStreaming) setProcessingId(null)
  }, [isStreaming])

  // Editor coupling: select + center the current thread's mark so the reviewer
  // sees the text in context (the selection highlight is the focus indicator).
  useEffect(() => {
    if (!editor || !current) return
    const live = getComments(editor).find((c) => c.id === current.id)
    if (live) {
      editor.commands.setTextSelection({ from: live.from, to: live.to })
      scrollSelectionIntoCenter(editor)
    }
    setDraft('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, current?.id])

  // Swipe: drag right past the threshold → Resolve; drag left → Skip.
  const dragX = useMotionValue(0)
  const cardRotate = useTransform(dragX, [-200, 0, 200], [-4, 0, 4])
  const skipGlow = useTransform(dragX, [-120, -40, 0], ['rgba(245,158,11,0.18)', 'rgba(245,158,11,0.07)', 'rgba(0,0,0,0)'])
  const resolveGlow = useTransform(dragX, [0, 40, 120], ['rgba(0,0,0,0)', 'rgba(16,185,129,0.07)', 'rgba(16,185,129,0.18)'])

  // Navigation wraps around the ends (last → first, first → last) so cycling
  // never dead-ends. (total <= 1 is a no-op.)
  const goNext = useCallback(() => setIndex((i) => (total > 0 ? (i + 1) % total : 0)), [total])
  const goPrev = useCallback(() => setIndex((i) => (total > 0 ? (i - 1 + total) % total : 0)), [total])

  const skip = useCallback(() => {
    setDraft('')
    setIndex((i) => (total > 0 ? (i + 1) % total : 0))
  }, [total])

  const resolve = useCallback(() => {
    if (!current) return
    const id = current.id
    const { pendingComments: cur } = useCommentStore.getState()
    const updated = cur.map((c) => (c.id === id ? { ...c, resolved: true } : c))
    useCommentStore.setState({ pendingComments: updated })
    if (documentId) saveComments(documentId, updated)
    editor?.commands.unsetComment(id)
    setDraft('')
    // The set shrinks; the next open thread slides into this index (clamped).
  }, [current, documentId, saveComments, editor])

  const runProcess = useCallback(() => {
    if (!current || !ai.available) return
    setProcessingId(current.id)
    processComment(current.id)
  }, [current, ai.available, processComment])

  const sendReply = useCallback(() => {
    const text = draft.trim()
    if (!text || !current) return
    const reply: CommentReply = { id: generateId(), author: 'user', text, createdAt: Date.now() }
    const { pendingComments: cur } = useCommentStore.getState()
    const updated = cur.map((c) => (c.id === current.id ? { ...c, replies: [...(c.replies ?? []), reply] } : c))
    useCommentStore.setState({ pendingComments: updated })
    if (documentId) saveComments(documentId, updated)
    setDraft('')
    composerRef.current?.focus()
  }, [draft, current, documentId, saveComments])

  const onDragEnd = useCallback(
    (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      if (info.offset.x > SWIPE_THRESHOLD) resolve()
      else if (info.offset.x < -SWIPE_THRESHOLD) skip()
    },
    [resolve, skip]
  )

  // Keyboard: ←/→ navigate, ↵ resolve, ⌘↵ send reply, Esc exit. Field-aware.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onExit()
        return
      }
      const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      if (inField) {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          sendReply()
        }
        return
      }
      // Typing in the document body (the TipTap contenteditable) must keep its
      // native keys: arrows move the caret and Enter inserts a newline — they
      // must not advance or resolve threads (#826). Thread shortcuts stay
      // active only while focus is outside the editor (panel, buttons, etc.).
      if (e.target instanceof HTMLElement && e.target.isContentEditable) return
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        goNext()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goPrev()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        resolve()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onExit, sendReply, goNext, goPrev, resolve])

  if (!current) return <DoneState onExit={onExit} />

  const replies = current.replies ?? []
  const quote = current.markedText?.trim()
  const isThinking = processingId === current.id && isStreaming

  return (
    <div className="flex h-full flex-col">
      {/* Subheader: title + back-link · n/total + prev/next · close */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border py-2.5 pl-4 pr-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h2 className="shrink-0 text-sm font-medium">Comment Review</h2>
        </div>
        <div className="flex shrink-0 items-center gap-0">
          <span className="mr-1.5 text-xs tabular-nums text-muted-foreground">
            {Math.min(index, total - 1) + 1}/{total}
          </span>
          <button
            onClick={goPrev}
            disabled={total <= 1}
            className="rounded p-1.5 transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="Previous thread"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={goNext}
            disabled={total <= 1}
            className="rounded p-1.5 transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="Next thread"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <button
          onClick={onExit}
          className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Close review (Esc)"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Action row: Skip · Process · Resolve (above the card) */}
      <div className="flex shrink-0 items-stretch gap-2 px-4 pb-2 pt-3">
        <motion.div style={{ backgroundColor: skipGlow }} className="flex-1 rounded-md border border-border">
          <button
            onClick={skip}
            disabled={total <= 1}
            className="flex h-full w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Skip (←/→)"
          >
            Skip
            <ArrowRight className="h-3.5 w-3.5 shrink-0" />
          </button>
        </motion.div>
        <button
          onClick={runProcess}
          disabled={!ai.available}
          title={!ai.available && ai.reason ? aiUnavailableMessage(ai.reason) : 'Process with AI'}
          className="flex items-center justify-center rounded-md border border-violet-500/40 px-2.5 py-2 text-violet-600 transition-colors hover:bg-violet-500/10 disabled:cursor-not-allowed disabled:opacity-40 dark:text-violet-400"
          aria-label="Process with AI"
        >
          <Sparkles className="h-3.5 w-3.5" />
        </button>
        <motion.div
          style={{ backgroundColor: resolveGlow }}
          className="flex-1 rounded-md border border-emerald-500/40"
        >
          <button
            onClick={resolve}
            className="flex h-full w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-500/10 dark:text-emerald-400"
            aria-label="Resolve (Enter)"
          >
            <CheckCheck className="h-3.5 w-3.5 shrink-0" />
            Resolve
          </button>
        </motion.div>
      </div>

      {/* Draggable thread card */}
      <div className="flex-1 overflow-hidden px-3.5 pb-2">
        <motion.div
          key={current.id}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.6}
          onDragEnd={onDragEnd}
          style={{ x: dragX, rotate: cardRotate }}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          className="flex h-full cursor-grab touch-none flex-col overflow-hidden rounded-xl border border-border bg-popover active:cursor-grabbing"
        >
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

            {/* Original comment — may be AI-authored (left via add_comment). */}
            <div className="px-4 pt-3.5 pb-1.5">
              <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/20 border-l-[3px] border-l-amber-500 bg-amber-500/[0.07] px-3 py-2.5">
                <ReviewAvatar kind={current.author === 'ai' ? 'ai' : 'user'} />
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex items-baseline gap-2">
                    <span className="text-xs font-semibold text-foreground">{current.author === 'ai' ? 'Prose' : 'You'}</span>
                    <span className="text-[11px] text-muted-foreground">{formatAge(current.createdAt)}</span>
                  </div>
                  {current.author === 'ai' ? (
                    <div className="prose-chat break-words text-[13px] leading-relaxed text-foreground/90">
                      {renderMarkdown(current.comment, editor)}
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground/90">
                      {current.comment}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Replies */}
            {replies.length > 0 && (
              <div className="px-4 pb-1.5 pt-0.5">
                {replies.map((r) => (
                  <ReviewReplyRow key={r.id} reply={r} editor={editor} />
                ))}
              </div>
            )}

            {/* Thinking */}
            {isThinking && (
              <div className="flex items-center gap-2.5 px-4 pb-3.5 pt-1.5">
                <ReviewAvatar kind="ai" />
                <span className="inline-flex items-center gap-1">
                  <Dot delay="0s" />
                  <Dot delay="0.18s" />
                  <Dot delay="0.36s" />
                </span>
                <span className="text-[12.5px] text-muted-foreground">Reading the thread…</span>
              </div>
            )}
          </div>

          {/* Composer (drag must not start here) */}
          <div
            className="shrink-0 border-t border-border px-4 py-3"
            onPointerDownCapture={(e) => e.stopPropagation()}
          >
            <div className="flex items-end gap-2 rounded-lg border border-input bg-background px-3 py-1.5 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
              <textarea
                ref={composerRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={1}
                placeholder="Reply to the thread…"
                className="max-h-[120px] flex-1 resize-none bg-transparent py-1 text-[13px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
              />
              <button
                onClick={sendReply}
                disabled={!draft.trim()}
                aria-label="Send reply (⌘↵)"
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                  draft.trim() ? 'bg-foreground text-background hover:bg-foreground/85' : 'cursor-default text-muted-foreground/50'
                )}
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Pinned hint footer */}
      <div className="shrink-0 select-none px-4 pb-3 pt-1 text-center text-[10px] leading-relaxed text-muted-foreground/40">
        swipe to resolve → <span className="mx-1">·</span> ↵ resolve <span className="mx-1">·</span> ←/→ navigate{' '}
        <span className="mx-1">·</span> ⌘↵ send reply
      </div>
    </div>
  )
}

// ─── Done state ─────────────────────────────────────────────────────────────

function DoneState({ onExit }: { onExit: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border py-2.5 pl-4 pr-2">
        <h2 className="text-sm font-medium">Review</h2>
        <button
          onClick={onExit}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Close review"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <span className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <Check className="h-7 w-7" />
        </span>
        <div className="text-sm font-medium text-foreground">All caught up</div>
        <p className="max-w-[230px] text-xs leading-relaxed text-muted-foreground">
          Every thread is resolved. Resolved threads stay in the Activity list — nothing was deleted.
        </p>
        <button
          onClick={onExit}
          className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          <ChevronLeft className="h-3 w-3" />
          Back to activity
        </button>
      </div>
    </div>
  )
}

// ─── Bits ───────────────────────────────────────────────────────────────────

function ReviewAvatar({ kind }: { kind: 'ai' | 'user' }) {
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
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-semibold text-muted-foreground"
    >
      Y
    </span>
  )
}

function ReviewReplyRow({ reply, editor }: { reply: CommentReply; editor: ReturnType<typeof useEditorInstanceStore.getState>['editor'] }) {
  const isAI = reply.author === 'ai'
  return (
    <div className="flex items-start gap-2.5 border-t border-border/50 py-2.5">
      <ReviewAvatar kind={isAI ? 'ai' : 'user'} />
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-baseline gap-2">
          <span className="text-xs font-semibold text-foreground">{isAI ? 'Prose' : 'You'}</span>
          <span className="text-[11px] text-muted-foreground">{formatAge(reply.createdAt)}</span>
        </div>
        {isAI ? (
          <div className="prose-chat break-words text-[13px] leading-relaxed text-foreground/85">
            {renderMarkdown(reply.text, editor)}
          </div>
        ) : (
          <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground/85">{reply.text}</div>
        )}
      </div>
    </div>
  )
}

function Dot({ delay }: { delay: string }) {
  return <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-500" style={{ animationDelay: delay }} />
}
