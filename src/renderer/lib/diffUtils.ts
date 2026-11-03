/**
 * Shared word-level diff utilities and editor scroll helpers.
 *
 * Used by the ai-suggestions extension, the review panels
 * (Quick Review / Side-by-side), and the editor tool executors.
 */

import type { EditorState } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import type { AnnotationInput } from '../extensions/ai-annotations/transactions'
import type { AnnotationType } from '../types/annotations'

/**
 * Scroll the editor so the current selection is centered in the viewport.
 * Matches the behavior of FindBar's search result scrolling.
 */
export function scrollSelectionIntoCenter(editor: { state: EditorState; view: EditorView }): void {
  const { from } = editor.state.selection
  const coords = editor.view.coordsAtPos(from)
  const editorElement = editor.view.dom.closest('.overflow-auto')
  if (editorElement && coords) {
    const rect = editorElement.getBoundingClientRect()
    editorElement.scrollTo({
      top: editorElement.scrollTop + coords.top - rect.top - rect.height / 2,
      behavior: 'smooth',
    })
  }
}

export interface DiffSegment {
  text: string
  type: 'unchanged' | 'removed' | 'added'
}

/**
 * Compute word-level diff between two strings using LCS (Longest Common Subsequence).
 * LCS runs on words only (whitespace excluded) to prevent identical space tokens
 * from dominating the subsequence and hiding word-level reordering.
 * Returns arrays of segments with change types for both old and new text.
 */
