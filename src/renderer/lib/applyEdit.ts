/**
 * Apply edit blocks to the TipTap editor as inline diff suggestions.
 */

import type { Editor } from '@tiptap/core'
import type { EditBlock } from './editBlocks'
import { createWordDiffAnnotations } from './diffUtils'

export interface ApplyResult {
  success: boolean
  error?: string
  matchCount?: number
  diffId?: string
  /** Position info for annotation creation */
  annotationRange?: { from: number; to: number }
}

/**
 * Provenance info passed when applying edits for annotation tracking
 */
export interface EditProvenance {
  model: string
  conversationId: string
  messageId: string
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
 * Detect common issues with search text that indicate the AI used
 * placeholders or descriptions instead of verbatim text.
 */
function detectSearchTextIssues(search: string): string | null {
  // Check for ellipsis placeholder (most common issue)
  if (search.includes('...') || search.includes('…')) {
    return 'Search text contains "..." placeholder. Copy the COMPLETE text you want to find, character-for-character.'
  }

  // Check for descriptive patterns like "## the heading" or "the paragraph about"
  const descriptivePatterns = [
    /^(the|a|an)\s+(heading|paragraph|section|sentence|line|text)\b/i,
    /\b(about|regarding|describing|containing)\b/i,
    /^##?\s*(the|a|an)\s+/i
  ]
  for (const pattern of descriptivePatterns) {
    if (pattern.test(search)) {
      return 'Search text appears to describe content rather than quote it. Copy the exact text from the document.'
    }
  }

  return null
}

/**
 * Build a helpful error message when text is not found.
 */
function buildNotFoundError(search: string): string {
  // Check for common issues first
  const issue = detectSearchTextIssues(search)
  if (issue) {
    return issue
  }

  // Generic message with verbatim reminder
  const preview = search.slice(0, 50) + (search.length > 50 ? '...' : '')
  return `Text not found: "${preview}". Make sure the search text is copied VERBATIM from the document.`
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
 * Build a mapping from text positions to document positions.
 * Uses a separator between block nodes to preserve structure.
 */
function buildPositionMap(doc: import('@tiptap/pm/model').Node): {
  text: string
  toDocPos: (textPos: number) => number
} {
  const segments: Array<{ text: string; docStart: number }> = []
  let currentText = ''

  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      segments.push({ text: node.text, docStart: pos })
      currentText += node.text
    } else if (node.isBlock && currentText.length > 0 && !currentText.endsWith('\n')) {
      // Add newline separator between blocks for proper matching
      currentText += '\n'
    }
  })

  // Build cumulative text position map
  let textPos = 0
  const textToDoc: Array<{ textStart: number; textEnd: number; docStart: number }> = []

  for (const seg of segments) {
    textToDoc.push({
      textStart: textPos,
      textEnd: textPos + seg.text.length,
      docStart: seg.docStart,
    })
    textPos += seg.text.length
  }

  return {
    text: segments.map(s => s.text).join(''),
    toDocPos: (pos: number) => {
      for (const mapping of textToDoc) {
        if (pos >= mapping.textStart && pos < mapping.textEnd) {
          return mapping.docStart + (pos - mapping.textStart)
        }
        // Handle position at exact end of a segment
        if (pos === mapping.textEnd) {
          return mapping.docStart + (pos - mapping.textStart)
        }
      }
      // If past end, return end of last segment
      if (textToDoc.length > 0) {
        const last = textToDoc[textToDoc.length - 1]
        return last.docStart + (last.textEnd - last.textStart)
      }
      return 0
    },
  }
}

/**
 * Find best fuzzy match for search text in the document.
 * Returns the match with highest similarity score.
 */
