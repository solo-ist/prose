/**
 * File tool executors - tools for file system operations.
 * These wrap the existing IPC handlers exposed via window.api.
 */

import type { ToolResult, FileItem } from '../../../../shared/tools/types'
import { toolSuccess, toolError } from '../../../../shared/tools/types'
import { useEditorStore } from '../../../stores/editorStore'
import { useChatStore, setCurrentDocumentId } from '../../../stores/chatStore'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useFileListStore } from '../../../stores/fileListStore'
import { useAnnotationStore } from '../../../extensions/ai-annotations'
import { parseMarkdown, serializeMarkdown } from '../../markdown'
import {
  generateId,
  generateIdFromPath,
  clearDraft,
  saveConversations,
  saveAnnotations
} from '../../persistence'
import { useTabStore, generateUntitledTitle } from '../../../stores/tabStore'
import { useSuggestionStore } from '../../../extensions/ai-suggestions/store'

/**
 * Get the Electron API.
 */
function getApi() {
  return window.api
}

/**
 * open_file - Open a file by path in the editor.
 */
export async function executeOpenFile(args: {
  path: string
}): Promise<ToolResult<{ opened: boolean; path: string }>> {
  const api = getApi()

  if (!api) {
    return toolError('File API not available', 'API_NOT_AVAILABLE')
  }

  const { path } = args

  if (!path) {
    return toolError('Path is required', 'INVALID_INPUT')
  }

  try {
    // Save current conversations before switching
    const { document } = useEditorStore.getState()
    await useChatStore.getState().saveCurrentConversation(document.documentId)

    // Read the file
    const content = await api.readFile(path)
    const parsed = parseMarkdown(content)
    const newDocumentId = await generateIdFromPath(path)

    // Update editor store
    useEditorStore.getState().setDocument({
      documentId: newDocumentId,
      path: path,
      content: parsed.content,
      frontmatter: parsed.frontmatter,
      isDirty: false
    })

    // Load conversations and annotations for the document
    await useChatStore.getState().loadForDocument(newDocumentId)
    await useAnnotationStore.getState().loadAnnotations(newDocumentId)

    // Clear draft since we opened a file
    await clearDraft()

    // Mark as editing
    useEditorStore.getState().setEditing(true)

    // Add to recent files
    useSettingsStore.getState().addRecentFile(path)

    // Highlight file in sidebar
    useFileListStore.getState().revealAndSelectPath(path)

    return toolSuccess({ opened: true, path })
  } catch (e) {
    return toolError(`Failed to open file: ${e}`, 'OPEN_FAILED')
  }
}

/**
 * new_file - Create a new unsaved document.
 */
export async function executeNewFile(args: {
  content?: string
}): Promise<ToolResult<{ created: boolean; documentId: string }>> {
  const { content = '' } = args

  try {
    // Save current conversations before switching
    const { document } = useEditorStore.getState()
    await useChatStore.getState().saveCurrentConversation(document.documentId)

    // Pause annotation position updates during document loading
    useAnnotationStore.getState().setLoadingDocument(true)

    // Create a new tab
    const newDocumentId = generateId()
    const title = generateUntitledTitle()

    useTabStore.getState().addTab({
      documentId: newDocumentId,
      path: null,
      title,
      isDirty: false,
      content,
      cursorPosition: { line: 1, column: 1 }
    })

    // Set up new document in editorStore
    useEditorStore.getState().setDocument({
      documentId: newDocumentId,
      path: null,
      content,
      frontmatter: {},
      isDirty: false
    })

    useEditorStore.getState().setCursorPosition(1, 1)
    setCurrentDocumentId(newDocumentId)

    // Clear chat state for new document
    useChatStore.setState({
      conversations: [],
      activeConversationId: null,
      messages: [],
      context: null
    })

    // Clear annotations and suggestions
    useAnnotationStore.getState().clearAnnotations()
    useSuggestionStore.getState().setDocumentId(newDocumentId)

    // Clear reMarkable read-only state
    useEditorStore.getState().setRemarkableReadOnly(false, null)

    // Mark as editing
    useEditorStore.getState().setEditing(true)

    // Resume annotation position updates
    setTimeout(() => {
      useAnnotationStore.getState().setLoadingDocument(false)
    }, 100)

    return toolSuccess({
      created: true,
      documentId: newDocumentId
    })
  } catch (e) {
    return toolError(`Failed to create new file: ${e}`, 'CREATE_FAILED')
  }
}

/**
 * save_file - Save the current document.
 */
