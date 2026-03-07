/**
 * Shared word-level diff utilities and editor scroll helpers.
 *
 * Extracted from diff-suggestions/nodeview.ts for reuse across
 * inline diff nodeviews and review panels.
 */

import type { Editor } from '@tiptap/core'
import { useAnnotationStore } from '../extensions/ai-annotations/store'
import type { AnnotationType } from '../types/annotations'

/**
 * Scroll the editor so the current selection is centered in the viewport.
 * Matches the behavior of FindBar's search result scrolling.
 */
export function scrollSelectionIntoCenter(editor: Editor): void {
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
 * Create word-level AI annotations for a text replacement.
 * Uses computeWordDiff to annotate only the changed words instead of the entire range.
 * Falls back to a single full-range annotation for multi-paragraph replacements
 * (PM positions diverge from string offsets across paragraph boundaries).
 */
export function createWordDiffAnnotations(params: {
  documentId: string
  originalText: string
  newText: string
  rangeFrom: number
  rangeTo: number
  provenance: { model: string; conversationId: string; messageId: string }
}): void {
  const { documentId, originalText, newText, rangeFrom, rangeTo, provenance } = params
  const annotationType: AnnotationType = originalText.trim() === '' ? 'insertion' : 'replacement'
  const store = useAnnotationStore.getState()

  // Multi-paragraph: fall back to full-range annotation
  if (newText.includes('\n')) {
    store.addAnnotation({
      documentId,
      type: annotationType,
      from: rangeFrom,
      to: rangeTo,
      content: newText,
      provenance,
    })
    return
  }

  const diff = computeWordDiff(originalText, newText)

  const addedSegments: { from: number; to: number; content: string }[] = []
  let charOffset = 0
  for (const segment of diff.new) {
    if (segment.type === 'added') {
      addedSegments.push({
        from: rangeFrom + charOffset,
        to: rangeFrom + charOffset + segment.text.length,
        content: segment.text,
      })
    }
    charOffset += segment.text.length
  }

  if (addedSegments.length > 0) {
    for (const seg of addedSegments) {
      store.addAnnotation({
        documentId,
        type: annotationType,
        from: seg.from,
        to: seg.to,
        content: seg.content,
        provenance,
      })
    }
  } else {
    // No word-level diff found (e.g. pure whitespace change), annotate full range
    store.addAnnotation({
      documentId,
      type: annotationType,
      from: rangeFrom,
      to: rangeTo,
      content: newText,
      provenance,
    })
  }
}
