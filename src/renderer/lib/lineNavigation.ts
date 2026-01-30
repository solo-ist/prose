/**
 * Utilities for navigating to positions in the TipTap editor.
 *
 * The search_document tool returns ProseMirror document positions (not line numbers).
 * These positions are used directly for navigation.
 */

import type { Editor } from '@tiptap/core'

/**
 * Navigate the editor to a specific document position.
 * Scrolls the position into view and places the cursor there.
 *
 * @param editor - The TipTap editor instance
 * @param position - The ProseMirror document position to navigate to
 */
export function jumpToPosition(editor: Editor, position: number): void {
  const docSize = editor.state.doc.content.size

  // Clamp position to valid range
  const safePos = Math.max(0, Math.min(position, docSize))

  try {
    // Set cursor to the position
    editor.chain()
      .focus()
      .setTextSelection(safePos)
      .run()

    // Scroll into view
    requestAnimationFrame(() => {
      editor.commands.scrollIntoView()
    })
  } catch (err) {
    console.warn(`Failed to jump to position ${position}:`, err)
  }
}

/**
 * Navigate the editor to a "line" reference from the LLM.
 * Note: The search_document tool returns document positions as "line" numbers,
 * so this function treats the input as a position, not an actual line number.
 *
 * @param editor - The TipTap editor instance
 * @param lineNumber - Actually a document position from search_document
 * @param select - Unused, kept for API compatibility
 */
export function jumpToLine(editor: Editor, lineNumber: number, select = false): void {
  // The "line number" from search_document is actually a document position
  jumpToPosition(editor, lineNumber)
}