export async function executeSaveFile(args: {
  path?: string
}): Promise<ToolResult<{ saved: boolean; path: string }>> {
  const api = getApi()

  if (!api) {
    return toolError('File API not available', 'API_NOT_AVAILABLE')
  }

  const { document } = useEditorStore.getState()
  const content = serializeMarkdown(document.content, document.frontmatter)

  try {
    let finalPath: string

    if (args.path) {
      // Save to specified path
      await api.saveFile(args.path, content)
      finalPath = args.path
    } else if (document.path) {
      // Save to existing path
      await api.saveFile(document.path, content)
      finalPath = document.path
    } else {
      // No path - use save dialog
      const newPath = await api.saveFileAs(content)
      if (!newPath) {
        return toolError('Save cancelled', 'SAVE_CANCELLED')
      }
      finalPath = newPath
    }

    // Update document state if path changed
    if (finalPath !== document.path) {
      const newDocumentId = await generateIdFromPath(finalPath)
      const conversations = useChatStore.getState().conversations

      // Migrate conversations
      if (conversations.length > 0) {
        const migratedConversations = conversations.map((c) => ({
          ...c,
          documentId: newDocumentId
        }))
        await saveConversations(newDocumentId, migratedConversations)
        useChatStore.setState({ conversations: migratedConversations })
      }

      // Migrate annotations
      const annotations = useAnnotationStore.getState().annotations
      if (annotations.length > 0) {
        const migratedAnnotations = annotations.map((a) => ({
          ...a,
          documentId: newDocumentId
        }))
        await saveAnnotations(newDocumentId, migratedAnnotations)
        useAnnotationStore.setState({
          annotations: migratedAnnotations,
          documentId: newDocumentId
        })
      } else {
        useAnnotationStore.getState().setDocumentId(newDocumentId)
      }

      useEditorStore.getState().setDocument({ documentId: newDocumentId, path: finalPath })
      setCurrentDocumentId(newDocumentId)
    }

    useEditorStore.getState().setDirty(false)

    return toolSuccess({ saved: true, path: finalPath })
  } catch (e) {
    return toolError(`Failed to save file: ${e}`, 'SAVE_FAILED')
  }
}

/**
 * Flatten a file tree and count total files.
 */
function flattenFiles(files: FileItem[], result: FileItem[] = []): FileItem[] {
  for (const file of files) {
    result.push(file)
    if (file.children) {
      flattenFiles(file.children, result)
    }
  }
  return result
}

/**
 * Truncate file tree to maxFiles limit.
 */
function truncateFiles(files: FileItem[], maxFiles: number): { files: FileItem[]; truncated: boolean } {
  const flat = flattenFiles(files)
  if (flat.length <= maxFiles) {
    return { files, truncated: false }
  }
  // Return only top-level with a note about truncation
  const truncatedFiles = files.slice(0, maxFiles)
  return { files: truncatedFiles, truncated: true }
}

/**
 * list_files - List files and directories at the specified path.
 */
export async function executeListFiles(args: {
  path: string
  maxDepth?: number
  maxFiles?: number
}): Promise<ToolResult<{ files: FileItem[]; truncated?: boolean; totalFound?: number }>> {
  const api = getApi()

  if (!api) {
    return toolError('File API not available', 'API_NOT_AVAILABLE')
  }

  // Enforce limits
  const { path, maxDepth: requestedDepth = 1, maxFiles: requestedMax = 100 } = args
  const maxDepth = Math.min(requestedDepth, 3) // Cap at 3 levels
  const maxFiles = Math.min(requestedMax, 500) // Cap at 500 files

  if (!path) {
    return toolError('Path is required', 'INVALID_INPUT')
  }

  try {
    const files = await api.listDirectory(path, maxDepth)
    const flat = flattenFiles(files)

    if (flat.length > maxFiles) {
      // Truncate to prevent token overflow
      const { files: truncatedFiles, truncated } = truncateFiles(files, maxFiles)
      return toolSuccess({
        files: truncatedFiles,
        truncated: true,
        totalFound: flat.length
      })
    }

    return toolSuccess({ files })
  } catch (e) {
    return toolError(`Failed to list directory: ${e}`, 'LIST_FAILED')
  }
}

/**
 * read_file - Read file contents without opening in editor.
 */
export async function executeReadFile(args: {
  path: string
}): Promise<ToolResult<{ content: string; path: string }>> {
  const api = getApi()

  if (!api) {
    return toolError('File API not available', 'API_NOT_AVAILABLE')
  }

  const { path } = args

  if (!path) {
    return toolError('Path is required', 'INVALID_INPUT')
  }

  try {
    const content = await api.readFile(path)
    return toolSuccess({ content, path })
  } catch (e) {
    return toolError(`Failed to read file: ${e}`, 'READ_FAILED')
  }
}

/**
 * create_and_open_file - Create a new file in the default directory and open it.
 * MCP-specific tool for Claude Desktop integration.
 */
export async function executeCreateAndOpenFile(args: {
  filename?: string
  content?: string
}): Promise<ToolResult<{ path: string; opened: boolean }>> {
  const api = getApi()

  if (!api) {
    return toolError('File API not available', 'API_NOT_AVAILABLE')
  }

  const { filename = 'Untitled.md', content = '' } = args

  try {
    // Get the default save directory from settings
    const settings = useSettingsStore.getState().settings
    const targetFolder = settings.defaultSaveDirectory || (await api.getDocumentsPath())

    // Ensure filename has .md extension
    const finalFilename = filename.endsWith('.md') ? filename : `${filename}.md`

    // Check if file exists and auto-increment if needed
    let attemptFilename = finalFilename
    let counter = 2
    const baseFilename = finalFilename.replace(/\.md$/, '')

    while (await api.fileExists(`${targetFolder}/${attemptFilename}`)) {
      attemptFilename = `${baseFilename} ${counter}.md`
      counter++
    }

    // Create the file
    const fullPath = await api.saveToFolder(targetFolder, attemptFilename, content)

    // Open the newly created file
    const openResult = await executeOpenFile({ path: fullPath })

    if (!openResult.success) {
      return toolError(
        `File created at ${fullPath} but failed to open: ${openResult.error}`,
        'OPEN_FAILED'
      )
    }

    return toolSuccess({ path: fullPath, opened: true })
  } catch (e) {
    return toolError(`Failed to create and open file: ${e}`, 'CREATE_FAILED')
  }
}
