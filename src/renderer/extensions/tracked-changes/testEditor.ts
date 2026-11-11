/**
 * A headless editor for the tracked-changes unit tests (#891): the app's own
 * extension list, a document from markdown, the filter installed and
 * Suggesting mode on.
 */

import { Editor, createDocument } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { createEditorExtensions } from '../../components/editor/extensions'
import { installTrackedDispatch } from './extension'
import { setSuggestingIn } from './transactions'
import { trackedMarkOf, kindOf } from './changes'
import type { RefusalReason } from './filter'

export interface TestEditor {
  editor: Editor
  refusals: RefusalReason[]
}

export function makeEditor(markdown: string, opts: { suggesting?: boolean } = {}): TestEditor {
  const refusals: RefusalReason[] = []
  const editor = new Editor({ extensions: createEditorExtensions({ onTrackedRefused: (r) => refusals.push(r) }), content: '' })
  const html = (editor.storage.markdown as { parser: { parse: (s: string) => string } }).parser.parse(markdown)
  const doc = createDocument(html, editor.schema)
  editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, doc.content).setMeta('addToHistory', false))
  installTrackedDispatch(editor)
  if (opts.suggesting !== false) editor.view.dispatch(setSuggestingIn(editor.state.tr, true))
  return { editor, refusals }
}

/** The position just after the first occurrence of `text` in the document. */
export function after(editor: Editor, text: string): number {
  let at = -1
  editor.state.doc.descendants((node, pos) => {
    if (at === -1 && node.isText && node.text!.includes(text)) at = pos + node.text!.indexOf(text) + text.length
    return at === -1
  })
  if (at === -1) throw new Error(`no "${text}" in the document`)
  return at
}

export function before(editor: Editor, text: string): number {
  return after(editor, text) - text.length
}

export function cursor(editor: Editor, pos: number): void {
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)))
}

export function select(editor: Editor, from: number, to: number): void {
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)))
}

/** The writer types `text` at the caret, as the view's input does. */
export function type(editor: Editor, text: string): void {
  const { from, to } = editor.state.selection
  editor.view.dispatch(editor.state.tr.insertText(text, from, to))
}

/** The document's inline content as `text[ins:id]` / `text[del:id]` runs, one string per textblock. */
export function runs(doc: PMNode): string[] {
  const blocks: string[] = []
  doc.descendants((node) => {
    if (!node.isTextblock) return true
    const parts: string[] = []
    node.forEach((child) => {
      const mark = trackedMarkOf(child.marks)
      const text = child.isText ? child.text! : `<${child.type.name}>`
      parts.push(mark ? `[${kindOf(mark) === 'insert' ? '+' : '-'}${text}]` : text)
    })
    blocks.push(parts.join(''))
    return false
  })
  return blocks
}

export function idsOf(doc: PMNode): string[] {
  const ids: string[] = []
  doc.descendants((node) => {
    const mark = trackedMarkOf(node.marks)
    if (mark && !ids.includes(mark.attrs.id as string)) ids.push(mark.attrs.id as string)
    return true
  })
  return ids
}
