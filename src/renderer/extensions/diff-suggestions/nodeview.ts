/**
 * Diff Suggestions Extension for TipTap
 *
 * Originally from: https://github.com/bsachinthana/tiptap-diff-suggestions
 * Author: Buddhima Sachinthana (@buddhima_a)
 * License: MIT
 *
 * Vendored and modified for Prose by solo.ist
 */

import type { NodeView } from '@tiptap/pm/view'
import type { Node } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import type {
  DiffSuggestionMeta,
  DiffSuggestionOptions,
  DiffSuggestionActionMeta,
} from './types'
import { computeWordDiff, createWordDiffAnnotations } from '../../lib/diffUtils'

export class DiffSuggestionNodeView implements NodeView {
  dom: HTMLElement
  private node: Node
  private view: EditorView
  private getPos: () => number | undefined
  private options: Partial<DiffSuggestionOptions>

  constructor(
    node: Node,
    view: EditorView,
    getPos: () => number | undefined,
    options: Partial<DiffSuggestionOptions> = {}
  ) {
    this.node = node
    this.view = view
    this.getPos = getPos
    this.options = options

    this.dom = document.createElement('span')
    this.dom.setAttribute('data-diff-suggestion', '')
    this.dom.setAttribute('data-diff-suggestion-id', node.attrs.id)
    this.dom.setAttribute('data-diff-suggestion-comment', node.attrs.comment || '')
    this.dom.setAttribute('contenteditable', 'false')

    if (options.className) {
      this.dom.className = options.className
    }

    this.render()
  }

  private render(): void {
    const { originalText, suggestedText } = this.node.attrs

    const contentWrapper = document.createElement('span')
    contentWrapper.className = 'diff-suggestion-content'

    // Compute word-level diff for enhanced visualization
    const diff = computeWordDiff(originalText || '', suggestedText || '')

    // Render old text with word-level highlighting
    const oldSpan = document.createElement('span')
    oldSpan.setAttribute('data-diff-suggestion-old', '')
    for (const segment of diff.old) {
      if (segment.type === 'removed') {
        const highlight = document.createElement('span')
        highlight.className = 'diff-word-removed'
        highlight.textContent = segment.text
        oldSpan.appendChild(highlight)
      } else {
        oldSpan.appendChild(document.createTextNode(segment.text))
      }
    }

    // Render new text with word-level highlighting
    const newSpan = document.createElement('span')
    newSpan.setAttribute('data-diff-suggestion-new', '')
    for (const segment of diff.new) {
      if (segment.type === 'added') {
        const highlight = document.createElement('span')
        highlight.className = 'diff-word-added'
        highlight.textContent = segment.text
        newSpan.appendChild(highlight)
      } else {
        newSpan.appendChild(document.createTextNode(segment.text))
      }
    }

    contentWrapper.appendChild(oldSpan)
    contentWrapper.appendChild(newSpan)

    const actionsContainer = this.createActionMenu()

    if (actionsContainer) {
      contentWrapper.appendChild(actionsContainer)
    }

    this.dom.innerHTML = ''
    this.dom.appendChild(contentWrapper)
  }

  private createActionMenu(): HTMLElement | null {
    if (this.options.showButtons === false) {
      return null
    }

    const { id, comment, originalText, suggestedText } = this.node.attrs
    const pos = this.getPos()

    if (pos === undefined) return null

    const meta: DiffSuggestionActionMeta = {
      id,
      comment,
      originalText: originalText || '',
      suggestedText: suggestedText || '',
      pos,
    }

    if (this.options.renderActionMenu) {
      const customMenu = this.options.renderActionMenu(meta)
      this.attachDefaultEventListeners(customMenu)
      return customMenu
    }

    return this.createDefaultToolbar()
  }

  private createDefaultToolbar(): HTMLElement {
    const actionsContainer = document.createElement('span')
    actionsContainer.className = 'diff-suggestion-action-container'

    const acceptButton = document.createElement('button')
    acceptButton.className = 'diff-accept-btn'
    acceptButton.setAttribute('data-diff-suggestion-toolbar-accept', '')
    acceptButton.textContent = this.getButtonText('accept') || '✓'
    acceptButton.title = 'Accept suggestion'
    acceptButton.type = 'button'

    const rejectButton = document.createElement('button')
    rejectButton.className = 'diff-reject-btn'
    rejectButton.setAttribute('data-diff-suggestion-toolbar-reject', '')
    rejectButton.textContent = this.getButtonText('reject') || '✗'
    rejectButton.title = 'Reject suggestion'
    rejectButton.type = 'button'

    actionsContainer.appendChild(acceptButton)
    actionsContainer.appendChild(rejectButton)

    this.attachDefaultEventListeners(actionsContainer)
    return actionsContainer
  }

