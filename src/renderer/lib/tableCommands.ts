/**
 * Guarded table operations (#1060).
 *
 * Everything here protects one invariant: tiptap-markdown serializes a table as
 * a GFM pipe table only when the first row is entirely `tableHeader`, no cell
 * carries colspan/rowspan > 1, and no cell holds more than one block
 * (tiptap-markdown/src/extensions/nodes/table.js:57-73). Violate any of those
 * and the serializer silently falls back to raw HTML — so a structural edit
 * would turn the user's markdown file into an HTML blob on the next save.
 *
 * prosemirror-tables' own commands are safe in some positions and not others:
 *
 * - `addColumn` picks each new cell's type from its row-neighbour
 *   (prosemirror-tables addColumn, the `refColumn` branch), so it preserves the
 *   header wherever it inserts. Safe in every position.
 * - `addRow` picks the type from the row above (`refRow`), so appending is safe,
 *   but inserting at index 0 yields a *body* row as the new first row. Unsafe.
 * - `deleteRow` on row 0 promotes a body row into first position. Unsafe on its
 *   own, so the wrapper below repairs it by converting the promoted row.
 *
 * This module therefore exposes only the safe shapes, and the UI drives it
 * rather than calling the raw commands.
 */
import type { Editor } from '@tiptap/react'
// Type-only: pulls in the ChainedCommands augmentation that declares
// insertTable/addRowAfter/addColumnAfter/deleteRow/deleteColumn/deleteTable.
// The extension itself is registered in Editor.tsx.
import type {} from '@tiptap/extension-table'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { TextSelection, type Transaction } from '@tiptap/pm/state'
import { CellSelection, TableMap, selectedRect, tableNodeTypes } from '@tiptap/pm/tables'

export interface TableInfo {
  /** Position of the table node's content start, as prosemirror-tables uses it. */
  tableStart: number
  table: PMNode
  map: TableMap
  /** Zero-based grid coordinates of the anchor cell. */
  row: number
  col: number
  rowCount: number
  colCount: number
  /** False for a table that arrived as HTML without a header row. */
  hasHeaderRow: boolean
  /**
   * True when every cell is a plain 1x1 — the precondition for the index-based
   * row/column moves below, which rebuild the grid positionally.
   */
  isUniformGrid: boolean
}

function rowOffset(table: PMNode, index: number): number {
  let offset = 0
  for (let i = 0; i < index; i++) offset += table.child(i).nodeSize
  return offset
}

/** Reads the table around the selection, or null when the caret is outside one. */
export function getTableInfo(editor: Editor | null): TableInfo | null {
  if (!editor) return null
  let rect: ReturnType<typeof selectedRect>
  try {
    // selectedRect throws when the selection is not inside a table.
    rect = selectedRect(editor.state)
  } catch {
    return null
  }

  const { map, table, tableStart } = rect
  const types = tableNodeTypes(editor.state.schema)

  let hasHeaderRow = map.width > 0
  for (let c = 0; c < map.width; c++) {
    if (table.nodeAt(map.map[c])?.type !== types.header_cell) {
      hasHeaderRow = false
      break
    }
  }

  let isUniformGrid = true
  outer: for (let r = 0; r < map.height; r++) {
    const row = table.child(r)
    if (row.childCount !== map.width) {
      isUniformGrid = false
      break
    }
    for (let c = 0; c < row.childCount; c++) {
      const cell = row.child(c)
      if ((cell.attrs.colspan ?? 1) > 1 || (cell.attrs.rowspan ?? 1) > 1) {
        isUniformGrid = false
        break outer
      }
    }
  }

  return {
    tableStart,
    table,
    map,
    row: rect.top,
    col: rect.left,
    rowCount: map.height,
    colCount: map.width,
    hasHeaderRow,
    isUniformGrid,
  }
}

export function isInTable(editor: Editor | null): boolean {
  return getTableInfo(editor) !== null
}