export function computeWordDiff(original: string, suggested: string): { old: DiffSegment[]; new: DiffSegment[] } {
  // Split into alternating [word, space, word, space, ...] tokens, preserving whitespace
  const oldTokens = original.split(/(\s+)/).filter(t => t)
  const newTokens = suggested.split(/(\s+)/).filter(t => t)

  // Extract only non-whitespace (word) tokens for LCS
  const oldWords = oldTokens.filter(t => t.trim())
  const newWords = newTokens.filter(t => t.trim())

  // Compute LCS table on words only
  const m = oldWords.length
  const n = newWords.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldWords[i - 1] === newWords[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // Backtrack to find LCS (push + reverse to avoid O(n²) unshift)
  const lcs: string[] = []
  let i = m, j = n
  while (i > 0 && j > 0) {
    if (oldWords[i - 1] === newWords[j - 1]) {
      lcs.push(oldWords[i - 1])
      i--
      j--
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--
    } else {
      j--
    }
  }
  lcs.reverse()

  // Walk old tokens against LCS to build old segments (whitespace always unchanged)
  const oldSegments: DiffSegment[] = []
  let li = 0
  for (const token of oldTokens) {
    if (!token.trim()) {
      oldSegments.push({ text: token, type: 'unchanged' })
    } else if (li < lcs.length && token === lcs[li]) {
      oldSegments.push({ text: token, type: 'unchanged' })
      li++
    } else {
      oldSegments.push({ text: token, type: 'removed' })
    }
  }

  // Walk new tokens against LCS to build new segments (whitespace always unchanged)
  const newSegments: DiffSegment[] = []
  li = 0
  for (const token of newTokens) {
    if (!token.trim()) {
      newSegments.push({ text: token, type: 'unchanged' })
    } else if (li < lcs.length && token === lcs[li]) {
      newSegments.push({ text: token, type: 'unchanged' })
      li++
    } else {
      newSegments.push({ text: token, type: 'added' })
    }
  }

  return { old: oldSegments, new: newSegments }
}

/**
 * Compute, for each unchanged word in a word diff, its character-offset range in
 * both the original and new text.  Used to remap prior annotations that covered an
 * unchanged word into the coordinate space of the freshly-written text.
 *
 * Returns a parallel list of { oldFrom, oldTo, newFrom, newTo } ranges (all
 * relative to the start of their respective strings, not absolute PM positions).
 */
export function computeUnchangedWordRanges(
  originalText: string,
  newText: string
): Array<{ oldFrom: number; oldTo: number; newFrom: number; newTo: number }> {
  const diff = computeWordDiff(originalText, newText)
  const result: Array<{ oldFrom: number; oldTo: number; newFrom: number; newTo: number }> = []

  // Walk old segments to build a map: unchanged word text → old offset ranges
  // (keyed by word so we can look up the corresponding new offset below)
  const oldOffsets: Array<{ text: string; from: number; to: number; type: string }> = []
  let oldOff = 0
  for (const seg of diff.old) {
    oldOffsets.push({ text: seg.text, from: oldOff, to: oldOff + seg.text.length, type: seg.type })
    oldOff += seg.text.length
  }

  // Walk new segments; for every unchanged word find its paired old segment
  let oldUnchangedIdx = 0
  let newOff = 0
  for (const seg of diff.new) {
    const segEnd = newOff + seg.text.length
    if (seg.type === 'unchanged' && seg.text.trim()) {
      // Advance to the next unchanged word in old
      while (oldUnchangedIdx < oldOffsets.length && (oldOffsets[oldUnchangedIdx].type !== 'unchanged' || !oldOffsets[oldUnchangedIdx].text.trim())) {
        oldUnchangedIdx++
      }
      if (oldUnchangedIdx < oldOffsets.length) {
        const old = oldOffsets[oldUnchangedIdx]
        result.push({ oldFrom: old.from, oldTo: old.to, newFrom: newOff, newTo: segEnd })
        oldUnchangedIdx++
      }
    }
    newOff = segEnd
  }

  return result
}

/**
 * Create word-level AI annotations for a text replacement.
 * Uses computeWordDiff to annotate only the changed words instead of the entire range.
 * Falls back to a single full-range annotation for multi-paragraph replacements
 * (PM positions diverge from string offsets across paragraph boundaries).
 *
 * `priorAnnotations` — optional snapshot of annotations that existed on the node
 * before the edit (captured before ProseMirror's position mapping invalidated them).
 * Unchanged words whose prior annotation is found here will have that annotation
 * preserved at its remapped absolute position, so a neighbour word's provenance mark
 * survives a single-word edit without being clobbered.
 */
export function buildWordDiffAnnotations(params: {
  originalText: string
  newText: string
  rangeFrom: number
  rangeTo: number
  provenance: { model: string; conversationId: string; messageId: string }
  explanation?: string
  priorAnnotations?: readonly import('../types/annotations').AIAnnotation[]
}): AnnotationInput[] {
  const { originalText, newText, rangeFrom, rangeTo, provenance, explanation } = params
  const annotationType: AnnotationType = originalText.trim() === '' ? 'insertion' : 'replacement'
  const out: AnnotationInput[] = []

  // Multi-paragraph: fall back to full-range annotation (no word-level remap)
  if (newText.includes('\n')) {
    out.push({ type: annotationType, from: rangeFrom, to: rangeTo, content: newText, provenance, explanation })
    return out
  }

  const diff = computeWordDiff(originalText, newText)

  // --- Carry prior annotations over on their unchanged words ---
  // Prior annotations were captured before the replace; ProseMirror's position
  // mapping detaches every record inside the replaced range. Each prior comes
  // back on the words of it that survived, in new-text offsets: adjacent
  // surviving words (whitespace between them) form one run, the first run
  // keeps the prior's id and time so the record moves rather than leaving a
  // superseded entry beside a copy, and every run is labelled with the text
  // it covers. (One record per word, each labelled with the parent's whole
  // text and stamped as new, was how this read in the Activity panel before.)
  // A record that was already detached is history (#674), not something to
  // bring back to life.
  const priorAnnotations = params.priorAnnotations?.filter((a) => !a.detached) ?? []
  if (priorAnnotations.length > 0) {
    const unchangedRanges = computeUnchangedWordRanges(originalText, newText)
    // originalContentStart is the absolute PM position of char 0 in the old text,
    // which equals rangeFrom (both executeEdit and executeInsert pass contentStart as rangeFrom).
    const originalContentStart = rangeFrom

    for (const prior of priorAnnotations) {
      const pieces: Array<{ from: number; to: number }> = []
      for (const range of unchangedRanges) {
        // Absolute positions of this word in the OLD document
        const oldAbsFrom = originalContentStart + range.oldFrom
        const oldAbsTo = originalContentStart + range.oldTo
        if (prior.to <= oldAbsFrom || prior.from >= oldAbsTo) continue

        // Clamp the annotation to the word boundary (handles partial overlaps)
        const clampedOldFrom = Math.max(prior.from, oldAbsFrom)
        const clampedOldTo = Math.min(prior.to, oldAbsTo)

        // Convert old-relative offsets to new-relative offsets
        const oldRelFrom = clampedOldFrom - originalContentStart
        const oldRelTo = clampedOldTo - originalContentStart

        // Map old-text char offsets to new-text char offsets via the unchanged-word pair
        // (linear mapping within the word — fine because the word text is identical)
        const wordOldLen = range.oldTo - range.oldFrom
        const wordNewLen = range.newTo - range.newFrom
        const scale = wordNewLen / Math.max(wordOldLen, 1)
        const newRelFrom = range.newFrom + Math.round((oldRelFrom - range.oldFrom) * scale)
        const newRelTo = range.newFrom + Math.round((oldRelTo - range.oldFrom) * scale)
        if (newRelFrom < newRelTo) pieces.push({ from: newRelFrom, to: newRelTo })
      }
      pieces.sort((a, b) => a.from - b.from)

      const runs: Array<{ from: number; to: number }> = []
      for (const piece of pieces) {
        const last = runs[runs.length - 1]
        if (last && piece.from >= last.from && newText.slice(last.to, piece.from).trim() === '') {
          last.to = Math.max(last.to, piece.to)
        } else {
          runs.push({ ...piece })
        }
      }
      runs.forEach((run, i) => {
        out.push({
          id: i === 0 ? prior.id : undefined,
          createdAt: prior.createdAt,
          type: prior.type,
          from: rangeFrom + run.from,
          to: rangeFrom + run.to,
          content: newText.slice(run.from, run.to),
          provenance: prior.provenance,
          explanation: prior.explanation,
        })
      })
    }
  }

  // --- Add annotations for newly-changed (added) regions ---
  // Coalesce consecutive 'added' segments into a single contiguous span so one
  // logical edit becomes one annotation (and one history row), not one per word.
  // Whitespace-only 'unchanged' segments *between* added segments are interior to
  // the run and absorbed into the span; a non-whitespace ('word') 'unchanged'
  // segment closes the current run. Trailing buffered whitespace is excluded.
  const mergedRuns: { from: number; to: number; content: string }[] = []
  let charOffset = 0
  let runStartOffset: number | null = null // char offset (into newText) where the run opened
  let runEndOffset = 0                      // char offset just past the last 'added' segment in the run

  const flushRun = () => {
    if (runStartOffset === null) return
    mergedRuns.push({
      from: rangeFrom + runStartOffset,
      to: rangeFrom + runEndOffset,
      content: newText.slice(runStartOffset, runEndOffset),
    })
    runStartOffset = null
  }

  for (const segment of diff.new) {
    if (segment.type === 'added') {
      if (runStartOffset === null) runStartOffset = charOffset
      charOffset += segment.text.length
      runEndOffset = charOffset // run ends at the end of this added segment (interior ws now included)
    } else {
      // A whitespace-only 'unchanged' segment between added segments keeps the run
      // open — it's absorbed because runEndOffset jumps to the end of the next added
      // segment. A real unchanged word closes the run. Trailing whitespace is excluded
      // because runEndOffset never advances past the last added segment.
      if (!(runStartOffset !== null && segment.text.trim() === '')) {
        flushRun()
      }
      charOffset += segment.text.length
    }
  }
  flushRun()

  if (mergedRuns.length > 0) {
    for (const run of mergedRuns) {
      out.push({ type: annotationType, from: run.from, to: run.to, content: run.content, provenance, explanation })
    }
  } else {
    // No word-level diff found (e.g. pure whitespace change), annotate full range
    out.push({ type: annotationType, from: rangeFrom, to: rangeTo, content: newText, provenance, explanation })
  }
  return out
}
