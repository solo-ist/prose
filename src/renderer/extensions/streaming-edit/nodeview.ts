/**
 * Node View for Streaming Edit
 *
 * Provides a custom rendering for the streaming edit node,
 * showing original text struck through and new text appearing.
 */

import type { NodeView } from '@tiptap/pm/view'
import type { Node } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import type { StreamingEditOptions } from './types'

export class StreamingEditNodeView implements NodeView {
  dom: HTMLElement
  private node: Node
  private view: EditorView
  private getPos: () => number | undefined
  private options: Partial<StreamingEditOptions>

  constructor(
    node: Node,
    view: EditorView,
    getPos: () => number | undefined,
    options: Partial<StreamingEditOptions> = {}
  ) {
    this.node = node
    this.view = view
    this.getPos = getPos
    this.options = options

    this.dom = document.createElement('span')
    this.dom.setAttribute('data-streaming-edit', '')
    this.dom.setAttribute('data-streaming-id', node.attrs.id || '')
    this.dom.setAttribute('contenteditable', 'false')

    if (options.className) {
      this.dom.className = options.className
    }

    this.render()
  }

  private render(): void {
    const { originalText, streamedText, isComplete } = this.node.attrs

    // Clear previous content
    this.dom.innerHTML = ''

    // Original text (struck through)
    if (originalText) {
      const originalSpan = document.createElement('span')
      originalSpan.className = 'streaming-edit-original'
      originalSpan.textContent = originalText
      this.dom.appendChild(originalSpan)
    }

    // Streamed text (new content)
    if (streamedText) {
      const newSpan = document.createElement('span')
      newSpan.className = 'streaming-edit-new'
      newSpan.textContent = streamedText
      this.dom.appendChild(newSpan)
    }

    // Cursor (if still streaming)
    if (!isComplete) {
      const cursorSpan = document.createElement('span')
      cursorSpan.className = 'streaming-cursor'
      this.dom.appendChild(cursorSpan)
    }
  }

  update(node: Node): boolean {
    if (node.type !== this.node.type) {
      return false
    }

    this.node = node
    this.render()
    return true
  }

  destroy(): void {
    // Cleanup if needed
  }
}
