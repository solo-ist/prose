import { useState, useEffect, useCallback, useRef } from 'react'
import { X, ChevronUp, ChevronDown } from 'lucide-react'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import type { Editor } from '@tiptap/react'

interface FindBarProps {
  editor: Editor | null
  isOpen: boolean
  onClose: () => void
}

interface SearchResult {
  from: number
  to: number
}

export function FindBar({ editor, isOpen, onClose }: FindBarProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isOpen])

  // Search for matches in the document
  const search = useCallback(() => {
    if (!editor || !searchTerm.trim()) {
      setResults([])
      setCurrentIndex(0)
      return
    }

    const doc = editor.state.doc
    const searchResults: SearchResult[] = []
    const searchLower = searchTerm.toLowerCase()

    doc.descendants((node, pos) => {
      if (node.isText && node.text) {
        const textLower = node.text.toLowerCase()
        let index = 0
        while ((index = textLower.indexOf(searchLower, index)) !== -1) {
          searchResults.push({
            from: pos + index,
            to: pos + index + searchTerm.length
          })
          index += 1
        }
      }
    })

    setResults(searchResults)
    setCurrentIndex(searchResults.length > 0 ? 0 : -1)

    // Highlight first result
    if (searchResults.length > 0) {
      editor.commands.setTextSelection(searchResults[0])
      scrollToSelection(editor)
    }
  }, [editor, searchTerm])

  // Debounced search on input change
  useEffect(() => {
    const timer = setTimeout(search, 150)
    return () => clearTimeout(timer)
  }, [search])

  const scrollToSelection = (editor: Editor) => {
    const { from } = editor.state.selection
    const coords = editor.view.coordsAtPos(from)
    const editorElement = editor.view.dom.closest('.overflow-auto')
    if (editorElement && coords) {
      const rect = editorElement.getBoundingClientRect()
      if (coords.top < rect.top || coords.bottom > rect.bottom) {
        editorElement.scrollTo({
          top: editorElement.scrollTop + coords.top - rect.top - rect.height / 2,
          behavior: 'smooth'
        })
      }
    }
  }

  const goToNext = useCallback(() => {
    if (!editor || results.length === 0) return
    const nextIndex = (currentIndex + 1) % results.length
    setCurrentIndex(nextIndex)
    editor.commands.setTextSelection(results[nextIndex])
    scrollToSelection(editor)
  }, [editor, results, currentIndex])

  const goToPrevious = useCallback(() => {
    if (!editor || results.length === 0) return
    const prevIndex = currentIndex <= 0 ? results.length - 1 : currentIndex - 1
    setCurrentIndex(prevIndex)
    editor.commands.setTextSelection(results[prevIndex])
    scrollToSelection(editor)
  }, [editor, results, currentIndex])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
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
      <span className="text-xs text-muted-foreground min-w-[4rem] text-center">
        {results.length > 0 ? `${currentIndex + 1}/${results.length}` : 'No results'}
      </span>
      <div className="flex items-center">
        <Button
          variant="ghost"
          size="sm"
          onClick={goToPrevious}
          disabled={results.length === 0}
          className="h-7 w-7 p-0"
          aria-label="Previous match"
        >
          <ChevronUp className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={goToNext}
          disabled={results.length === 0}
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