/**
 * Inserts a table with a header row — the only shape that round-trips through
 * markdown. Three columns and two body rows is the smallest table that shows
 * what the structure is without needing immediate editing.
 */
export function insertTable(editor: Editor, rows = 3, cols = 3): boolean {
  return editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run()
}

/**
 * Appends a body row at the bottom.
 *
 * `addRowAfter` inserts below the *selected* row, which is only the bottom when
 * the caret happens to be there — so the selection moves to the last row first.
 * Appending is the safe direction: the new row takes its cell type from the row
 * above, which is a body row (or, in a header-only table, prosemirror-tables
 * falls back to the plain cell type). Either way the header row is untouched.
 */
export function appendRow(editor: Editor): boolean {
  const info = getTableInfo(editor)
  if (!info) return false
  const lastRowFirstCell = info.tableStart + info.map.map[(info.rowCount - 1) * info.colCount]
  return editor
    .chain()
    .focus()
    .command(({ tr, dispatch }) => {
      if (dispatch) tr.setSelection(TextSelection.near(tr.doc.resolve(lastRowFirstCell + 1)))
      return true
    })
    .addRowAfter()
    .run()
}

/** Appends a column on the right, header cell included. */
export function appendColumn(editor: Editor): boolean {
  const info = getTableInfo(editor)
  if (!info) return false
  const lastColCell = info.tableStart + info.map.map[info.colCount - 1]
  return editor
    .chain()
    .focus()
    .command(({ tr, dispatch }) => {
      if (dispatch) tr.setSelection(TextSelection.near(tr.doc.resolve(lastColCell + 1)))
      return true
    })
    .addColumnAfter()
    .run()
}

/** A table with one row left has nothing to delete down to — remove it whole. */
export function canDeleteRow(info: TableInfo | null): boolean {
  return info !== null && info.rowCount > 1
}

export function canDeleteColumn(info: TableInfo | null): boolean {
  return info !== null && info.colCount > 1
}

/**
 * Deletes a row. Removing the header row promotes the next one in its place, so
 * the table still leads with a header and still serializes as a pipe table.
 */
export function deleteRow(editor: Editor, row: number): boolean {
  const info = getTableInfo(editor)
  if (!info || row < 0 || row >= info.rowCount) return false
  if (info.rowCount === 1) return editor.chain().focus().deleteTable().run()

  const { table, map, tableStart, colCount } = info
  const headerType = tableNodeTypes(editor.state.schema).header_cell
  const promoting = row === 0 && info.hasHeaderRow

  return editor
    .chain()
    .focus()
    .command(({ tr, dispatch }) => {
      if (!dispatch) return true

      // Convert first, delete second: a type change leaves node sizes alone, so
      // the row offsets computed here stay valid for the delete below.
      if (promoting) {
        for (let c = 0; c < colCount; c++) {
          const cellPos = tableStart + map.map[colCount + c]
          const cell = tr.doc.nodeAt(cellPos)
          if (cell && cell.type !== headerType) {
            tr.setNodeMarkup(cellPos, headerType, cell.attrs, cell.marks)
          }
        }
      }

      const start = tableStart + rowOffset(table, row)
      tr.delete(start, start + table.child(row).nodeSize)
      return true
    })
    .run()
}

/** Deletes a column, or the whole table when it was the last one. */
export function deleteColumn(editor: Editor, col: number): boolean {
  const info = getTableInfo(editor)
  if (!info || col < 0 || col >= info.colCount) return false
  if (info.colCount === 1) return editor.chain().focus().deleteTable().run()

  return withColumnSelected(editor, info, col, (chain) => chain.deleteColumn())
}

export function deleteTable(editor: Editor): boolean {
  return editor.chain().focus().deleteTable().run()
}

/**
 * Rows may only be reordered within the body. Moving a body row to index 0 would
 * put non-header cells first, and moving the header row down would do the same —
 * both break serialization, so the UI disables these rather than repairing them
 * (silently retyping someone's header is worse than an inert button).
 */
