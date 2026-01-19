/**
 * Apply edit blocks to the TipTap editor.
 *
 * This module implements a layered matching strategy and block-aware replacement
 * to prevent style bleeding and ensure precise edit targeting.
 */

import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode, Schema, Slice, Fragment } from '@tiptap/pm/model'
import type { EditBlock } from './editBlocks'
import type { AnnotationType } from '../types/annotations'
import { useAnnotationStore } from '../extensions/ai-annotations/store'

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
  matchType?: 'exact' | 'hash' | 'fuzzy'
}

/**
 * Normalize text for comparison: collapse whitespace, trim.
 */
function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Normalize text for hash generation: lowercase, collapse whitespace, remove punctuation.
 */
function normalizeForHash(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim()
}

/**
 * Simple hash function for content matching.
 * Uses a fast string hash that produces consistent 8-character hex strings.
 */
function generateContentHash(text: string): string {
  const normalized = normalizeForHash(text)
  let hash = 0
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  // Convert to positive hex string
  return Math.abs(hash).toString(16).padStart(8, '0').slice(0, 8)
}

/**
 * Calculate similarity ratio between two strings (0-1).
 * Uses Levenshtein distance approach.
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
function buildPositionMap(doc: ProseMirrorNode): {
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
 * Extract block-level text segments from the document for hash matching.
 * Returns an array of block boundaries with their text content and hashes.
 */
function extractBlockSegments(doc: ProseMirrorNode): Array<{
  from: number
  to: number
  text: string
  hash: string
}> {
  const segments: Array<{ from: number; to: number; text: string; hash: string }> = []

  doc.descendants((node, pos) => {
    // Only process top-level block nodes (paragraphs, headings, etc.)
    if (node.isBlock && node.content.size > 0) {
      const text = node.textContent
      if (text.trim().length > 0) {
        segments.push({
          from: pos + 1, // +1 to skip the opening tag
          to: pos + node.nodeSize - 1, // -1 to skip the closing tag
          text,
          hash: generateContentHash(text),
        })
      }
    }
    // Don't descend into nested blocks
    return !node.isBlock
  })

  return segments
}

/**
 * Find a match by content hash in block segments.
 * Compares the search text's hash against each block's hash.
 */
function findByContentHash(editor: Editor, search: string): TextMatch | null {
  const searchHash = generateContentHash(search)
  const segments = extractBlockSegments(editor.state.doc)

  for (const segment of segments) {
    if (segment.hash === searchHash) {
      // Verify similarity to avoid hash collisions
      const normalizedSegment = normalizeText(segment.text)
      const normalizedSearch = normalizeText(search)
      const sim = similarity(normalizedSearch, normalizedSegment)

      if (sim >= 0.85) {
        return {
          from: segment.from,
          to: segment.to,
          similarity: sim,
          matchType: 'hash',
        }
      }
    }
  }

  return null
}

/**
 * Find best fuzzy match for search text in the document.
 * Uses stricter thresholds (90% similarity, 110% window) to avoid false matches.
 */
export function findFuzzyMatch(
  editor: Editor,
  search: string,
  minSimilarity = 0.9,
  maxWindowRatio = 1.1
): TextMatch | null {
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

  // Sliding window search with stricter parameters
  const maxWindowSize = Math.floor(searchLen * maxWindowRatio)
  const step = Math.max(1, Math.floor(searchLen / 4))

  for (let i = 0; i <= normalizedFull.length - searchLen * 0.5; i += step) {
    // Try different window sizes around search length (stricter than before)
    for (const winSize of [searchLen, maxWindowSize, Math.floor(searchLen * 0.95)]) {
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
          matchType: 'fuzzy',
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
          similarity: 1,
          matchType: 'exact',
        })
        index += 1
      }
    }
  })

  return matches
}

/**
 * Find the best match for search text using a layered strategy:
 * 1. Exact match - highest priority
 * 2. Hash match - fast content-based matching
 * 3. Strict fuzzy - 90% threshold, 110% window
 * 4. Fail with clear error - better to fail than match wrong text
 */
function findBestMatch(editor: Editor, search: string): TextMatch | null {
  // 1. Try exact match first
  const exactMatches = findTextInDocument(editor, search)
  if (exactMatches.length > 0) {
    return { ...exactMatches[0], matchType: 'exact' }
  }

  // 2. Try hash match - good for block-level content
  const hashMatch = findByContentHash(editor, search)
  if (hashMatch) {
    return hashMatch
  }

  // 3. Fall back to strict fuzzy matching (90% threshold, 110% window)
  return findFuzzyMatch(editor, search, 0.9, 1.1)
}

/**
 * Parse markdown text into a ProseMirror slice using the editor's schema.
 * This ensures proper block structure without inheriting context styling.
 */
