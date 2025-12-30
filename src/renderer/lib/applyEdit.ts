/**
 * Apply edit blocks to the TipTap editor as inline diff suggestions.
 */

import type { Editor } from '@tiptap/core'
import type { EditBlock } from './editBlocks'

export interface ApplyResult {
  success: boolean
  error?: string
  matchCount?: number
  diffId?: string
}

export interface TextMatch {
  from: number
  to: number
  similarity?: number
}

/**
 * Normalize text for comparison: collapse whitespace, trim.
 */
function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Calculate similarity ratio between two strings (0-1).
 * Uses longest common subsequence approach.
 */
function similarity(a: string, b: string): number {
  if (a === b) return 1
  if (!a || !b) return 0

  const longer = a.length > b.length ? a : b
  const shorter = a.length > b.length ? b : a

  // Quick check: if lengths differ too much, low similarity
  if (longer.length === 0) return 1
  const lengthRatio = shorter.length / longer.length
  if (lengthRatio < 0.5) return lengthRatio * 0.5

  // Calculate Levenshtein distance
  const costs: number[] = []
  for (let i = 0; i <= shorter.length; i++) {
    let lastValue = i
    for (let j = 0; j <= longer.length; j++) {
      if (i === 0) {
        costs[j] = j
      } else if (j > 0) {
        let newValue = costs[j - 1]
        if (shorter.charAt(i - 1) !== longer.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1
        }
        costs[j - 1] = lastValue
        lastValue = newValue
      }
    }
    if (i > 0) costs[longer.length] = lastValue
  }

  return (longer.length - costs[longer.length]) / longer.length
}

/**
 * Find best fuzzy match for search text in the document.
 * Returns the match with highest similarity score.
 */
export function findFuzzyMatch(editor: Editor, search: string, minSimilarity = 0.7): TextMatch | null {
  const doc = editor.state.doc
  const normalizedSearch = normalizeText(search)
  const searchLen = normalizedSearch.length

  // Extract all document text with positions
  const textChunks: Array<{ text: string; pos: number }> = []
  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      textChunks.push({ text: node.text, pos })
    }
  })

  // Combine into full text for searching
  const fullText = textChunks.map(c => c.text).join('')
  const normalizedFull = normalizeText(fullText)

  if (normalizedFull.length < searchLen * 0.5) return null

  let bestMatch: TextMatch | null = null
  let bestSimilarity = minSimilarity

  // Sliding window search
  const windowSize = Math.floor(searchLen * 1.5)
  const step = Math.max(1, Math.floor(searchLen / 4))

  for (let i = 0; i <= normalizedFull.length - searchLen * 0.5; i += step) {
    // Try different window sizes around search length
    for (const winSize of [searchLen, windowSize, Math.floor(searchLen * 0.8)]) {
      const end = Math.min(i + winSize, normalizedFull.length)
      const candidate = normalizedFull.slice(i, end)
      const sim = similarity(normalizedSearch, candidate)

      if (sim > bestSimilarity) {
        bestSimilarity = sim

        // Map back to original positions
        // Find the corresponding position in original text
        let origStart = 0
        let normIdx = 0
        for (let j = 0; j < fullText.length && normIdx < i; j++) {
          if (!/\s/.test(fullText[j]) || (j > 0 && !/\s/.test(fullText[j - 1]))) {
            normIdx++
          }
          origStart = j + 1
        }

        let origEnd = origStart
        normIdx = 0
        const targetLen = end - i
        for (let j = origStart; j < fullText.length && normIdx < targetLen; j++) {
          if (!/\s/.test(fullText[j]) || (j > 0 && !/\s/.test(fullText[j - 1]))) {
            normIdx++
          }
          origEnd = j + 1
        }

        // Convert to document positions
        let docPos = 0
        let textPos = 0
        for (const chunk of textChunks) {
          if (textPos + chunk.text.length > origStart) {
            const startOffset = Math.max(0, origStart - textPos)
            const endOffset = Math.min(chunk.text.length, origEnd - textPos)

            bestMatch = {
              from: chunk.pos + startOffset,
              to: chunk.pos + endOffset,
              similarity: sim,
            }
            break
          }
          textPos += chunk.text.length
          docPos = chunk.pos + chunk.text.length
        }
      }
    }
  }

  return bestMatch
}

