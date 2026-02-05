/**
 * Link Hover TipTap Extension
 *
 * Displays link URLs in the status bar when hovering over links in the editor.
 * Similar to how browsers show link destinations in the status bar.
 */

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { useLinkHoverStore } from '../../stores/linkHoverStore'

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
            }
          }
        }
      })
    ]
  }
})
