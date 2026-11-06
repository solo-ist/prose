import { Extension } from '@tiptap/core'

/**
 * Enter inside a table cell inserts a line break instead of splitting the block (#1060).
 *
 * Splitting leaves the cell holding two paragraphs, and tiptap-markdown refuses
 * to serialize a table when any cell has `childCount > 1`
 * (tiptap-markdown/src/extensions/nodes/table.js:62-68) — it silently emits the
 * whole table as raw HTML instead. So before this, the first Enter typed inside
 * a cell quietly converted the user's pipe table into an HTML blob on save.
 *
 * A hard break is the representation the library itself expects: its hardBreak
 * serializer checks `state.inTable` and writes `<br>` inside a table rather than
 * the usual backslash-newline (nodes/hard-break.js), and GFM renders `<br>` in a
 * cell. So the cell keeps one paragraph, the table keeps its pipe syntax, and the
 * user still gets a second line.
 *
 * Scoped deliberately narrowly: only when the caret sits in a plain paragraph
 * directly inside a cell. A cell containing a list keeps the default Enter, so
 * list editing is not broken by this — such a cell has its own pre-existing
 * serialization problems, and making them worse is not this issue's business.
 */
export const TableCellKeymap = Extension.create({
  name: 'tableCellKeymap',

  // Above the default Enter binding (splitBlock, priority 100), so this wins
  // inside cells while leaving Enter everywhere else untouched.
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { state } = this.editor
        const { $from, empty } = state.selection

        // Only a collapsed caret in a paragraph whose parent is a cell.
        if (!empty) return false
        if ($from.parent.type.name !== 'paragraph') return false
        if ($from.depth < 2) return false

        const cell = $from.node($from.depth - 1)
        if (cell.type.name !== 'tableCell' && cell.type.name !== 'tableHeader') return false

        return this.editor.commands.setHardBreak()
      },
    }
  },
})
