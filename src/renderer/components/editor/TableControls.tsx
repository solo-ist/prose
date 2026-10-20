/**
 * Table editing affordances (#1060), revealed on hover (#1087).
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
 *
 * **Visibility is the pointer's business, not the caret's.** The first build
 * showed every grip for as long as the caret sat anywhere in the table, which
 * put a row of small bordered boxes in the band directly above the header row
 * for the whole editing session — read in QA as a malformed table rather than as
 * controls (#1087). Hover-reveal is what the design called for and what Notion,
 * Confluence and Google Docs do. The one non-hover case is a live CellSelection:
 * a selected row or column keeps its rails and toolbar up while the pointer goes
 * to them, which is also the only way a keyboard/shift-click user reaches them.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { CellSelection } from '@tiptap/pm/tables'
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
/**
 * How far outside the table the pointer may stray with the rails still up. The
 * grips live in a gutter *outside* the table box, so a bare hit test on the
 * table's own rect would drop them the instant the pointer moved onto one.
 */
const HOVER_PAD = GRIP + GAP + 8

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
  // Whether the pointer is over the measured table (or its rail gutter).
  const [hovering, setHovering] = useState(false)
  // The element the overlay is measured from. A ref, not state: the rAF below
  // reads it without needing a re-render to see the latest value.
  const tableEl = useRef<HTMLTableElement | null>(null)
  const frame = useRef<number | null>(null)
  // Mirror of `metrics` for the pointer handler, which runs on every mousemove:
  // reading the cached rect avoids forcing a layout per event, and it cannot go
  // stale without a scroll, resize or transaction — each of which re-measures.
  const metricsRef = useRef<Metrics | null>(null)

  const applyMetrics = useCallback((m: Metrics | null) => {
    metricsRef.current = m
    setMetrics(m)
  }, [])

  /** Coalesce measurement into one rAF — scroll, resize and transactions all drive it. */
  const scheduleMeasure = useCallback(() => {
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      const el = tableEl.current
      applyMetrics(el && el.isConnected ? measure(el) : null)
    })
  }, [applyMetrics])

  const setTable = useCallback(
    (el: HTMLTableElement | null) => {
      if (tableEl.current === el) return
      tableEl.current = el
      applyMetrics(el ? measure(el) : null)
    },
    [applyMetrics]
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

  // The selection only matters here for a *structural* selection: a row or column
  // grabbed from a grip. The pointer decides what is on screen (see the hover
  // effect below), so an ordinary caret move inside a table reveals nothing — it
  // only dismisses the toolbar belonging to a selection that no longer exists.
  useEffect(() => {
    if (!editor) return

    const resolve = () => {
      if (!editor.isEditable) {
        setTable(null)
        setInfo(null)
        setActive(null)
        setHovering(false)
        return
      }
      setInfo(getTableInfo(editor))
      if (!(editor.state.selection instanceof CellSelection)) {
        // Typing in a cell, or clicking into one, ends the row/column selection
        // the toolbar was acting on. Leave `table` alone: the pointer may still
        // be over it, and re-measuring on every keystroke would only make the
        // rails jitter.
        setActive(null)
        return
      }
      setTable(tableAt(editor.state.selection.from))
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

  // Pointer tracking — the thing that reveals the rails.
  //
  // Bound to the document, not to the editor's DOM, and the fallback is
  // geometric rather than target-based: the controls sit in an overlay *above*
  // the editor with `pointer-events: auto`, so the moment the pointer reaches a
  // grip the editor stops seeing mousemove at all. A hit test against the
  // table's rect padded by HOVER_PAD keeps the rails up across that gap.
  useEffect(() => {
    if (!editor) return

    const onMove = (event: MouseEvent) => {
      if (!editor.isEditable) {
        setHovering(false)
        return
      }
      const target = event.target as HTMLElement | null
      const hit = (target?.closest?.('table') as HTMLTableElement | null) ?? null
      if (hit && editor.view.dom.contains(hit)) {
        // A live row/column selection owns the overlay. Re-measuring onto a
        // second table under the pointer would leave the toolbar acting on the
        // selected table through the hovered one's geometry.
        if (active && hit !== tableEl.current) return
        setTable(hit)
        setHovering(true)
        return
      }
      const el = tableEl.current
      const r = metricsRef.current?.table
      if (!el || !el.isConnected || !r) {
        setHovering(false)
        return
      }
      setHovering(
        event.clientX >= r.left - HOVER_PAD &&
          event.clientX <= r.right + HOVER_PAD &&
          event.clientY >= r.top - HOVER_PAD &&
          event.clientY <= r.bottom + HOVER_PAD
      )
    }

    // The pointer leaving the window fires no further mousemove, so without this
    // the rails would stay up on whatever table it left over.
    const onLeave = () => setHovering(false)

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseleave', onLeave)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseleave', onLeave)
    }
  }, [editor, setTable, active])

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
  // Hover reveals; a live row/column selection pins. Nothing else shows a grip —
  // in particular the caret sitting in a cell does not (#1087).
  if (!hovering && !active) return null

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
