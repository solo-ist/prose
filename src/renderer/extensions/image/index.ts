import Image from '@tiptap/extension-image'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Node } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { useEditorStore } from '../../stores/editorStore'
import { ImageNodeView } from './nodeView'

const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg)$/i

/**
 * Convert a File to a base64 data URL (fallback for unsaved documents).
 */
function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/**
 * Convert a File to a raw base64 string (no data: prefix).
 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1])
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/**
 * Get the directory of the current document, or null if unsaved.
 */
function getDocumentDir(): string | null {
  const docPath = useEditorStore.getState().document.path
  if (!docPath) return null
  const lastSlash = docPath.lastIndexOf('/')
  return lastSlash > 0 ? docPath.substring(0, lastSlash) : null
}

/**
 * Resolve a relative image path to a local-file:// URL for display.
 * Absolute URLs, data: URLs, and https: URLs pass through unchanged.
 */
export function resolveImageSrc(src: string): string {
  if (/^(https?:|data:|local-file:)/i.test(src)) return src
  const docDir = getDocumentDir()
  if (docDir) {
    return `local-file://${docDir}/${src}`
  }
  return src
}

/**
 * Derive alt text from a filename: strip extension, replace separators with spaces.
 */
function altFromFilename(name: string): string {
  return name
    .replace(/\.[^.]+$/, '')       // strip extension
    .replace(/[-_]/g, ' ')         // separators to spaces
    .replace(/\s+/g, ' ')          // collapse whitespace
    .trim()
}

/**
 * Save an image file and return { src, alt } for the image node.
 * For saved documents: saves to the document directory and returns filename.
 * For unsaved documents: returns base64 data URL as fallback.
 */
async function saveImageFile(file: File): Promise<{ src: string; alt: string }> {
  const docDir = getDocumentDir()
  const alt = altFromFilename(file.name)

  if (docDir && window.api?.saveImage) {
    try {
      const base64 = await fileToBase64(file)
      const result = await window.api.saveImage(docDir, base64, file.type, file.name)
      return { src: result.relativePath, alt }
    } catch {
      // Fall through to base64
    }
  }

  const src = await fileToDataURL(file)
  return { src, alt }
}

export const ImageWithUpload = Image.extend({
  inline: true,
  group: 'inline',

  // Resolve relative paths for display and set title for hover tooltip
  renderHTML({ HTMLAttributes }) {
    const resolvedSrc = resolveImageSrc(HTMLAttributes.src || '')
    return ['img', {
      ...HTMLAttributes,
      src: resolvedSrc,
      title: HTMLAttributes.title || HTMLAttributes.alt || undefined,
    }]
  },

  addNodeView() {
    return ({ node, view, getPos }: { node: Node; view: EditorView; getPos: () => number | undefined }) => {
      return new ImageNodeView(node, view, getPos)
    }
  },

  addProseMirrorPlugins() {
    const editor = this.editor

    return [
      new Plugin({
        key: new PluginKey('image-upload'),
        props: {
          handlePaste(_view, event) {
            const items = event.clipboardData?.items
            if (!items) return false

            const imageItems = Array.from(items).filter(item =>
              IMAGE_MIME_TYPES.includes(item.type)
            )
            if (!imageItems.length) return false

            event.preventDefault()

            for (const item of imageItems) {
              const file = item.getAsFile()
              if (!file) continue
              saveImageFile(file).then(({ src, alt }) => {
                editor.chain().focus().setImage({ src, alt }).run()
              })
            }

            return true
          },

          handleDrop(view, event) {
            const files = event.dataTransfer?.files
            if (!files?.length) return false

            const imageFiles = Array.from(files).filter(
              f => IMAGE_MIME_TYPES.includes(f.type) || IMAGE_EXTENSIONS.test(f.name)
            )
            if (!imageFiles.length) return false

            event.preventDefault()

            const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })

            for (const file of imageFiles) {
              saveImageFile(file).then(({ src, alt }) => {
                if (coords) {
                  editor.chain().focus().insertContentAt(coords.pos, {
                    type: 'image',
                    attrs: { src, alt }
                  }).run()
                } else {
                  editor.chain().focus().setImage({ src, alt }).run()
                }
              })
            }

            return true
          },
        }
      })
    ]
  }
})
