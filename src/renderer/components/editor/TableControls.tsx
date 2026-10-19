/**
 * Table editing affordances (#1060).
 *
 * A fixed-position overlay measured from the live DOM rather than ProseMirror
 * decorations. Two reasons: the rails sit *outside* the table (a `+` below and
 * to the right, grips in the left and top gutters), which widget decorations
 * inside the table's content would have to fight; and an absolutely-positioned
 * layer cannot perturb the comment or AI-annotation decorations that already
 * wrap text inside cells.
 *
 * The overlay is inert — `pointer-events: none` on the container, re-enabled
 * only on the controls themselves — so hovering it never steals a click from the
 * text underneath. Buttons use onMouseDown + preventDefault, the same guard
 * SelectionPopover uses to keep the selection alive through a click.
 *
 * Every structural operation goes through lib/tableCommands, which is where the
 * markdown round-trip invariant is enforced.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  GripHorizontal,
  GripVertical,
  Plus,
  Trash2,
} from 'lucide-react'
import {
  appendColumn,
  appendRow,
  canDeleteColumn,
  canDeleteRow,
  canMoveColumn,
  canMoveRow,
  deleteColumn,
  deleteRow,
  getTableInfo,
  moveColumn,
  moveRow,
  selectColumn,
  selectRow,
  type TableInfo,
} from '../../lib/tableCommands'

/** Rail geometry, shared by the grips and by the toolbar that must clear them. */
const GRIP = 16
const GAP = 4
/** Toolbar is ~38px tall; clear the grip strip above the table entirely. */
const COL_TOOLBAR_OFFSET = GRIP + GAP + 44
/** Row toolbar sits left of the row grips, which occupy table.left - 20 .. -4. */
const ROW_TOOLBAR_OFFSET = 136

interface Metrics {
  table: DOMRect
  rows: DOMRect[]
  cols: DOMRect[]
}

type Active = { kind: 'row' | 'col'; index: number } | null

function measure(el: HTMLTableElement): Metrics | null {
  const table = el.getBoundingClientRect()
  if (table.width === 0 || table.height === 0) return null
  // `el.rows`, not querySelectorAll('tr'): the HTMLTableElement collection is
  // shallow, so a nested table (reachable by pasting HTML into a cell) cannot
  // contribute phantom rows that would mis-position every grip below it.
  const rowEls = Array.from(el.rows)
  const firstRowCells = rowEls[0] ? Array.from(rowEls[0].children) : []
  return {
    table,
    rows: rowEls.map((r) => r.getBoundingClientRect()),
    cols: firstRowCells.map((c) => c.getBoundingClientRect()),
  }
}

