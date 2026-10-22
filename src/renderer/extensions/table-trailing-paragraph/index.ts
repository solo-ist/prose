import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'

/**
 * A table is never the document's last node (#1087).
 *
 * `insertTable` at the end of a document leaves the table as the final top-level
 * node with nothing after it, and there is then no forgiving way out of it:
 * clicking the empty space below the table puts the caret back in the nearest
 * cell, because that cell *is* the nearest text position. Gapcursor is enabled,
 * so the narrow band immediately below the table does work — a target a user has
 * no reason to know about and little chance of hitting.
 *
 * So guarantee an empty paragraph after a trailing table. The click below then
 * resolves to that paragraph the way it does under any other block, and the
 * arrow keys leave the table too.
 *
 * Two properties make this safe to run on every transaction:
 *
 * - **It does not change the markdown.** An empty paragraph renders nothing and
 *   its block separator is only flushed when more content follows
 *   (prosemirror-markdown's `flushClose`), so `getMarkdown()` is byte-identical.
 *   That matters because `Editor`'s `onUpdate` compares the serialized markdown
 *   to decide dirty state — a paragraph appended while *opening* a file must not
 *   mark the document unsaved. The e2e spec asserts that round-trip identity.
 * - **It cannot recurse.** After the insert the last child is the paragraph, so
 *   the next pass returns null.
 *
 * Scoped to `table` rather than "any non-textblock last node": a trailing-node
 * rule over the whole schema would also append after a code block, a horizontal
 * rule and the footnotes section, which is a wider behaviour change than this
 * issue asked for.
 */
function trailingParagraph(state: EditorState): Transaction | null {
  const last = state.doc.lastChild
  if (!last || last.type.name !== 'table') return null
  const paragraph = state.schema.nodes.paragraph
  if (!paragraph) return null
  return (
    state.tr
      .insert(state.doc.content.size, paragraph.create())
      // Not its own undo step: otherwise the first Cmd+Z after inserting a table
      // removes this paragraph and appears to do nothing, and the table needs a
      // second press. The paragraph is re-appended on the next transaction
      // anyway, so there is nothing to undo.
      .setMeta('addToHistory', false)
  )
}

export const TableTrailingParagraph = Extension.create({
  name: 'tableTrailingParagraph',

  // A document that *arrives* ending in a table (file open, session restore)
  // gets no transaction, so appendTransaction never sees it.
  onCreate() {
    if (!this.editor.isEditable) return
    const tr = trailingParagraph(this.editor.state)
    if (tr) this.editor.view.dispatch(tr)
  },

  addProseMirrorPlugins() {
    const { editor } = this
    return [
      new Plugin({
        key: new PluginKey('tableTrailingParagraph'),
        appendTransaction: (_transactions, _oldState, newState) => {
          // Read-only surfaces (reMarkable OCR view, preview tabs) are left
          // exactly as the file is: there is no caret to rescue there.
          if (!editor.isEditable) return null
          return trailingParagraph(newState)
        },
      }),
    ]
  },
})
