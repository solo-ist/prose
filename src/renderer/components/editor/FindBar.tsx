import { useState, useEffect, useCallback, useRef } from 'react'
import { X, ChevronUp, ChevronDown } from 'lucide-react'
import { TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { searchHighlightPluginKey } from '../../extensions/search-highlight'

const NO_SEARCH = { count: 0, currentIndex: -1, pluginTerm: '' }

interface FindBarProps {
  editor: Editor | null
  isOpen: boolean
  onClose: () => void
}

/**
 * The find bar. The search itself lives in the search-highlight plugin's
 * state (#1106): the bar dispatches the term and the index and reads the
 * matches and the counter back, so an edit anywhere keeps them right.
 */
/**
 * Scroll the editor pane so `pos` is in view, keeping the focus where it is.
 * ProseMirror's own `scrollIntoView` walks the scrollable ancestors of the DOM
 * selection's focus node, which sits in the find input while the bar is used,
 * so it never reaches the pane; it only worked when the DOM selection
 * happened to be in the editor (#1203). Centres the match when it is outside
 * the pane's middle band, leaves the pane alone otherwise.
 */
function scrollMatchIntoView(view: EditorView, pos: number): void {
  const pane = view.dom.closest('.overflow-auto') as HTMLElement | null
  if (!pane) return
  const coords = view.coordsAtPos(pos)
  const rect = pane.getBoundingClientRect()
  const margin = Math.min(48, rect.height / 4)
  if (coords.top >= rect.top + margin && coords.bottom <= rect.bottom - margin) return
  pane.scrollTop += coords.top - rect.top - rect.height / 2
}

export function FindBar({ editor, isOpen, onClose }: FindBarProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Null while there is no editor (the hook's nullable-editor overload).
  const search = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const state = current ? searchHighlightPluginKey.getState(current.state) : undefined
      return {
        count: state?.results.length ?? 0,
        currentIndex: state?.currentIndex ?? -1,
        pluginTerm: state?.term ?? ''
      }
    }
  })
  const { count, currentIndex, pluginTerm } = search ?? NO_SEARCH

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isOpen])

  // Clear highlights when closed. The plugin state is per tab, so a clear
  // reaches only the tab that is active then; a tab that arrives later with
  // its term still set (searched before a switch) is cleared here too, as the
  // plugin term it carries re-runs this effect (#1203).
  useEffect(() => {
    if (!isOpen && editor && pluginTerm) {
      editor.commands.clearSearchHighlight()
    }
  }, [isOpen, editor, pluginTerm])

  // Listen for search:show events from tools (e.g., search_document)
  useEffect(() => {
    const handleSearchShow = (e: CustomEvent<{ query: string }>) => {
      const { query } = e.detail
      if (query) {
        setSearchTerm(query)
        // The search will trigger via the debounced effect
      }
    }

    window.addEventListener('search:show', handleSearchShow as EventListener)
    return () => window.removeEventListener('search:show', handleSearchShow as EventListener)
  }, [])

  // Refocus the input when Cmd+F is pressed while the bar is already open
  useEffect(() => {
    const handleFindFocus = () => {
      if (inputRef.current) {
        inputRef.current.focus()
        inputRef.current.select()
      }
    }

    window.addEventListener('find:focus', handleFindFocus)
    return () => window.removeEventListener('find:focus', handleFindFocus)
  }, [])

  /**
   * Select match `index` and scroll the pane to it, without focusing the
   * editor: the input keeps the focus so Enter and Shift+Enter keep
   * navigating. The scroll is done by hand (see `scrollMatchIntoView`).
   */
  const reveal = useCallback(
    (index: number) => {
      if (!editor) return
      const match = searchHighlightPluginKey.getState(editor.state)?.results[index]
      if (!match) return
      const { tr, doc } = editor.state
      editor.view.dispatch(tr.setSelection(TextSelection.create(doc, match.from, match.to)))
      scrollMatchIntoView(editor.view, match.from)
    },
    [editor]
  )

  // Debounced search on input change. The plugin's term is a dependency so a
  // tab switch (a fresh editor state, no term) re-runs the same search there.
  useEffect(() => {
    if (!editor || !isOpen) return
    const term = searchTerm.trim() ? searchTerm : ''
    if (term === pluginTerm) return
    const timer = setTimeout(() => {
      if (!term) {
        editor.commands.clearSearchHighlight()
        return
      }
      editor.commands.setSearchTerm(term)
      reveal(0)
    }, 150)
    return () => clearTimeout(timer)
  }, [editor, isOpen, searchTerm, pluginTerm, reveal])

  const goTo = useCallback(
    (index: number) => {
      if (!editor || count === 0) return
      editor.commands.setSearchIndex(index)
      const next = searchHighlightPluginKey.getState(editor.state)?.currentIndex ?? -1
      if (next >= 0) reveal(next)
    },
    [editor, count, reveal]
  )

  const goToNext = useCallback(() => goTo(currentIndex + 1), [goTo, currentIndex])
  const goToPrevious = useCallback(() => goTo(currentIndex - 1), [goTo, currentIndex])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) {
        goToPrevious()
      } else {
        goToNext()
      }
    }
  }

  if (!isOpen) return null

  return (
    <div className="absolute top-0 right-0 z-10 flex items-center gap-2 bg-background border border-border rounded-bl-lg shadow-lg p-2">
      <Input
        ref={inputRef}
        type="text"
        placeholder="Find..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        onKeyDown={handleKeyDown}
        className="w-48 h-8 text-sm"
      />
      <span className="text-xs text-muted-foreground min-w-16 text-center" data-testid="find-bar-count">
        {count > 0 ? `${currentIndex + 1}/${count}` : 'No results'}
      </span>
      <div className="flex items-center">
        <Button
          variant="ghost"
          size="sm"
          onClick={goToPrevious}
          disabled={count === 0}
          className="h-7 w-7 p-0"
          aria-label="Previous match"
        >
          <ChevronUp className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={goToNext}
          disabled={count === 0}
          className="h-7 w-7 p-0"
          aria-label="Next match"
        >
          <ChevronDown className="h-4 w-4" />
        </Button>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onClose}
        className="h-7 w-7 p-0"
        aria-label="Close find bar"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}
