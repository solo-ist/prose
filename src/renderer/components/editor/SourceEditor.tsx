import { useEffect, useRef, useState } from 'react'
import { EditorView } from '@codemirror/view'
import { unfoldAll } from '@codemirror/language'
import { useEditorStore } from '../../stores/editorStore'
import {
  appearanceCompartment,
  appearanceExtensions,
  foldAllHeadingsEffects,
  readOnlyCompartment,
  readOnlyExtension,
  sourceFolds,
  transactionTouchesFolds,
  type SourceState
} from '../../extensions/source/state'

interface SourceEditorProps {
  /** The tab's CodeMirror state (document/session.ts); read once, at mount. */
  state: SourceState
  /** Every transaction's resulting state, for the session to keep. */
  onState: (state: SourceState) => void
  /** The scroll offset to come back to, and where it goes while scrolling. */
  scrollTop: number
  onScroll: (scrollTop: number) => void
  fontSize: number
  lineHeight: number
  fontFamily: string
  readOnly: boolean
}

/**
 * The source surface (#1150): a CodeMirror view over the state its tab's
 * session holds. The view is created once per mount with that state and
 * hands every resulting state back through `onState`; the appearance and
 * the read-only flag are compartments reconfigured in place when the
 * settings change, so nothing rebuilds the state (caret, folds and history
 * stay). The theme reads CSS variables, so a light/dark switch needs no
 * reconfigure. The entry text is the state's initial document, not an undo
 * step.
 */
export function SourceEditor({
  state,
  onState,
  scrollTop,
  onScroll,
  fontSize,
  lineHeight,
  fontFamily,
  readOnly
}: SourceEditorProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const foldButtonRef = useRef<HTMLButtonElement | null>(null)
  const foldToggleRef = useRef<(() => void) | null>(null)
  const onStateRef = useRef(onState)
  onStateRef.current = onState
  const [allFolded, setAllFolded] = useState(() => sourceFolds(state).length > 0)

  // Create the view once, over the session's state.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const view = new EditorView({
      state,
      parent: host,
      dispatchTransactions: (trs, v) => {
        v.update(trs)
        const next = v.state
        if (trs.some((tr) => tr.selection !== undefined || tr.docChanged)) {
          const pos = next.selection.main.head
          const line = next.doc.lineAt(pos)
          useEditorStore.getState().setCursorPosition(line.number, pos - line.from + 1)
        }
        onStateRef.current(next)
        if (trs.some((tr) => tr.docChanged || transactionTouchesFolds(tr))) setAllFolded(sourceFolds(next).length > 0)
      }
    })
    viewRef.current = view

    // Insert fold-all button into .cm-editor before .cm-scroller
    const foldBtn = document.createElement('button')
    foldBtn.className = 'fold-all-toggle'
    foldBtn.type = 'button'
    foldBtn.textContent = '▾'
    foldBtn.title = 'Fold all'
    foldBtn.ariaLabel = 'Fold all'
    foldBtn.addEventListener('click', () => {
      foldToggleRef.current?.()
    })
    const scroller = view.dom.querySelector('.cm-scroller')
    if (scroller) view.dom.insertBefore(foldBtn, scroller)
    foldButtonRef.current = foldBtn

    // After the first paint: the scroller has its full height only once
    // CodeMirror has laid its lines out, so a synchronous set would no-op.
    const restore = requestAnimationFrame(() => {
      if (scrollerRef.current) scrollerRef.current.scrollTop = scrollTop
    })

    return () => {
      cancelAnimationFrame(restore)
      onStateRef.current(view.state)
      view.destroy()
      viewRef.current = null
    }
    // The state and the scroll offset are read at mount only; the settings
    // reach the live view through the compartments below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: appearanceCompartment.reconfigure(appearanceExtensions({ fontSize, lineHeight, fontFamily }))
    })
  }, [fontSize, lineHeight, fontFamily])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: readOnlyCompartment.reconfigure(readOnlyExtension(readOnly)) })
  }, [readOnly])

  /**
   * Outline fold: collapse body content under each heading so only
   * heading lines remain visible, like a document outline.
   */
  foldToggleRef.current = () => {
    const view = viewRef.current
    if (!view) return
    if (sourceFolds(view.state).length > 0) {
      unfoldAll(view)
      return
    }
    const effects = foldAllHeadingsEffects(view.state)
    if (effects.length > 0) view.dispatch({ effects })
  }

  // Sync button text/title with the fold state
  useEffect(() => {
    if (foldButtonRef.current) {
      foldButtonRef.current.textContent = allFolded ? '▸' : '▾'
      foldButtonRef.current.title = allFolded ? 'Unfold all' : 'Fold all'
      foldButtonRef.current.ariaLabel = allFolded ? 'Unfold all' : 'Fold all'
    }
  }, [allFolded])

  return (
    <div
      ref={scrollerRef}
      className="flex-1 overflow-auto px-12 py-6"
      style={{ fontSize: `${fontSize}px`, lineHeight, fontFamily }}
      onScroll={(e) => onScroll((e.currentTarget as HTMLDivElement).scrollTop)}
    >
      <div className="max-w-3xl mx-auto">
        <div ref={hostRef} className="source-editor h-full [&_.cm-editor]:h-full [&_.cm-editor]:outline-hidden" />
      </div>
    </div>
  )
}