  private getButtonText(type: 'accept' | 'reject'): string {
    if (this.options.buttons?.[type]) {
      const button = this.options.buttons[type]
      if (typeof button === 'string') {
        return button
      }
      return button.content
    }

    return ''
  }

  private attachDefaultEventListeners(container: HTMLElement): void {
    const acceptBtn = container.querySelector('[data-diff-suggestion-toolbar-accept]')
    const rejectBtn = container.querySelector('[data-diff-suggestion-toolbar-reject]')

    if (acceptBtn) {
      acceptBtn.addEventListener('click', this.handleAccept.bind(this))
    }
    if (rejectBtn) {
      rejectBtn.addEventListener('click', this.handleReject.bind(this))
    }
  }

  private createMeta(action: 'accept' | 'reject'): DiffSuggestionMeta {
    const pos = this.getPos()
    return {
      id: this.node.attrs.id,
      comment: this.node.attrs.comment,
      accepted: action === 'accept',
      originalText: this.node.attrs.originalText || '',
      suggestedText: this.node.attrs.suggestedText || '',
      pos: pos !== undefined ? pos : -1,
    }
  }

  private handleAccept(): void {
    const meta = this.createMeta('accept')
    const pos = this.getPos()
    if (pos === undefined) return

    const suggestedText = this.node.attrs.suggestedText || ''
    const originalText = this.node.attrs.originalText || ''

    console.log('[DiffSuggestion:accept] Position BEFORE dispatch:', {
      pos,
      nodeSize: this.node.nodeSize,
      docSize: this.view.state.doc.nodeSize,
      originalText: originalText.substring(0, 50),
      suggestedText: suggestedText.substring(0, 50)
    })

    // Handle empty replacement (deletion) vs text replacement
    let transaction
    if (suggestedText.length === 0) {
      // Delete the node entirely
      transaction = this.view.state.tr.delete(pos, pos + this.node.nodeSize)
    } else {
      transaction = this.view.state.tr.replaceWith(
        pos,
        pos + this.node.nodeSize,
        this.view.state.schema.text(suggestedText)
      )
    }

    // Capture doc size before dispatch to compute accurate PM position deltas.
    // Relying on string length is wrong when the replacement produces nodes with
    // PM positions that differ from character count (e.g. multi-paragraph content).
    const sizeBefore = this.view.state.doc.content.size
    this.view.dispatch(transaction)
    const sizeAfter = this.view.state.doc.content.size
    const delta = sizeAfter - sizeBefore

    console.log('[DiffSuggestion:accept] Position AFTER dispatch:', {
      originalPos: pos,
      mappedPos: transaction.mapping.map(pos, 1),
      delta,
      newDocSize: this.view.state.doc.nodeSize
    })

    // Create AI annotation for provenance tracking if provenance data exists
    const {
      provenanceModel,
      provenanceConversationId,
      provenanceMessageId,
      documentId,
    } = this.node.attrs

    if (provenanceModel && documentId && suggestedText.length > 0) {
      createWordDiffAnnotations({
        documentId,
        originalText,
        newText: suggestedText,
        rangeFrom: pos,
        rangeTo: pos + this.node.nodeSize + delta,
        provenance: {
          model: provenanceModel,
          conversationId: provenanceConversationId || '',
          messageId: provenanceMessageId || '',
        },
      })
    }

    this.options.onAccept?.(meta)
  }

  private handleReject(): void {
    const meta = this.createMeta('reject')
    const pos = this.getPos()
    if (pos === undefined) return

    const transaction = this.view.state.tr.replaceWith(
      pos,
      pos + this.node.nodeSize,
      this.view.state.schema.text(this.node.attrs.originalText || '')
    )
    this.view.dispatch(transaction)
    this.options.onReject?.(meta)
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