export function findFuzzyMatch(editor: Editor, search: string, minSimilarity = 0.7): TextMatch | null {
  const doc = editor.state.doc
  const normalizedSearch = normalizeText(search)
  const searchLen = normalizedSearch.length

  // Build position-mapped text from document
  const { text: fullText, toDocPos } = buildPositionMap(doc)
  const normalizedFull = normalizeText(fullText)

  if (normalizedFull.length < searchLen * 0.5) return null

  // Build mapping from normalized text positions to original text positions
  const normToOrig: number[] = []
  let normIdx = 0
  for (let i = 0; i < fullText.length; i++) {
    const char = fullText[i]
    const prevChar = i > 0 ? fullText[i - 1] : ''
    // Count non-whitespace, or first space after non-whitespace
    if (!/\s/.test(char) || (!/\s/.test(prevChar) && prevChar !== '')) {
      normToOrig[normIdx] = i
      normIdx++
    }
  }
  // Add final position for end-of-string
  normToOrig[normIdx] = fullText.length

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

        // Map normalized positions back to original text positions
        const origStart = normToOrig[i] ?? 0
        const origEnd = normToOrig[end] ?? fullText.length

        // Convert original text positions to document positions
        const docFrom = toDocPos(origStart)
        const docTo = toDocPos(origEnd)

        bestMatch = {
          from: docFrom,
          to: docTo,
          similarity: sim,
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
 * Optionally creates an AI annotation for provenance tracking.
 */
export function applyEditDirect(
  editor: Editor,
  editBlock: EditBlock,
  provenance?: EditProvenance,
  documentId?: string
): ApplyResult {
  const { search, replace } = editBlock

  if (!search) {
    return { success: false, error: 'Search text is empty' }
  }

  const match = findBestMatch(editor, search)

  if (!match) {
    return {
      success: false,
      error: buildNotFoundError(search),
      matchCount: 0,
    }
  }

  // Calculate the position where the new text will be
  const insertFrom = match.from
  const sizeBefore = editor.state.doc.content.size

  // Replace directly
  editor
    .chain()
    .focus()
    .setTextSelection(match)
    .insertContent(replace)
    .run()

  // Map the old match.to through the edit using the actual PM size delta.
  // insertContent() may produce multi-paragraph nodes where string length != PM position delta.
  const sizeAfter = editor.state.doc.content.size
  const insertTo = match.to + (sizeAfter - sizeBefore)

  // Create word-level annotations for AI provenance tracking
  if (provenance && documentId && replace.length > 0) {
    createWordDiffAnnotations({
      documentId,
      originalText: search,
      newText: replace,
      rangeFrom: insertFrom,
      rangeTo: insertTo,
      provenance: {
        model: provenance.model,
        conversationId: provenance.conversationId,
        messageId: provenance.messageId,
      },
    })
  }

  return {
    success: true,
    matchCount: 1,
    annotationRange: { from: insertFrom, to: insertTo },
  }
}

/**
 * Apply multiple edits directly (agent mode).
 * Optionally creates AI annotations for provenance tracking.
 */
export function applyEditsDirect(
  editor: Editor,
  editBlocks: EditBlock[],
  provenance?: EditProvenance,
  documentId?: string
): ApplyResult[] {
  const results: ApplyResult[] = []

  // Apply in reverse order to preserve positions
  for (let i = editBlocks.length - 1; i >= 0; i--) {
    const result = applyEditDirect(editor, editBlocks[i], provenance, documentId)
    results.unshift(result)
  }

  return results
}

/**
 * Apply a single edit as an inline diff suggestion.
 * The edit will appear in the document with accept/reject buttons.
 * Provenance data is stored in the suggestion for annotation creation on accept.
 */
export function applyEditAsDiff(
  editor: Editor,
  editBlock: EditBlock,
  comment?: string,
  provenance?: EditProvenance,
  documentId?: string
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
      error: buildNotFoundError(search),
      matchCount: 0,
    }
  }

  // Insert the diff suggestion node with provenance data for later annotation
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
        // Store provenance for annotation creation on accept
        provenanceModel: provenance?.model || '',
        provenanceConversationId: provenance?.conversationId || '',
        provenanceMessageId: provenance?.messageId || '',
        documentId: documentId || '',
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
 * Provenance data is stored for annotation creation on accept.
 */
export function applyEditsAsDiffs(
  editor: Editor,
  editBlocks: EditBlock[],
  comment?: string,
  provenance?: EditProvenance,
  documentId?: string
): ApplyResult[] {
  const results: ApplyResult[] = []

  // Apply in reverse order to preserve positions
  for (let i = editBlocks.length - 1; i >= 0; i--) {
    const result = applyEditAsDiff(editor, editBlocks[i], comment, provenance, documentId)
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