export function TableControls({ editor }: { editor: Editor | null }) {
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [info, setInfo] = useState<TableInfo | null>(null)
  const [active, setActive] = useState<Active>(null)
  // The element the overlay is measured from. A ref, not state: the rAF below
  // reads it without needing a re-render to see the latest value.
  const tableEl = useRef<HTMLTableElement | null>(null)
  const frame = useRef<number | null>(null)

  /** Coalesce measurement into one rAF — scroll, resize and transactions all drive it. */
  const scheduleMeasure = useCallback(() => {
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      const el = tableEl.current
      setMetrics(el && el.isConnected ? measure(el) : null)
    })
  }, [])

  const setTable = useCallback(
    (el: HTMLTableElement | null) => {
      if (tableEl.current === el) return
      tableEl.current = el
      setMetrics(el ? measure(el) : null)
    },
    []
  )

  /** The table element containing a document position, via the rendered DOM. */
  const tableAt = useCallback(
    (pos: number): HTMLTableElement | null => {
      if (!editor) return null
      const { node } = editor.view.domAtPos(pos)
      const start = node instanceof Element ? node : node.parentElement
      return (start?.closest('table') as HTMLTableElement | null) ?? null
    },
    [editor]
  )

  // The controls follow the selection's table. The pointer can only *introduce* a
  // table (hovering one the caret is not in yet) — it never steals the rails away
  // from the table being edited, so they do not jump while typing.
  useEffect(() => {
    if (!editor) return

    const resolve = () => {
      if (!editor.isEditable) {
        setTable(null)
        setInfo(null)
        setActive(null)
        return
      }
      const selected = getTableInfo(editor)
      setInfo(selected)
      if (selected) {
        setTable(tableAt(editor.state.selection.from))
      } else {
        // The caret left the table: drop the rails with it. Without this they
        // linger over a table nobody is editing until the next scroll.
        setTable(null)
        setActive(null)
      }
    }

    const onSelectionUpdate = () => setTimeout(resolve, 10)
    editor.on('selectionUpdate', onSelectionUpdate)
    // Also on doc replacement: setContent does not reliably emit selectionUpdate,
    // which left a toolbar pointing at a table that no longer existed.
    editor.on('update', onSelectionUpdate)
    editor.on('transaction', scheduleMeasure)
    resolve()

    return () => {
      editor.off('selectionUpdate', onSelectionUpdate)
      editor.off('update', onSelectionUpdate)
      editor.off('transaction', scheduleMeasure)
    }
  }, [editor, scheduleMeasure, setTable, tableAt])

  // Pointer tracking: reveals the rails for a table the caret is not in yet.
  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom

    const onMove = (event: MouseEvent) => {
      if (!editor.isEditable) return
      // Selection wins: if the caret is in a table, that is the one with rails.
      if (getTableInfo(editor)) return
      const target = event.target as HTMLElement | null
      const el = (target?.closest?.('table') as HTMLTableElement | null) ?? null
      if (el) setTable(el)
    }

    dom.addEventListener('mousemove', onMove)
    return () => dom.removeEventListener('mousemove', onMove)
  }, [editor, setTable])

  useEffect(() => {
    const onScrollOrResize = () => scheduleMeasure()
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [scheduleMeasure])

  useEffect(() => {
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    }
  }, [])

  const refresh = useCallback(() => {
    if (!editor) return
    setInfo(getTableInfo(editor))
    scheduleMeasure()
  }, [editor, scheduleMeasure])

  if (!editor || !editor.isEditable || !metrics || metrics.rows.length === 0) return null

  const { table, rows, cols } = metrics

  const handle =
    'pointer-events-auto flex items-center justify-center rounded border border-border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground'

  return (
    <div className="fixed inset-0 z-40 pointer-events-none" data-testid="table-controls">
      {/* Row grips, left gutter */}
      {rows.map((r, index) => (
        <button
          key={`row-${index}`}
          type="button"
          data-testid={`table-row-grip-${index}`}
          aria-label={`Select row ${index + 1}`}
          title={index === 0 && info?.hasHeaderRow ? 'Header row' : `Row ${index + 1}`}
          className={`${handle} absolute`}
          style={{
            top: r.top + r.height / 2 - GRIP / 2,
            left: table.left - GRIP - GAP,
            width: GRIP,
            height: GRIP,
          }}
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            selectRow(editor, index)
            setActive({ kind: 'row', index })
            refresh()
          }}
        >
          <GripVertical size={12} />
        </button>
      ))}

      {/* Column grips, top gutter */}
      {cols.map((c, index) => (
        <button
          key={`col-${index}`}
          type="button"
          data-testid={`table-col-grip-${index}`}
          aria-label={`Select column ${index + 1}`}
          title={`Column ${index + 1}`}
          className={`${handle} absolute`}
          style={{
            top: table.top - GRIP - GAP,
            left: c.left + c.width / 2 - GRIP / 2,
            width: GRIP,
            height: GRIP,
          }}
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            selectColumn(editor, index)
            setActive({ kind: 'col', index })
            refresh()
          }}
        >
          <GripHorizontal size={12} />
        </button>
      ))}

      {/* Append a row at the bottom */}
      <button
        type="button"
        data-testid="table-append-row"
        aria-label="Add row"
        title="Add row"
        className={`${handle} absolute`}
        style={{
          top: table.bottom + GAP,
          left: table.left + table.width / 2 - GRIP / 2,
          width: GRIP,
          height: GRIP,
        }}
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          appendRow(editor)
          setActive(null)
          refresh()
        }}
      >
        <Plus size={12} />
      </button>

      {/* Append a column on the right */}
      <button
        type="button"
        data-testid="table-append-col"
        aria-label="Add column"
        title="Add column"
        className={`${handle} absolute`}
        style={{
          top: table.top + table.height / 2 - GRIP / 2,
          left: table.right + GAP,
          width: GRIP,
          height: GRIP,
        }}
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          appendColumn(editor)
          setActive(null)
          refresh()
        }}
      >
        <Plus size={12} />
      </button>

      {active && (
        <ActiveToolbar
          editor={editor}
          info={info}
          active={active}
          metrics={metrics}
          onAfterMove={(to) => {
            // Follow the row/column to its new index, so clicking move twice
            // moves the *same* one twice instead of grabbing whatever swapped in.
            setActive({ kind: active.kind, index: to })
            refresh()
          }}
          onAfterDelete={() => {
            setActive(null)
            refresh()
          }}
        />
      )}
    </div>
  )
}

