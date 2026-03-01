import Image from '@tiptap/extension-image'
import { Plugin, PluginKey } from '@tiptap/pm/state'

const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg)$/i

function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export const ImageWithUpload = Image.extend({
  // Allow images within text flow (inline)
  inline: true,
  group: 'inline',

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
              fileToDataURL(file).then(src => {
                editor.chain().focus().setImage({ src, alt: '' }).run()
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
              fileToDataURL(file).then(src => {
                if (coords) {
                  editor.chain().focus().insertContentAt(coords.pos, {
                    type: 'image',
                    attrs: { src, alt: '' }
                  }).run()
                } else {
                  editor.chain().focus().setImage({ src, alt: '' }).run()
                }
              })
            }

            return true
          }
        }
      })
    ]
  }
})
