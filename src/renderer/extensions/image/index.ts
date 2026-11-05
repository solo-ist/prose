import Image from '@tiptap/extension-image'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import type { Node } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { useEditorStore } from '../../stores/editorStore'
import { getIdentity } from '../../document/identity'
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

/** The folder of `docPath`, or null for an unsaved document. */
function dirOf(docPath: string | null | undefined): string | null {
  if (!docPath) return null
  const lastSlash = docPath.lastIndexOf('/')
  return lastSlash > 0 ? docPath.substring(0, lastSlash) : null
}

/**
 * The folder of the document `state` holds, from the state's own identity.
 * Never the active-document mirror for anything built from a state: a tab
 * switch rebuilds the node views before the mirror is updated, so the mirror
 * still names the leaving document then (#1204).
 */
export function documentDirOf(state: EditorState): string | null {
  return dirOf(getIdentity(state).path)
}

/** The active document's folder per the mirror, for callers with no state at hand. */
function getDocumentDir(): string | null {
  return dirOf(useEditorStore.getState().document.path)
}

/**
 * Resolve a relative image path to a local-file:// URL for display, against
 * `docDir` (the owning document's folder). Absolute URLs, data: URLs, and
 * https: URLs pass through unchanged.
 */
export function resolveImageSrc(src: string, docDir: string | null = getDocumentDir()): string {
  if (/^(https?:|data:|local-file:)/i.test(src)) return src
  if (docDir) {
    return `local-file://${docDir}/${src}`
  }
  return src
}

/**
 * Percent-encode what markdown-it cannot read in a raw link destination:
 * whitespace (a pasted macOS screenshot has spaces and a narrow no-break
 * space before "AM") and angle brackets (#1133). Nothing else is touched, so
 * a source that is already encoded (every reload yields one, markdown-it
 * normalizes the destination) is left as it is, and URLs keep their query
 * strings.
 */
export function encodeImageSrc(src: string): string {
  return src.replace(/[\s<>]/g, (ch) => encodeURIComponent(ch))
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
async function saveImageFile(file: File, docDir: string | null): Promise<{ src: string; alt: string }> {
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

  // The default image serializer writes `src` raw, and markdown-it reads a
  // destination with spaces as text, so a pasted screenshot became literal
  // markdown on the next parse (#1133). Same output otherwise: escaped alt,
  // backslash-escaped parentheses, the title in quotes. tiptap-markdown keeps
  // its own parse hooks for the node under this spec.
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize(state: { write: (text: string) => void; esc: (text: string) => string }, node: Node) {
          const src = encodeImageSrc(String(node.attrs.src ?? '')).replace(/[()]/g, '\\$&')
          const title = node.attrs.title ? ` "${String(node.attrs.title).replace(/"/g, '\\"')}"` : ''
          state.write(`![${state.esc(node.attrs.alt || '')}](${src}${title})`)
        }
      }
    }
  },

  // Resolve relative paths for display and set title for hover tooltip. No
  // editor state here (clipboard HTML, getHTML()), so the mirror's folder is
  // the only one available; the node view, which is what the pane shows,
  // resolves against its own state.
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
          handlePaste(view, event) {
            const items = event.clipboardData?.items
            if (!items) return false

            const imageItems = Array.from(items).filter(item =>
              IMAGE_MIME_TYPES.includes(item.type)
            )
            if (!imageItems.length) return false

            event.preventDefault()

            const docDir = documentDirOf(view.state)
            for (const item of imageItems) {
              const file = item.getAsFile()
              if (!file) continue
              saveImageFile(file, docDir).then(({ src, alt }) => {
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
            const docDir = documentDirOf(view.state)

            for (const file of imageFiles) {
              saveImageFile(file, docDir).then(({ src, alt }) => {
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
