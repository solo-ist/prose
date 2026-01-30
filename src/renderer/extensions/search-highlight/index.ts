/**
 * Search Highlight TipTap Extension
 *
 * Renders inline decorations for search results in the FindBar.
 * - Highlights all matches with a subtle background
 * - Highlights the current match with a stronger style
 * - Updates decorations when results or currentIndex change
 */

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Transaction } from '@tiptap/pm/state'

export interface SearchResult {
  from: number
  to: number
}

export interface SearchHighlightOptions {
  maxDecorations?: number
}

export interface SearchHighlightStorage {
  results: SearchResult[]
  currentIndex: number
}

export const searchHighlightPluginKey = new PluginKey('searchHighlight')

// Max decorations to prevent performance issues with large documents
const DEFAULT_MAX_DECORATIONS = 500

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    searchHighlight: {
      setSearchHighlight: (results: SearchResult[], currentIndex: number) => ReturnType
      clearSearchHighlight: () => ReturnType
    }
  }
}

export const SearchHighlight = Extension.create<SearchHighlightOptions, SearchHighlightStorage>({
  name: 'searchHighlight',

  addOptions() {
    return {
      maxDecorations: DEFAULT_MAX_DECORATIONS,
    }
  },

  addStorage() {
    return {
      results: [],
      currentIndex: 0,
    }
  },

  addCommands() {
    return {
      setSearchHighlight:
        (results: SearchResult[], currentIndex: number) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            this.storage.results = results
            this.storage.currentIndex = currentIndex
            // Dispatch an empty transaction to trigger decoration rebuild
            tr.setMeta(searchHighlightPluginKey, { results, currentIndex })
            dispatch(tr)
          }
          return true
        },

      clearSearchHighlight:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            this.storage.results = []
            this.storage.currentIndex = 0
            tr.setMeta(searchHighlightPluginKey, { results: [], currentIndex: 0 })
            dispatch(tr)
          }
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    const maxDecorations = this.options.maxDecorations ?? DEFAULT_MAX_DECORATIONS
    const storage = this.storage

    return [
      new Plugin({
        key: searchHighlightPluginKey,

        state: {
          init() {
            return {
              decorationSet: DecorationSet.empty,
              results: [] as SearchResult[],
              currentIndex: 0,
            }
          },

          apply(tr: Transaction, pluginState, _oldState, newState) {
            const { doc } = newState
            const meta = tr.getMeta(searchHighlightPluginKey)

            // Check if we have new search state from meta or storage
            const results = meta?.results ?? storage.results
            const currentIndex = meta?.currentIndex ?? storage.currentIndex

            // If document changed, map existing decorations
            let decorationSet = pluginState.decorationSet
            if (tr.docChanged) {
              decorationSet = decorationSet.map(tr.mapping, doc)
            }

            // Rebuild decorations if search state changed or doc changed
            const searchChanged =
              meta !== undefined ||
              results !== pluginState.results ||
              currentIndex !== pluginState.currentIndex

            if (searchChanged || tr.docChanged) {
              const decorations: Decoration[] = []

              // Limit decorations to prevent performance issues
              const limitedResults = results.slice(0, maxDecorations)

              for (let i = 0; i < limitedResults.length; i++) {
                const result = limitedResults[i]

                // Validate bounds
                const maxPos = doc.nodeSize - 2
                if (result.from < 0 || result.to > maxPos || result.from >= result.to) {
                  continue
                }

                const isCurrent = i === currentIndex
                const className = isCurrent ? 'search-match search-match-current' : 'search-match'

                decorations.push(
                  Decoration.inline(result.from, result.to, {
                    class: className,
                  })
                )
              }

              return {
                decorationSet: DecorationSet.create(doc, decorations),
                results,
                currentIndex,
              }
            }

            return {
              ...pluginState,
              decorationSet,
            }
          },
        },

        props: {
          decorations(state) {
            const pluginState = searchHighlightPluginKey.getState(state)
            return pluginState?.decorationSet ?? DecorationSet.empty
          },
        },
      }),
    ]
  },
})