function ActiveToolbar({
  editor,
  info,
  active,
  metrics,
  onAfterMove,
  onAfterDelete,
}: {
  editor: Editor
  info: TableInfo | null
  active: NonNullable<Active>
  metrics: Metrics
  onAfterMove: (to: number) => void
  onAfterDelete: () => void
}) {
  const isRow = active.kind === 'row'
  const anchor = isRow ? metrics.rows[active.index] : metrics.cols[active.index]
  if (!anchor) return null

  const back = active.index - 1
  const forward = active.index + 1

  const canBack = isRow
    ? canMoveRow(info, active.index, back)
    : canMoveColumn(info, active.index, back)
  const canForward = isRow
    ? canMoveRow(info, active.index, forward)
    : canMoveColumn(info, active.index, forward)
  // Deleting the last row or column removes the table outright, so say so rather
  // than letting the button look like it only drops one line.
  const removeLabel = isRow
    ? canDeleteRow(info)
      ? 'Delete row'
      : 'Delete table'
    : canDeleteColumn(info)
      ? 'Delete column'
      : 'Delete table'

  const btn =
    'pointer-events-auto h-7 w-7 flex items-center justify-center rounded text-muted-foreground transition-colors enabled:hover:bg-accent enabled:hover:text-accent-foreground disabled:opacity-40'

  const move = (to: number) => {
    const ok = isRow ? moveRow(editor, active.index, to) : moveColumn(editor, active.index, to)
    if (ok) onAfterMove(to)
  }

  return (
    <div
      data-testid="table-active-toolbar"
      className="pointer-events-auto absolute z-50 flex items-center gap-0.5 rounded-md border border-border bg-background p-1 shadow-md animate-in fade-in-0 zoom-in-95"
      // Clear the grip rails rather than sitting on them. The column toolbar in
      // particular used to land on top of the column grips (both are in the strip
      // just above the table), so selecting one column made every other column's
      // grip unclickable — the toolbar swallowed the clicks.
      style={
        isRow
          ? { top: anchor.top + anchor.height / 2 - 18, left: metrics.table.left - ROW_TOOLBAR_OFFSET }
          : { top: metrics.table.top - COL_TOOLBAR_OFFSET, left: anchor.left + anchor.width / 2 - 52 }
      }
    >
      <button
        type="button"
        className={btn}
        disabled={!canBack}
        data-testid="table-move-back"
        aria-label={isRow ? 'Move row up' : 'Move column left'}
        title={isRow ? 'Move row up' : 'Move column left'}
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (canBack) move(back)
        }}
      >
        {isRow ? <ArrowUp size={14} /> : <ArrowLeft size={14} />}
      </button>
      <button
        type="button"
        className={btn}
        disabled={!canForward}
        data-testid="table-move-forward"
        aria-label={isRow ? 'Move row down' : 'Move column right'}
        title={isRow ? 'Move row down' : 'Move column right'}
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (canForward) move(forward)
        }}
      >
        {isRow ? <ArrowDown size={14} /> : <ArrowRight size={14} />}
      </button>
      <div className="mx-0.5 h-5 w-px bg-border" />
      <button
        type="button"
        className={`${btn} text-destructive enabled:hover:bg-destructive/10 enabled:hover:text-destructive`}
        // Always actionable while we have a table: with more than one row/column
        // this removes one, and with exactly one it removes the table.
        disabled={!info}
        data-testid="table-delete"
        aria-label={removeLabel}
        title={removeLabel}
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (isRow) deleteRow(editor, active.index)
          else deleteColumn(editor, active.index)
          onAfterDelete()
        }}
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}
