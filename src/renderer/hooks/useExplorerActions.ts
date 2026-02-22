import { useEffect, useCallback, type RefObject } from 'react'
import { useFileListStore } from '../stores/fileListStore'
import { useTabStore } from '../stores/tabStore'
import { getApi } from '../lib/browserApi'
import type { FileItem } from '../types'

interface UseExplorerActionsOptions {
  containerRef: RefObject<HTMLDivElement | null>
  onNewFile?: (targetDir: string) => void
  onFileOpen?: (path: string) => void
  onFilePreview?: (path: string) => void
  onFileTrash?: (path: string) => void
  closeTab?: (tabId: string) => Promise<void>
}

/** Flatten visible file tree items (respecting expanded folders) */
function getVisibleItems(items: FileItem[], expandedFolders: Set<string>): FileItem[] {
  const result: FileItem[] = []
  for (const item of items) {
    result.push(item)
    if (item.isDirectory && expandedFolders.has(item.path) && item.children) {
      result.push(...getVisibleItems(item.children, expandedFolders))
    }
  }
  return result
}

/** Find the parent path of an item in the tree */
function findParentPath(items: FileItem[], targetPath: string, parentPath: string | null = null): string | null {
  for (const item of items) {
    if (item.path === targetPath) return parentPath
    if (item.children) {
      const found = findParentPath(item.children, targetPath, item.path)
      if (found !== null) return found
    }
  }
  return null
}

