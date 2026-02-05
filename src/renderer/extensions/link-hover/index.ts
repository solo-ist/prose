/**
 * Link Hover TipTap Extension
 *
 * Displays link URLs in the status bar when hovering over links in the editor.
 * Similar to how browsers show link destinations in the status bar.
 *
 * Also handles CMD+Click (Mac) / Ctrl+Click (Windows/Linux) to open links,
 * preventing accidental navigation while editing.
 */

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { useLinkHoverStore } from '../../stores/linkHoverStore'
import { getApi } from '../../lib/browserApi'

export const linkHoverPluginKey = new PluginKey('linkHover')

export const LinkHover = Extension.create({
  name: 'linkHover',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: linkHoverPluginKey,
        props: {
          handleDOMEvents: {
            mouseover: (_view, event) => {
              const target = event.target as HTMLElement
              const link = target.closest('a[href]')
              if (link) {
                const href = link.getAttribute('href')
                useLinkHoverStore.getState().setHoveredUrl(href)
              }
              return false
            },
            mouseout: (_view, event) => {
              const target = event.target as HTMLElement
              if (target.closest('a[href]')) {
                useLinkHoverStore.getState().setHoveredUrl(null)
              }
              return false
            },
            click: (_view, event) => {
              // Handle CMD+Click (Mac) or Ctrl+Click (Windows/Linux) to open links
              const target = event.target as HTMLElement
              const link = target.closest('a[href]')

              if (link && (event.metaKey || event.ctrlKey)) {
                const href = link.getAttribute('href')
                if (href) {
                  event.preventDefault()
                  // Use Electron's shell.openExternal for safe external link opening
                  const api = getApi()
                  if (api.openExternal) {
                    api.openExternal(href)
                  } else {
                    // Fallback for browser environment
                    window.open(href, '_blank', 'noopener,noreferrer')
                  }
                  return true
                }
              }
              return false
            }
          }
        }
      })
    ]
  }
})
