import { useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { EditorState } from '@codemirror/state'
import { keymap } from '@codemirror/view'
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
      padding: '0',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'hsl(var(--foreground))',
    },
    '.cm-gutters': {
      fontFamily,
      fontSize: `${fontSize}px`,
      backgroundColor: 'transparent',
      color: 'hsl(var(--muted-foreground) / 0.4)',
      borderRight: 'none',
      minWidth: '2em',
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

    const extensions = [
      basicSetup,
      markdown({ codeLanguages: languages }),
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

  return (
    <div
      ref={containerRef}
      className="source-editor h-full [&_.cm-editor]:h-full [&_.cm-editor]:outline-none"
    />
  )
})
