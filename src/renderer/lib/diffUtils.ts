/**
 * Shared word-level diff utilities
 *
 * Extracted from diff-suggestions/nodeview.ts for reuse across
 * inline diff nodeviews and review panels.
 */

export interface DiffSegment {
  text: string
  type: 'unchanged' | 'removed' | 'added'
}

/**
 * Compute word-level diff between two strings.
 * Returns arrays of segments with change types for both old and new text.
 */
export function computeWordDiff(original: string, suggested: string): { old: DiffSegment[]; new: DiffSegment[] } {
  const oldWords = original.split(/(\s+)/)
  const newWords = suggested.split(/(\s+)/)

  // Simple LCS-based diff for word-level changes
  const oldSegments: DiffSegment[] = []
  const newSegments: DiffSegment[] = []

  // Build a set of words in new text for quick lookup
  const newWordSet = new Set(newWords.filter(w => w.trim()))
  const oldWordSet = new Set(oldWords.filter(w => w.trim()))

  // Mark words in old text
  for (const word of oldWords) {
    if (!word) continue
    if (word.trim() === '') {
      // Whitespace - keep as unchanged
      oldSegments.push({ text: word, type: 'unchanged' })
    } else if (newWordSet.has(word)) {
      oldSegments.push({ text: word, type: 'unchanged' })
    } else {
      oldSegments.push({ text: word, type: 'removed' })
    }
  }

  // Mark words in new text
  for (const word of newWords) {
    if (!word) continue
    if (word.trim() === '') {
      newSegments.push({ text: word, type: 'unchanged' })
    } else if (oldWordSet.has(word)) {
      newSegments.push({ text: word, type: 'unchanged' })
    } else {
      newSegments.push({ text: word, type: 'added' })
    }
  }

  return { old: oldSegments, new: newSegments }
}
