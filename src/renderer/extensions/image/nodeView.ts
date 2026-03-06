import type { NodeView, EditorView } from '@tiptap/pm/view'
import type { Node } from '@tiptap/pm/model'
import { resolveImageSrc } from './index'

export class ImageNodeView implements NodeView {
  dom: HTMLElement
  private img: HTMLImageElement
  private altInput: HTMLInputElement
  private node: Node
  private view: EditorView
  private getPos: () => number | undefined
  private contextMenu: HTMLElement | null = null

  constructor(node: Node, view: EditorView, getPos: () => number | undefined) {
    this.node = node
    this.view = view
    this.getPos = getPos

    // Wrapper span (contenteditable=false so ProseMirror doesn't try to edit inside)
    this.dom = document.createElement('span')
    this.dom.className = 'editor-image-wrapper'
    this.dom.setAttribute('contenteditable', 'false')

    this.img = document.createElement('img')
    this.img.className = 'editor-image'
    this.dom.appendChild(this.img)

    // Always-visible editable caption below the image
    this.altInput = document.createElement('input')
    this.altInput.className = 'editor-image-alt'
    this.altInput.type = 'text'
    this.altInput.placeholder = 'Add a caption...'
    this.dom.appendChild(this.altInput)

    this.syncAttrs()

    // Prevent ProseMirror from swallowing input events
    this.altInput.addEventListener('mousedown', (e) => e.stopPropagation())
    this.altInput.addEventListener('focus', (e) => e.stopPropagation())

    // Alt input saves on blur or Enter, cancels on Escape
    this.altInput.addEventListener('change', this.saveAlt)
    this.altInput.addEventListener('keydown', this.handleAltKeydown)

    // Right-click context menu on the image
    this.img.addEventListener('contextmenu', this.handleContextMenu)
  }

  private syncAttrs(): void {
    const src = resolveImageSrc(this.node.attrs.src || '')
    this.img.src = src
    if (this.node.attrs.alt) this.img.alt = this.node.attrs.alt
    if (this.node.attrs.title) this.img.title = this.node.attrs.title
    this.altInput.value = this.node.attrs.alt || ''

    // Cursor pointer when image has a link mark
    const hasLink = this.node.marks.some(m => m.type.name === 'link')
    this.img.style.cursor = hasLink ? 'pointer' : ''
  }

  // --- Alt text editing ---

  private saveAlt = (): void => {
    const newAlt = this.altInput.value
    if (newAlt === (this.node.attrs.alt || '')) return
    const pos = this.getPos()
    if (pos === undefined) return
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
      ...this.node.attrs,
      alt: newAlt,
    })
    this.view.dispatch(tr)
  }

  private handleAltKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      this.saveAlt()
      this.view.focus()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      // Revert to current node value
      this.altInput.value = this.node.attrs.alt || ''
      this.view.focus()
    }
  }

  // --- Right-click: Context menu ---

  private handleContextMenu = (e: MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    this.dismissContextMenu()

    const menu = document.createElement('div')
    menu.className = 'image-context-menu'

    const removeItem = document.createElement('div')
    removeItem.className = 'image-context-menu-item image-context-menu-item-destructive'
    removeItem.textContent = 'Remove image'
    removeItem.addEventListener('mousedown', (ev) => {
      ev.preventDefault()
      this.dismissContextMenu()
      const pos = this.getPos()
      if (pos !== undefined) {
        const tr = this.view.state.tr.delete(pos, pos + this.node.nodeSize)
        this.view.dispatch(tr)
      }
    })

    menu.appendChild(removeItem)

    menu.style.position = 'fixed'
    menu.style.top = `${e.clientY}px`
    menu.style.left = `${e.clientX}px`

    document.body.appendChild(menu)
    this.contextMenu = menu

    const dismiss = (ev: MouseEvent | KeyboardEvent): void => {
      if (ev instanceof KeyboardEvent && ev.key !== 'Escape') return
      if (ev instanceof MouseEvent && menu.contains(ev.target as Element)) return
      this.dismissContextMenu()
      document.removeEventListener('mousedown', dismiss, true)
      document.removeEventListener('keydown', dismiss, true)
    }

    setTimeout(() => {
      document.addEventListener('mousedown', dismiss, true)
      document.addEventListener('keydown', dismiss, true)
    }, 0)
  }

  private dismissContextMenu(): void {
    if (this.contextMenu) {
      this.contextMenu.remove()
      this.contextMenu = null
    }
  }

  // --- NodeView interface ---

  update(node: Node): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.syncAttrs()
    return true
  }

  destroy(): void {
    this.dismissContextMenu()
    this.altInput.removeEventListener('change', this.saveAlt)
    this.altInput.removeEventListener('keydown', this.handleAltKeydown)
    this.img.removeEventListener('contextmenu', this.handleContextMenu)
  }
}