/**
 * Find all occurrences of a search string in the document (exact match).
 * Returns positions suitable for TipTap text selection.
 */
export function findTextInDocument(editor: Editor, search: string): TextMatch[] {
  const matches: TextMatch[] = []
  const doc = editor.state.doc

  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      let index = 0
      const text = node.text

      while ((index = text.indexOf(search, index)) !== -1) {
        matches.push({
          from: pos + index,
          to: pos + index + search.length,
        })
        index += 1
      }
    }
  })

  return matches
}

/**
 * Find the best match for search text, trying exact match first, then fuzzy.
 */
function findBestMatch(editor: Editor, search: string): TextMatch | null {
  // Try exact match first
  const exactMatches = findTextInDocument(editor, search)
  if (exactMatches.length > 0) {
    return { ...exactMatches[0], similarity: 1 }
  }

  // Fall back to fuzzy matching
  return findFuzzyMatch(editor, search)
}

/**
 * Apply a single edit directly to the document (agent mode).
 * Replaces the matched text with the replacement text immediately.
 */
export function applyEditDirect(
  editor: Editor,
  editBlock: EditBlock
): ApplyResult {
  const { search, replace } = editBlock

  if (!search) {
    return { success: false, error: 'Search text is empty' }
  }

  const match = findBestMatch(editor, search)

  if (!match) {
    return {
      success: false,
      error: `Text not found: "${search.slice(0, 50)}${search.length > 50 ? '...' : ''}"`,
      matchCount: 0,
    }
  }

  // Replace directly
  editor
    .chain()
    .focus()
    .setTextSelection(match)
    .insertContent(replace)
    .run()

  return {
    success: true,
    matchCount: 1,
  }
}

/**
 * Apply multiple edits directly (agent mode).
 */
export function applyEditsDirect(
  editor: Editor,
  editBlocks: EditBlock[]
): ApplyResult[] {
  const results: ApplyResult[] = []

  // Apply in reverse order to preserve positions
  for (let i = editBlocks.length - 1; i >= 0; i--) {
    const result = applyEditDirect(editor, editBlocks[i])
    results.unshift(result)
  }

  return results
}

/**
 * Apply a single edit as an inline diff suggestion.
 * The edit will appear in the document with accept/reject buttons.
 */
export function applyEditAsDiff(
  editor: Editor,
  editBlock: EditBlock,
  comment?: string
): ApplyResult {
  const { id, search, replace } = editBlock

  // Validate inputs
  if (!search) {
    return {
      success: false,
      error: 'Search text is empty',
    }
  }

  // Find the best match (exact or fuzzy)
  const match = findBestMatch(editor, search)

  if (!match) {
    return {
      success: false,
      error: `Text not found: "${search.slice(0, 50)}${search.length > 50 ? '...' : ''}"`,
      matchCount: 0,
    }
  }

  // Insert the diff suggestion node
  editor
    .chain()
    .focus()
    .setTextSelection(match)
    .insertContent({
      type: 'diffSuggestion',
      attrs: {
        id,
        comment: comment || '',
        originalText: search,
        suggestedText: replace,
      },
    })
    .run()

  return {
    success: true,
    matchCount: 1,
    diffId: id,
  }
}

/**
 * Apply multiple edits as inline diff suggestions.
 * Applies in reverse order to preserve positions.
 */
export function applyEditsAsDiffs(
  editor: Editor,
  editBlocks: EditBlock[],
  comment?: string
): ApplyResult[] {
  const results: ApplyResult[] = []

  // Apply in reverse order to preserve positions
  for (let i = editBlocks.length - 1; i >= 0; i--) {
    const result = applyEditAsDiff(editor, editBlocks[i], comment)
    results.unshift(result) // Add to front to maintain original order
  }

  return results
}

/**
 * Get count of pending diff suggestions in the document.
 */
export function countPendingDiffs(editor: Editor): number {
  let count = 0

  editor.state.doc.descendants((node) => {
    if (node.type.name === 'diffSuggestion') {
      count++
    }
  })

  return count
}