export function canMoveRow(info: TableInfo | null, from: number, to: number): boolean {
  if (!info || !info.isUniformGrid) return false
  if (from === to) return false
  if (to < 0 || to >= info.rowCount || from < 0 || from >= info.rowCount) return false
  if (!info.hasHeaderRow) return true
  return from !== 0 && to !== 0
}

export function moveRow(editor: Editor, from: number, to: number): boolean {
  const info = getTableInfo(editor)
  if (!canMoveRow(info, from, to) || !info) return false

  const { table, tableStart } = info
  return editor
    .chain()
    .focus()
    .command(({ tr, dispatch }) => {
      if (!dispatch) return true
      const rows: PMNode[] = []
      for (let i = 0; i < table.childCount; i++) rows.push(table.child(i))
      const [moved] = rows.splice(from, 1)
      rows.splice(to, 0, moved)
      replaceTableContent(tr, tableStart, table, rows)
      return true
    })
    .run()
}

export function canMoveColumn(info: TableInfo | null, from: number, to: number): boolean {
  if (!info || !info.isUniformGrid) return false
  if (from === to) return false
  return to >= 0 && to < info.colCount && from >= 0 && from < info.colCount
}

/**
 * Columns carry their header cell with them, so a move cannot disturb the header
 * row — any position is fine.
 */
export function moveColumn(editor: Editor, from: number, to: number): boolean {
  const info = getTableInfo(editor)
  if (!canMoveColumn(info, from, to) || !info) return false

  const { table, tableStart } = info
  return editor
    .chain()
    .focus()
    .command(({ tr, dispatch }) => {
      if (!dispatch) return true
      const rows: PMNode[] = []
      for (let r = 0; r < table.childCount; r++) {
        const row = table.child(r)
        const cells: PMNode[] = []
        for (let c = 0; c < row.childCount; c++) cells.push(row.child(c))
        const [moved] = cells.splice(from, 1)
        cells.splice(to, 0, moved)
        rows.push(row.type.create(row.attrs, Fragment.fromArray(cells), row.marks))
      }
      replaceTableContent(tr, tableStart, table, rows)
      return true
    })
    .run()
}

function replaceTableContent(
  tr: Transaction,
  tableStart: number,
  table: PMNode,
  rows: PMNode[]
): void {
  tr.replaceWith(tableStart, tableStart + table.content.size, Fragment.fromArray(rows))
}

/** Selects a whole row, which is what the grip click does before the toolbar opens. */
export function selectRow(editor: Editor, row: number): boolean {
  const info = getTableInfo(editor)
  if (!info || row < 0 || row >= info.rowCount) return false
  const { tableStart, map, colCount } = info
  return editor
    .chain()
    .focus()
    .command(({ tr, dispatch }) => {
      if (!dispatch) return true
      const first = tr.doc.resolve(tableStart + map.map[row * colCount])
      const last = tr.doc.resolve(tableStart + map.map[row * colCount + (colCount - 1)])
      tr.setSelection(CellSelection.rowSelection(first, last))
      return true
    })
    .run()
}

export function selectColumn(editor: Editor, col: number): boolean {
  const info = getTableInfo(editor)
  if (!info || col < 0 || col >= info.colCount) return false
  return withColumnSelected(editor, info, col, (chain) => chain)
}

type ChainLike = ReturnType<Editor['chain']>

function withColumnSelected(
  editor: Editor,
  info: TableInfo,
  col: number,
  then: (chain: ChainLike) => ChainLike
): boolean {
  const { tableStart, map, colCount, rowCount } = info
  const chain = editor
    .chain()
    .focus()
    .command(({ tr, dispatch }) => {
      if (!dispatch) return true
      const first = tr.doc.resolve(tableStart + map.map[col])
      const last = tr.doc.resolve(tableStart + map.map[(rowCount - 1) * colCount + col])
      tr.setSelection(CellSelection.colSelection(first, last))
      return true
    })
  return then(chain).run()
}