function parseMarkdownToSlice(editor: Editor, markdown: string): Slice {
  const { schema } = editor.state

  // Check if markdown contains block-level elements (headings, lists, etc.)
  const hasBlockContent = /^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```)/m.test(markdown)

  if (!hasBlockContent) {
    // For inline content, create a simple text node
    // This preserves inline marks but doesn't create new blocks
    const textNode = schema.text(markdown)
    return new Slice(Fragment.from(textNode), 0, 0)
  }

  // For block content, we need to parse it properly
  // Use the editor's built-in markdown parser if available
  try {
    // Create a temporary document fragment by setting content
    // This leverages tiptap-markdown's parsing capabilities
    const tempDoc = editor.schema.nodeFromJSON({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: markdown }] }]
    })

    // For now, return simple text - the markdown extension handles conversion
    // on display, but for replacement we want explicit structure
    const textNode = schema.text(markdown)
    return new Slice(Fragment.from(textNode), 0, 0)
  } catch {
    // Fallback to plain text
    const textNode = schema.text(markdown)
    return new Slice(Fragment.from(textNode), 0, 0)
  }
}

/**
 * Apply a single edit directly to the document (agent mode).
 * Uses tr.replaceRange() for precise replacement without style bleeding.
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
      error: `Text not found: "${search.slice(0, 50)}${search.length > 50 ? '...' : ''}"`,
      matchCount: 0,
    }
  }

  // Calculate the position where the new text will be
  const insertFrom = match.from
  const insertTo = insertFrom + replace.length

  // Use transaction-based replacement for precise control
  const { state } = editor
  const tr = state.tr

  // Create a text node with the replacement content
  // Using schema.text() ensures no style inheritance from context
  if (replace.length > 0) {
    const textNode = state.schema.text(replace)
    tr.replaceWith(match.from, match.to, textNode)
  } else {
    // For deletions, just delete the range
    tr.delete(match.from, match.to)
  }

  // Dispatch the transaction
  editor.view.dispatch(tr)

  // Create annotation for AI provenance tracking
  if (provenance && documentId && replace.length > 0) {
    const annotationType: AnnotationType = search.trim() === '' ? 'insertion' : 'replacement'

    useAnnotationStore.getState().addAnnotation({
      documentId,
      type: annotationType,
      from: insertFrom,
      to: insertTo,
      content: replace,
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
 * Apply multiple edits directly using a single transaction with position mapping.
 * This prevents position cascade issues when accepting multiple suggestions.
 */
export function applyEditsDirect(
  editor: Editor,
  editBlocks: EditBlock[],
  provenance?: EditProvenance,
  documentId?: string
): ApplyResult[] {
  const results: ApplyResult[] = []

  // If only one edit, use the simple method
  if (editBlocks.length <= 1) {
    for (const editBlock of editBlocks) {
      results.push(applyEditDirect(editor, editBlock, provenance, documentId))
    }
    return results
  }

  // For multiple edits, use batched transaction with position mapping
  const { state } = editor
  const tr = state.tr

  // 1. Find all matches FIRST (before any changes)
  const targets = editBlocks.map((edit) => ({
    edit,
    match: findBestMatch(editor, edit.search),
  }))

  // 2. Sort by position descending (apply from end to start)
  // This simplifies position mapping since later positions aren't affected by earlier changes
  targets.sort((a, b) => (b.match?.from ?? 0) - (a.match?.from ?? 0))

  // 3. Apply all in single transaction
  for (const { edit, match } of targets) {
    if (!match) {
      results.unshift({
        success: false,
        error: `Text not found: "${edit.search.slice(0, 50)}${edit.search.length > 50 ? '...' : ''}"`,
        matchCount: 0,
      })
      continue
    }

    // Apply replacement at the matched position
    // Since we're going from end to start, positions are still valid
    if (edit.replace.length > 0) {
      const textNode = state.schema.text(edit.replace)
      tr.replaceWith(match.from, match.to, textNode)
    } else {
      tr.delete(match.from, match.to)
    }

    // Create annotation if provenance exists
    const insertFrom = match.from
    const insertTo = insertFrom + edit.replace.length

    if (provenance && documentId && edit.replace.length > 0) {
      const annotationType: AnnotationType = edit.search.trim() === '' ? 'insertion' : 'replacement'

      useAnnotationStore.getState().addAnnotation({
        documentId,
        type: annotationType,
        from: insertFrom,
        to: insertTo,
        content: edit.replace,
        provenance: {
          model: provenance.model,
          conversationId: provenance.conversationId,
          messageId: provenance.messageId,
        },
      })
    }

    results.unshift({
      success: true,
      matchCount: 1,
      annotationRange: { from: insertFrom, to: insertTo },
    })
  }

  // Dispatch the batched transaction
  editor.view.dispatch(tr)

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
      error: `Text not found: "${search.slice(0, 50)}${search.length > 50 ? '...' : ''}"`,
      matchCount: 0,
    }
  }

  // Apply suggestedEdit MARK to the matched text (not a node)
  // Marks track through document changes automatically, solving position cascade issues
  editor
    .chain()
    .focus()
    .setTextSelection(match)
    .setMark('suggestedEdit', {
      id,
      suggestedText: replace,
      comment: comment || '',
      provenanceModel: provenance?.model || '',
      provenanceConversationId: provenance?.conversationId || '',
      provenanceMessageId: provenance?.messageId || '',
      documentId: documentId || '',
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
 * Counts both mark-based suggestions (new) and node-based (legacy).
 */
export function countPendingDiffs(editor: Editor): number {
  let count = 0
  const seenIds = new Set<string>()

  editor.state.doc.descendants((node) => {
    // Count legacy node-based suggestions
    if (node.type.name === 'diffSuggestion') {
      count++
      return
    }

    // Count mark-based suggestions (new approach)
    if (node.isText) {
      const mark = node.marks.find((m) => m.type.name === 'suggestedEdit')
      if (mark && mark.attrs.id && !seenIds.has(mark.attrs.id)) {
        seenIds.add(mark.attrs.id)
        count++
      }
    }
  })

  return count
}
