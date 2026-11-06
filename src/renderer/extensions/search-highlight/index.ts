/**
 * Search highlight: the find bar's matches, owned by a plugin (#1106).
 *
 * The term, its matches and the current index are plugin state, computed from
 * the document inside `apply`. An edit re-scans the new document and keeps the
 * current match by position, so the highlights follow their text, the counter
 * stays right and next/prev land on real matches. The FindBar dispatches the
 * term and the index and reads everything else back through the plugin key;
 * no position is cached outside the state and nothing polls
 * (`docs/architecture/editor-state.md` §6).
 *
 * Before this, the plugin mapped its decorations on every doc change and then
 * rebuilt them from the positions the FindBar had scanned once, so every
 * highlight stayed at its pre-edit offset and the bar's counter never moved.
 */

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface SearchResult {
  from: number
  to: number
}

export interface SearchHighlightState {
  /** The text being searched; empty when the bar is closed. */
  term: string
  /** Every match in document order. */
  results: readonly SearchResult[]
  /** Index into `results` of the highlighted match; -1 when there is none. */
  currentIndex: number
  decorationSet: DecorationSet
}

export interface SearchHighlightOptions {
  maxDecorations?: number
}

interface SearchMeta {
  term?: string
  currentIndex?: number
  clear?: boolean
}

export const searchHighlightPluginKey = new PluginKey<SearchHighlightState>('searchHighlight')

// Max decorations to prevent performance issues with large documents
const DEFAULT_MAX_DECORATIONS = 500

const NO_RESULTS: readonly SearchResult[] = []

const EMPTY_STATE: SearchHighlightState = {
  term: '',
  results: NO_RESULTS,
  currentIndex: -1,
  decorationSet: DecorationSet.empty
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    searchHighlight: {
      /** Search for `term`; the first match becomes current. An empty term clears. */
      setSearchTerm: (term: string) => ReturnType
      /** Make match `index` current (wraps around). */
      setSearchIndex: (index: number) => ReturnType
      clearSearchHighlight: () => ReturnType
    }
  }
}

/** The plugin's state for an editor state, or `undefined` before the plugin is installed. */
export function searchStateOf(state: EditorState): SearchHighlightState | undefined {
  return searchHighlightPluginKey.getState(state)
}

/**
 * Every case-insensitive occurrence of `term`, in document order. Each
 * textblock is scanned as one string with a document position per character,
 * so a match that spans two text nodes (different marks, `bo**ld**`) is found;
 * an inline leaf (hard break, image) is a separator no term can span.
 */
export function findMatches(doc: PMNode, term: string): SearchResult[] {
  if (!term) return []
  const results: SearchResult[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    let text = ''
    const positions: number[] = []
    node.forEach((child, offset) => {
      const start = pos + 1 + offset
      if (child.isText && child.text) {
        for (let i = 0; i < child.text.length; i++) positions.push(start + i)
        text += child.text
      } else {
        positions.push(start)
        text += '\u0000'
      }
    })
    // Case folding can change a string's length (a dotted capital I); when it
    // does, the positions would drift, so that block is matched case-sensitively.
    const folded = text.toLowerCase()
    const haystack = folded.length === text.length ? folded : text
    const needle = haystack === folded ? term.toLowerCase() : term
    let index = 0
    while ((index = haystack.indexOf(needle, index)) !== -1) {
      const last = index + needle.length - 1
      results.push({ from: positions[index]!, to: positions[last]! + 1 })
      index += 1
    }
    return false
  })
  return results
}

/** The index of the match whose start is nearest to `pos`. */
function nearestIndex(results: readonly SearchResult[], pos: number): number {
  let best = 0
  let bestDistance = Infinity
  results.forEach((result, index) => {
    const distance = Math.abs(result.from - pos)
    if (distance < bestDistance) {
      best = index
      bestDistance = distance
    }
  })
  return best
}

function buildDecorations(
  doc: PMNode,
  results: readonly SearchResult[],
  currentIndex: number,
  maxDecorations: number
): DecorationSet {
  const decorations = results.slice(0, maxDecorations).map((result, index) =>
    Decoration.inline(result.from, result.to, {
      class: index === currentIndex ? 'search-match search-match-current' : 'search-match'
    })
  )
  return DecorationSet.create(doc, decorations)
}

function applySearch(
  tr: Transaction,
  prev: SearchHighlightState,
  newState: EditorState,
  maxDecorations: number
): SearchHighlightState {
  const meta = tr.getMeta(searchHighlightPluginKey) as SearchMeta | undefined
  if (meta?.clear || meta?.term === '') return EMPTY_STATE

  let { term, results, currentIndex } = prev
  let changed = false

  if (meta?.term !== undefined && meta.term !== term) {
    term = meta.term
    results = findMatches(newState.doc, term)
    currentIndex = results.length > 0 ? 0 : -1
    changed = true
  } else if (tr.docChanged && term) {
    // Re-scan, and keep the current match by where it moved to.
    const current = currentIndex >= 0 ? results[currentIndex] : undefined
    const anchor = current ? tr.mapping.map(current.from) : null
    results = findMatches(newState.doc, term)
    currentIndex = results.length === 0 ? -1 : anchor === null ? 0 : nearestIndex(results, anchor)
    changed = true
  }

  if (meta?.currentIndex !== undefined && results.length > 0) {
    const wrapped = ((meta.currentIndex % results.length) + results.length) % results.length
    if (wrapped !== currentIndex) {
      currentIndex = wrapped
      changed = true
    }
  }

  if (!changed) return prev
  return {
    term,
    results,
    currentIndex,
    decorationSet: buildDecorations(newState.doc, results, currentIndex, maxDecorations)
  }
}

export const SearchHighlight = Extension.create<SearchHighlightOptions>({
  name: 'searchHighlight',

  addOptions() {
    return {
      maxDecorations: DEFAULT_MAX_DECORATIONS
    }
  },

  addCommands() {
    return {
      setSearchTerm:
        (term) =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(searchHighlightPluginKey, { term } satisfies SearchMeta)
          return true
        },

      setSearchIndex:
        (index) =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(searchHighlightPluginKey, { currentIndex: index } satisfies SearchMeta)
          return true
        },

      clearSearchHighlight:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(searchHighlightPluginKey, { clear: true } satisfies SearchMeta)
          return true
        }
    }
  },

  addProseMirrorPlugins() {
    const maxDecorations = this.options.maxDecorations ?? DEFAULT_MAX_DECORATIONS

    return [
      new Plugin<SearchHighlightState>({
        key: searchHighlightPluginKey,

        state: {
          init: () => EMPTY_STATE,
          apply: (tr, prev, _oldState, newState) => applySearch(tr, prev, newState, maxDecorations)
        },

        props: {
          decorations(state) {
            return searchHighlightPluginKey.getState(state)?.decorationSet ?? DecorationSet.empty
          }
        }
      })
    ]
  }
})
