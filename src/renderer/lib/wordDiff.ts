/**
 * Word-level diffing utility for precise annotation creation
 */

export interface DiffSegment {
  text: string
  type: 'unchanged' | 'removed' | 'added'
}

export interface WordDiffResult {
  old: DiffSegment[]
  new: DiffSegment[]
}

/**
 * Compute word-level diff between two strings
 * Returns arrays of segments with change types
 */
export function computeWordDiff(original: string, suggested: string): WordDiffResult {
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

/**
 * Extract only the changed ranges from a word diff result
 * Returns ranges suitable for annotation creation
 */
export interface ChangeRange {
  from: number
  to: number
  text: string
}

export function extractChangedRanges(
  diffResult: WordDiffResult,
  originalText: string,
  suggestedText: string
): ChangeRange[] {
  const changedRanges: ChangeRange[] = []
  let currentPos = 0

  for (const segment of diffResult.new) {
    const segmentLength = segment.text.length
    if (segment.type === 'added') {
      // This is a changed portion - add to ranges
      changedRanges.push({
        from: currentPos,
        to: currentPos + segmentLength,
        text: segment.text,
      })
    }
    currentPos += segmentLength
  }

  // If no specific changes detected (e.g., all words changed), annotate the whole thing
  if (changedRanges.length === 0 && suggestedText !== originalText) {
    changedRanges.push({
      from: 0,
      to: suggestedText.length,
      text: suggestedText,
    })
  }

  return changedRanges
}
