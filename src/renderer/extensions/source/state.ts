/**
 * The CodeMirror state of a document in source mode (#1150).
 *
 * A tab in source mode keeps its CodeMirror `EditorState` on its session,
 * so a switch to another tab and back brings the caret, the folds and the
 * source undo history back. Extensions are part of a CodeMirror state, so
 * everything here is module-level: the base set the session builds the
 * state with, and two compartments the `SourceEditor` reconfigures on the
 * live view for the appearance (theme, font) and the read-only flag, so a
 * settings change never rebuilds the state. Nothing here closes over a
 * component.
 */

import { Compartment, EditorState, type Extension, type Range, type StateEffect } from '@codemirror/state'
import { EditorView, basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { HighlightStyle, syntaxHighlighting, foldEffect, foldedRanges } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { keymap, ViewPlugin, Decoration, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'

export type SourceState = EditorState

export interface SourceAppearance {
  fontSize: number
  lineHeight: number
  fontFamily: string
}

/** Reconfigured on the live view when the settings change. */
export const appearanceCompartment = new Compartment()
export const readOnlyCompartment = new Compartment()

/**
 * Marks lines within YAML frontmatter (between opening and closing ---) with
 * a CSS class so they can be styled smaller than body content.
 */
const frontmatterDeco = Decoration.line({ class: 'cm-frontmatter' })

function buildFrontmatterDecorations(doc: { lines: number; line: (n: number) => { text: string; from: number } }): DecorationSet {
  const widgets: Range<Decoration>[] = []
  const ranges: { from: number }[] = []
  if (doc.lines < 1) return Decoration.none
  // Frontmatter must start on line 1 with ---
  if (doc.line(1).text.trim() !== '---') return Decoration.none
  ranges.push({ from: doc.line(1).from })
  for (let i = 2; i <= doc.lines; i++) {
    const line = doc.line(i)
    ranges.push({ from: line.from })
    if (line.text.trim() === '---') break
  }
  for (const r of ranges) {
    widgets.push(frontmatterDeco.range(r.from))
  }
  return Decoration.set(widgets)
}

const frontmatterPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: { state: { doc: { lines: number; line: (n: number) => { text: string; from: number } } } }) {
    this.decorations = buildFrontmatterDecorations(view.state.doc)
  }
  update(update: ViewUpdate) {
    if (update.docChanged) {
      this.decorations = buildFrontmatterDecorations(update.state.doc)
    }
  }
}, { decorations: (v) => v.decorations })

// Block folding on line 1 when it's an H1 — folding the title hides the entire doc.
// foldService can't veto other services, so we intercept the transaction instead.
const blockLine1H1Fold = EditorState.transactionFilter.of((tr) => {
  if (!tr.effects.length) return tr
  const doc = tr.startState.doc
  if (doc.lines < 1 || !/^#\s/.test(doc.line(1).text)) return tr
  const line1End = doc.line(1).to
  const hasLine1Fold = tr.effects.some((e) => e.is(foldEffect) && e.value.from === line1End)
  if (!hasLine1Fold) return tr
  // Strip fold effects targeting line 1's H1, keep everything else
  const kept = tr.effects.filter((e) => !(e.is(foldEffect) && e.value.from === line1End))
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

/**
 * Custom CodeMirror theme that matches the app's native look.
 * Uses CSS variables so it works in both light and dark mode.
 */
function createAppTheme({ fontSize, lineHeight, fontFamily }: SourceAppearance): Extension {
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
      backgroundColor: 'hsl(var(--selection))',
    },
    '.cm-scroller': {
      overflow: 'auto',
    },
    '.cm-foldGutter': {
      color: 'hsl(var(--muted-foreground) / 0.3)',
    },
    // Frontmatter lines: smaller, muted, mono — distinct from body content
    '.cm-line.cm-frontmatter': {
      fontSize: '0.75em',
      color: 'hsl(var(--muted-foreground))',
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

/** The appearance compartment's content for the current settings. */
export function appearanceExtensions(appearance: SourceAppearance): Extension {
  return [createAppTheme(appearance), syntaxHighlighting(appHighlightStyle)]
}

export function readOnlyExtension(on: boolean): Extension {
  return on ? EditorState.readOnly.of(true) : []
}

const baseExtensions: Extension = [
  basicSetup,
  markdown({ codeLanguages: languages }),
  blockLine1H1Fold,
  hideLine1FoldMarker,
  frontmatterPlugin,
  keymap.of([indentWithTab]),
  EditorView.lineWrapping
]

/**
 * A source state over `text`, which is its initial document (not an undo
 * step). The compartments start empty (or with the given appearance), so a
 * session can build a state before any view shows it.
 */
export function buildSourceState(
  text: string,
  opts: { appearance?: SourceAppearance; readOnly?: boolean } = {}
): SourceState {
  return EditorState.create({
    doc: text,
    extensions: [
      baseExtensions,
      appearanceCompartment.of(opts.appearance ? appearanceExtensions(opts.appearance) : []),
      readOnlyCompartment.of(readOnlyExtension(opts.readOnly ?? false))
    ]
  })
}

export function sourceText(state: SourceState): string {
  return state.doc.toString()
}

export function sourceSelection(state: SourceState): { anchor: number; head: number } {
  const { anchor, head } = state.selection.main
  return { anchor, head }
}

/** The folded ranges, as `[from, to]` pairs in document order. */
export function sourceFolds(state: SourceState): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const cursor = foldedRanges(state).iter()
  while (cursor.value) {
    out.push([cursor.from, cursor.to])
    cursor.next()
  }
  return out
}

/**
 * Outline fold: the effects that collapse the body under each heading so
 * only heading lines remain visible. Skips line 1 when it is an H1 (folding
 * that would hide the whole document).
 */
export function foldAllHeadingsEffects(state: SourceState): StateEffect<unknown>[] {
  const doc = state.doc
  const headingPattern = /^#{1,6}\s/
  const headingLines: number[] = []
  for (let i = 1; i <= doc.lines; i++) {
    if (headingPattern.test(doc.line(i).text)) headingLines.push(i)
  }
  if (headingLines.length === 0) return []
  const effects: StateEffect<unknown>[] = []
  const line1IsH1 = headingLines[0] === 1 && /^#\s/.test(doc.line(1).text)
  for (let i = 0; i < headingLines.length; i++) {
    if (i === 0 && line1IsH1) continue
    const headingLine = doc.line(headingLines[i])
    const nextHeadingLineNum = headingLines[i + 1]
    const foldEnd = nextHeadingLineNum ? doc.line(nextHeadingLineNum - 1).to : doc.line(doc.lines).to
    if (headingLine.to < foldEnd) effects.push(foldEffect.of({ from: headingLine.to, to: foldEnd }))
  }
  return effects
}
