import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { HighlightStyle, syntaxHighlighting, unfoldAll, foldEffect } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { EditorState } from '@codemirror/state'
import { keymap, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { useEditorStore } from '../../stores/editorStore'

export interface SourceEditorHandle {
  getContent: () => string
}

interface SourceEditorProps {
  content: string
  onChange: (content: string) => void
  fontSize: number
  lineHeight: number
  fontFamily: string
  isDark: boolean
  readOnly: boolean
}

/**
 * Custom CodeMirror theme that matches the app's native look.
 * Uses CSS variables so it works in both light and dark mode.
 */
function createAppTheme(fontSize: number, lineHeight: number, fontFamily: string) {
  return EditorView.theme({
    '&': {
      fontSize: `${fontSize}px`,
      fontFamily,
      backgroundColor: 'transparent',
    },
    '.cm-content': {
      fontFamily,
      lineHeight: String(lineHeight),
      caretColor: 'hsl(var(--foreground))',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'hsl(var(--foreground))',
    },
    '.cm-gutters': {
      fontFamily,
      fontSize: `${fontSize}px`,
      backgroundColor: 'transparent',
      color: 'hsl(var(--muted-foreground) / 0.2)',
      borderRight: 'none',
      minWidth: '3em',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
      color: 'hsl(var(--muted-foreground))',
    },
    '.cm-activeLine': {
      backgroundColor: 'hsl(var(--muted) / 0.3)',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: 'hsl(var(--primary) / 0.15)',
    },
    '.cm-scroller': {
      overflow: 'auto',
    },
    '.cm-foldGutter': {
      color: 'hsl(var(--muted-foreground) / 0.3)',
    },
  })
}

/**
 * Syntax highlighting that uses muted tones for markdown punctuation
 * and foreground for content text, matching the WYSIWYG rendering.
 */
const appHighlightStyle = HighlightStyle.define([
  // Headings: bold, tighter line-height to match WYSIWYG
  { tag: tags.heading1, fontWeight: '600', fontSize: '2em', lineHeight: '1.3' },
  { tag: tags.heading2, fontWeight: '600', fontSize: '1.5em', lineHeight: '1.3' },
  { tag: tags.heading3, fontWeight: '600', fontSize: '1.25em', lineHeight: '1.3' },
  { tag: tags.heading4, fontWeight: '600', fontSize: '1.1em', lineHeight: '1.3' },
  { tag: tags.heading5, fontWeight: '600', lineHeight: '1.3' },
  { tag: tags.heading6, fontWeight: '600', lineHeight: '1.3' },
  // Markdown meta/punctuation (#, **, >, -, etc.) — muted
  { tag: tags.processingInstruction, color: 'hsl(var(--muted-foreground))' },
  { tag: tags.contentSeparator, color: 'hsl(var(--muted-foreground))' },
  // Emphasis and strong
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  // Links
  { tag: tags.link, color: 'hsl(var(--primary))', textDecoration: 'underline' },
  { tag: tags.url, color: 'hsl(var(--muted-foreground))' },
  // Code
  { tag: tags.monospace, color: 'hsl(var(--muted-foreground))' },
  // Quotes
  { tag: tags.quote, color: 'hsl(var(--muted-foreground))', fontStyle: 'italic' },
  // Lists
  { tag: tags.list, color: 'hsl(var(--muted-foreground))' },
])

export const SourceEditor = forwardRef<SourceEditorHandle, SourceEditorProps>(function SourceEditor({
  content,
  onChange,
  fontSize,
  lineHeight,
  fontFamily,
  isDark,
  readOnly
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const foldButtonRef = useRef<HTMLButtonElement | null>(null)
  const foldToggleRef = useRef<(() => void) | null>(null)
  const [allFolded, setAllFolded] = useState(false)

  useImperativeHandle(ref, () => ({
    getContent: () => viewRef.current?.state.doc.toString() ?? content,
  }))
  const onChangeRef = useRef(onChange)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Track whether we're programmatically updating the doc (to skip onChange)
  const isExternalUpdate = useRef(false)

  // Keep onChange ref current
  onChangeRef.current = onChange

  const debouncedOnChange = useCallback((value: string) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }
    debounceRef.current = setTimeout(() => {
      onChangeRef.current(value)
    }, 500)
  }, [])

  // Create CodeMirror instance on mount
  useEffect(() => {
    if (!containerRef.current) return

    const appTheme = createAppTheme(fontSize, lineHeight, fontFamily)

    // Block folding on line 1 when it's an H1 — folding the title hides the entire doc.
    // foldService can't veto other services, so we intercept the transaction instead.
    const blockLine1H1Fold = EditorState.transactionFilter.of((tr) => {
      if (!tr.effects.length) return tr
      const doc = tr.startState.doc
      if (doc.lines < 1 || !/^#\s/.test(doc.line(1).text)) return tr
      const line1End = doc.line(1).to
      const hasLine1Fold = tr.effects.some(
        (e) => e.is(foldEffect) && e.value.from === line1End
      )
      if (!hasLine1Fold) return tr
      // Strip fold effects targeting line 1's H1, keep everything else
      const kept = tr.effects.filter(
        (e) => !(e.is(foldEffect) && e.value.from === line1End)
      )
      // Return a replacement spec — NOT [tr, spec] which would apply both
      return { effects: kept }
    })

    // Hide the fold gutter chevron on line 1 when it's an H1.
    // Both gutters render elements in the same order, so we match by index.
    const hideLine1FoldMarker = ViewPlugin.fromClass(class {
      update(update: ViewUpdate) {
        const doc = update.state.doc
        if (doc.lines < 1 || !/^#\s/.test(doc.line(1).text)) return
        const lineNumGutter = update.view.dom.querySelector('.cm-gutter.cm-lineNumbers')
        const foldGutter = update.view.dom.querySelector('.cm-gutter.cm-foldGutter')
        if (!lineNumGutter || !foldGutter) return
        const lineNumEls = lineNumGutter.querySelectorAll('.cm-gutterElement')
        const foldEls = foldGutter.querySelectorAll('.cm-gutterElement')
        // Find which index corresponds to line number "1"
        for (let i = 0; i < lineNumEls.length; i++) {
          if (lineNumEls[i].textContent?.trim() === '1') {
            if (i < foldEls.length) {
              (foldEls[i] as HTMLElement).style.visibility = 'hidden'
            }
            break
          }
        }
      }
    })

    const extensions = [
      basicSetup,
      markdown({ codeLanguages: languages }),
      blockLine1H1Fold,
      hideLine1FoldMarker,
      keymap.of([indentWithTab]),
      appTheme,
      syntaxHighlighting(appHighlightStyle),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        // Report cursor position
        if (update.selectionSet || update.docChanged) {
          const pos = update.state.selection.main.head
          const line = update.state.doc.lineAt(pos)
          useEditorStore.getState().setCursorPosition(line.number, pos - line.from + 1)
        }
        // Fire onChange on document changes (skip external updates)
        if (update.docChanged && !isExternalUpdate.current) {
          debouncedOnChange(update.state.doc.toString())
        }
      }),
    ]

    if (readOnly) {
      extensions.push(EditorState.readOnly.of(true))
    }

    const state = EditorState.create({
      doc: content,
      extensions,
    })

    const view = new EditorView({
      state,
      parent: containerRef.current,
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

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
      view.destroy()
      viewRef.current = null
    }
    // Only recreate on theme/font/readOnly changes — content sync handled separately
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark, fontSize, lineHeight, fontFamily, readOnly])

  // Sync content when it changes externally (e.g., tab switch)
  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    const currentContent = view.state.doc.toString()
    if (content !== currentContent) {
      isExternalUpdate.current = true
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: content,
        },
      })
      isExternalUpdate.current = false
    }
  }, [content])

  /**
   * Outline fold: collapse body content under each heading so only
   * heading lines remain visible, like a document outline.
   * Skips line 1 if it's an H1 — folding that would hide the whole doc.
   */
  const handleToggleFoldAll = useCallback(() => {
    const view = viewRef.current
    if (!view) return

    if (allFolded) {
      unfoldAll(view)
      setAllFolded(false)
      return
    }

    const doc = view.state.doc
    const headingPattern = /^#{1,6}\s/
    const headingLines: number[] = []

    for (let i = 1; i <= doc.lines; i++) {
      if (headingPattern.test(doc.line(i).text)) {
        headingLines.push(i)
      }
    }

    if (headingLines.length === 0) return

    const effects: ReturnType<typeof foldEffect.of>[] = []

    // Skip line-1 H1: folding it collapses the entire document
    const line1IsH1 = headingLines[0] === 1 && /^#\s/.test(doc.line(1).text)

    for (let i = 0; i < headingLines.length; i++) {
      if (i === 0 && line1IsH1) continue // skip the title heading

      const headingLine = doc.line(headingLines[i])
      const nextHeadingLineNum = headingLines[i + 1]
      const foldEnd = nextHeadingLineNum
        ? doc.line(nextHeadingLineNum - 1).to
        : doc.line(doc.lines).to

      if (headingLine.to < foldEnd) {
        effects.push(foldEffect.of({ from: headingLine.to, to: foldEnd }))
      }
    }

    if (effects.length > 0) {
      view.dispatch({ effects })
      setAllFolded(true)
    }
  }, [allFolded])

  // Keep fold toggle ref current for the imperative button's click handler
  foldToggleRef.current = handleToggleFoldAll

  // Sync button text/title with allFolded state
  useEffect(() => {
    if (foldButtonRef.current) {
      foldButtonRef.current.textContent = allFolded ? '▸' : '▾'
      foldButtonRef.current.title = allFolded ? 'Unfold all' : 'Fold all'
      foldButtonRef.current.ariaLabel = allFolded ? 'Unfold all' : 'Fold all'
    }
  }, [allFolded])

  return (
    <div ref={containerRef} className="source-editor h-full [&_.cm-editor]:h-full [&_.cm-editor]:outline-none" />
  )
})
