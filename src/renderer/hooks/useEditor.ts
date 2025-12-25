import { useCallback } from 'react'
import { useEditorStore } from '../stores/editorStore'
import { parseMarkdown, serializeMarkdown } from '../lib/markdown'

export function useEditor() {
  const {
    document,
    cursorPosition,
    setDocument,
    setContent,
    setPath,
    setDirty,
    setFrontmatter,
    setCursorPosition,
    resetDocument
  } = useEditorStore()

  const openFile = useCallback(async () => {
    if (!window.api) return
    const result = await window.api.openFile()
    if (result) {
      const parsed = parseMarkdown(result.content)
      setDocument({
        path: result.path,
        content: parsed.content,
        frontmatter: parsed.frontmatter,
        isDirty: false
      })
    }
  }, [setDocument])

  const saveFile = useCallback(async () => {
    if (!window.api) return
    const content = serializeMarkdown(document.content, document.frontmatter)

    if (document.path) {
      await window.api.saveFile(document.path, content)
      setDirty(false)
    } else {
      const path = await window.api.saveFileAs(content)
      if (path) {
        setPath(path)
        setDirty(false)
      }
    }
  }, [document, setDirty, setPath])

  const saveFileAs = useCallback(async () => {
    if (!window.api) return
    const content = serializeMarkdown(document.content, document.frontmatter)
    const path = await window.api.saveFileAs(content)
    if (path) {
      setPath(path)
      setDirty(false)
    }
  }, [document, setPath, setDirty])

  const newFile = useCallback(() => {
    resetDocument()
  }, [resetDocument])

  return {
    document,
    cursorPosition,
    setContent,
    setFrontmatter,
    setCursorPosition,
    openFile,
    saveFile,
    saveFileAs,
    newFile
  }
}
