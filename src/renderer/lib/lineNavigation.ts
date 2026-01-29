/**
 * Utilities for navigating to line numbers in the TipTap editor.
 *
 * TipTap/ProseMirror uses character positions (0-indexed), but users think
 * in line numbers (1-indexed). This module converts between the two.
 */

import type { Editor } from '@tiptap/core'

/**
 * Convert a line number (1-indexed) to a TipTap position (0-indexed).
 * Returns the position at the start of the line.
 *
 * @param editor - The TipTap editor instance
 * @param lineNumber - The line number (1-indexed)
 * @returns The character position at the start of that line, or null if line doesn't exist
 */
export function lineToPosition(editor: Editor, lineNumber: number): number | null {
  if (lineNumber < 1) return null

  const doc = editor.state.doc
  const text = doc.textContent

  // Split by newlines to count lines
  const lines = text.split('\n')

  if (lineNumber > lines.length) return null

  // Calculate position by summing lengths of previous lines
  // Line 1 starts at position 0
  // Line 2 starts at position (length of line 1 + 1 for newline)
  let position = 0
  for (let i = 0; i < lineNumber - 1; i++) {
    position += lines[i].length + 1 // +1 for the newline character
  }

  return position
}

/**
 * Navigate the editor to a specific line number.
 * Scrolls the line into view and optionally selects it.
 *
 * @param editor - The TipTap editor instance
 * @param lineNumber - The line number (1-indexed) to navigate to
 * @param select - Whether to select the entire line (default: false)
 */
export function jumpToLine(editor: Editor, lineNumber: number, select = false): void {
  const position = lineToPosition(editor, lineNumber)

  if (position === null) {
    console.warn(`Line ${lineNumber} does not exist in document`)
    return
  }

  // Get the ProseMirror node at this position
  const $pos = editor.state.doc.resolve(position)

  if (select) {
    // Select the entire line
    const lineStart = $pos.start($pos.depth)
    const lineEnd = $pos.end($pos.depth)
    editor.chain()
      .focus()
      .setTextSelection({ from: lineStart, to: lineEnd })
      .run()
  } else {
    // Just move cursor to the start of the line
    editor.chain()
      .focus()
      .setTextSelection(position)
      .run()
  }

  // Scroll the position into view
  // Use a small delay to ensure the selection has been applied
  requestAnimationFrame(() => {
    const { view } = editor
    const coords = view.coordsAtPos(position)

    // Find the scrollable container
    const editorContainer = view.dom.closest('.overflow-auto')
    if (editorContainer) {
      // Calculate offset to center the line in the viewport
      const containerRect = editorContainer.getBoundingClientRect()
      const scrollTop = coords.top - containerRect.top + editorContainer.scrollTop - containerRect.height / 3

      editorContainer.scrollTo({
        top: Math.max(0, scrollTop),
        behavior: 'smooth'
      })
    }
  })
}