export function useExplorerActions({
  containerRef,
  onNewFile,
  onFileOpen,
  onFilePreview,
  onFileTrash,
  closeTab
}: UseExplorerActionsOptions) {
  const selectedPath = useFileListStore((s) => s.selectedPath)
  const clipboardPath = useFileListStore((s) => s.clipboardPath)
  const rootPath = useFileListStore((s) => s.rootPath)
  const setClipboardPath = useFileListStore((s) => s.setClipboardPath)
  const setRenamingPath = useFileListStore((s) => s.setRenamingPath)
  const renamingPath = useFileListStore((s) => s.renamingPath)

  const api = getApi()

  const trashSelected = useCallback(async () => {
    if (!selectedPath) return

    try {
      await api.trashFile(selectedPath)

      // Close tab if open (use full close flow to load next tab)
      const tab = useTabStore.getState().getTabByPath(selectedPath)
      if (tab && closeTab) {
        await closeTab(tab.id)
      }

      // Refresh file list
      await useFileListStore.getState().loadFiles()
    } catch (error) {
      console.error('Failed to trash file:', error)
    }
  }, [selectedPath, api, closeTab])

  const copySelected = useCallback(() => {
    if (!selectedPath) return
    setClipboardPath(selectedPath)
  }, [selectedPath, setClipboardPath])

  const pasteFile = useCallback(async () => {
    if (!clipboardPath) return

    try {
      const newPath = await api.duplicateFile(clipboardPath)

      // Refresh file list
      await useFileListStore.getState().loadFiles()

      // Select and open the new file
      useFileListStore.getState().selectFile(newPath)
      onFileOpen?.(newPath)
    } catch (error) {
      console.error('Failed to paste file:', error)
    }
  }, [clipboardPath, api, onFileOpen])

  const startRename = useCallback(() => {
    if (!selectedPath) return
    setRenamingPath(selectedPath)
  }, [selectedPath, setRenamingPath])

  const newFileInContext = useCallback(() => {
    if (!selectedPath && !rootPath) return

    // Determine target directory: if selected path is a directory use it,
    // otherwise use the parent dir of the selected file, or rootPath
    let targetDir = rootPath
    if (selectedPath) {
      // Check if selectedPath is a directory by looking in the file tree
      const files = useFileListStore.getState().files
      const findItem = (items: typeof files): typeof files[0] | null => {
        for (const item of items) {
          if (item.path === selectedPath) return item
          if (item.children) {
            const found = findItem(item.children)
            if (found) return found
          }
        }
        return null
      }
      const selected = findItem(files)
      if (selected?.isDirectory) {
        targetDir = selected.path
      } else if (selectedPath) {
        targetDir = selectedPath.substring(0, selectedPath.lastIndexOf('/'))
      }
    }

    if (targetDir) {
      onNewFile?.(targetDir)
    }
  }, [selectedPath, rootPath, onNewFile])

  // Keyboard shortcuts scoped to explorer panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle when explorer is focused
      if (!containerRef.current?.contains(document.activeElement)) return

      // Don't handle when inline rename input is active
      if (renamingPath) return

      const isMeta = e.metaKey || e.ctrlKey

      // Return → toggle folder or start rename for files
      if (e.key === 'Enter' && !isMeta && selectedPath) {
        e.preventDefault()
        e.stopPropagation()
        // Check if selected item is a folder
        const { files: allFiles, expandedFolders: ef, toggleFolder: toggle } = useFileListStore.getState()
        const visibleForEnter = getVisibleItems(allFiles, ef)
        const selectedItem = visibleForEnter.find(item => item.path === selectedPath)
        if (selectedItem?.isDirectory) {
          toggle(selectedItem.path)
        } else {
          startRename()
        }
        return
      }

      // Cmd+Delete → trash (with confirmation dialog)
      if (e.key === 'Backspace' && isMeta && selectedPath) {
        e.preventDefault()
        e.stopPropagation()
        if (onFileTrash) {
          onFileTrash(selectedPath)
        } else {
          trashSelected()
        }
        return
      }

      // Cmd+C → copy
      if (e.key === 'c' && isMeta && selectedPath) {
        e.preventDefault()
        e.stopPropagation()
        copySelected()
        return
      }

      // Cmd+V → paste
      if (e.key === 'v' && isMeta && clipboardPath) {
        e.preventDefault()
        e.stopPropagation()
        pasteFile()
        return
      }

      // Cmd+N → new file in context
      if (e.key === 'n' && isMeta) {
        e.preventDefault()
        e.stopPropagation()
        newFileInContext()
        return
      }

      // Arrow key navigation (no modifier keys)
      if (!isMeta && !e.shiftKey && !e.altKey) {
        const { files, expandedFolders, toggleFolder, selectFile, setExpanded } = useFileListStore.getState()
        const visible = getVisibleItems(files, expandedFolders)
        const currentIndex = selectedPath ? visible.findIndex(item => item.path === selectedPath) : -1

        if (e.key === 'ArrowDown') {
          e.preventDefault()
          e.stopPropagation()
          const nextIndex = currentIndex + 1
          if (nextIndex < visible.length) {
            const nextItem = visible[nextIndex]
            selectFile(nextItem.path)
            if (!nextItem.isDirectory) {
              onFilePreview?.(nextItem.path)
            }
          }
          return
        }

        if (e.key === 'ArrowUp') {
          e.preventDefault()
          e.stopPropagation()
          const prevIndex = currentIndex - 1
          if (prevIndex >= 0) {
            const prevItem = visible[prevIndex]
            selectFile(prevItem.path)
            if (!prevItem.isDirectory) {
              onFilePreview?.(prevItem.path)
            }
          }
          return
        }

        if (e.key === 'ArrowRight' && selectedPath) {
          e.preventDefault()
          e.stopPropagation()
          const currentItem = visible[currentIndex]
          if (currentItem?.isDirectory) {
            if (!expandedFolders.has(currentItem.path)) {
              // Expand folder
              toggleFolder(currentItem.path)
            } else if (currentItem.children?.length) {
              // Already expanded — move to first child
              const firstChild = currentItem.children[0]
              selectFile(firstChild.path)
              if (!firstChild.isDirectory) {
                onFilePreview?.(firstChild.path)
              }
            }
          }
          return
        }

        if (e.key === 'ArrowLeft' && selectedPath) {
          e.preventDefault()
          e.stopPropagation()
          const currentItem = visible[currentIndex]
          if (currentItem?.isDirectory && expandedFolders.has(currentItem.path)) {
            // Collapse folder
            setExpanded(currentItem.path, false)
          } else {
            // Move to parent
            const parentPath = findParentPath(files, selectedPath)
            if (parentPath) {
              selectFile(parentPath)
            }
          }
          return
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [containerRef, selectedPath, clipboardPath, renamingPath, startRename, trashSelected, copySelected, pasteFile, newFileInContext, onFilePreview, onFileTrash])

  return {
    trashSelected,
    copySelected,
    pasteFile,
    startRename,
    newFileInContext,
    clipboardPath
  }
}
