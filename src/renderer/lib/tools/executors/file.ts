/**
 * File tool executors - tools for file system operations.
 * These wrap the existing IPC handlers exposed via window.api.
 */

import type { ToolResult, FileItem } from '../../../../shared/tools/types'
import { toolSuccess, toolError } from '../../../../shared/tools/types'
import { useEditorStore } from '../../../stores/editorStore'
import { useEditorInstanceStore } from '../../../stores/editorInstanceStore'
import { useChatStore, setCurrentDocumentId } from '../../../stores/chatStore'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useFileListStore } from '../../../stores/fileListStore'
import { useAnnotationStore } from '../../../extensions/ai-annotations'
import { useCommentStore } from '../../../extensions/comments/store'
import { getAISuggestions } from '../../../extensions/ai-suggestions'
import { useReviewEventStore } from '../../../extensions/review-events'
import { parseMarkdown, serializeMarkdown, prepareTextContent } from '../../markdown'
import {
  generateId,
  generateIdFromPath,
  clearDraft,
  migrateReviewState,
  saveConversations,
  saveAnnotations,
} from '../../persistence'
import { useTabStore, generateUntitledTitle } from '../../../stores/tabStore'
import { useSuggestionStore } from '../../../extensions/ai-suggestions/store'

interface ToolProvenance {
  model: string
  conversationId: string
  messageId: string
  documentId: string
}

/**
 * Get the Electron API.
 */
function getApi() {
  return window.api
}

async function waitForEditorDocumentContent(documentId: string, markdown: string): Promise<number | null> {
  const expected = markdown.trim()

  for (let attempt = 0; attempt < 10; attempt++) {
    const editor = useEditorInstanceStore.getState().editor
    const activeDocumentId = useEditorStore.getState().document.documentId
    const currentMarkdown = editor?.storage.markdown?.getMarkdown?.()

    if (
      editor &&
      activeDocumentId === documentId &&
      (!expected || currentMarkdown?.trim() === expected)
    ) {
      return editor.state.doc.content.size
    }

    await new Promise((resolve) => setTimeout(resolve, 16))
  }

  return null
}

/**
 * open_file - Open a file by path in the editor.
 * Opens in a new tab unless the current tab is an empty untitled document.
 * If the file is already open in a tab, switches to that tab.
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
    const tabStore = useTabStore.getState()

    // Check if file is already open in a tab — switch to it
    const existingTab = tabStore.getTabByPath(path)
    if (existingTab) {
      tabStore.setActiveTab(existingTab.id)

      // Load the document into editorStore for the active editor
      const content = await api.readFile(path)
      const isTxt = path.endsWith('.txt')
      const parsed = parseMarkdown(isTxt ? prepareTextContent(content) : content)
      const docId = await generateIdFromPath(path)

      // Reset document-scoped review stores before rendering the selected
      // file. This keeps Activity aligned while persistence loads complete.
      useSuggestionStore.getState().setDocumentId(docId)
      useCommentStore.getState().setDocumentId(docId)

      useEditorStore.getState().setDocument({
        documentId: docId,
        path,
        content: parsed.content,
        frontmatter: parsed.frontmatter,
        isDirty: false
      })
      setCurrentDocumentId(docId)
      await useChatStore.getState().loadForDocument(docId)
      await useAnnotationStore.getState().loadAnnotations(docId)
      await useSuggestionStore.getState().loadSuggestions(docId)
      await useCommentStore.getState().loadComments(docId)
      useEditorStore.getState().setEditing(true)

      return toolSuccess({ opened: true, path })
    }

    // Save current tab state before switching
    const { document } = useEditorStore.getState()
    await useChatStore.getState().saveCurrentConversation(document.documentId)

    // Pause annotation position updates during document loading
    useAnnotationStore.getState().setLoadingDocument(true)

    // Read the file
    const content = await api.readFile(path)
    const isTxt = path.endsWith('.txt')
    const parsed = parseMarkdown(isTxt ? prepareTextContent(content) : content)
    const newDocumentId = await generateIdFromPath(path)

    // Reset document-scoped review stores before rendering the selected file.
    // This keeps Activity aligned while persistence loads complete.
    useSuggestionStore.getState().setDocumentId(newDocumentId)
    useCommentStore.getState().setDocumentId(newDocumentId)

    // Extract title from path
    const fullFileName = path.split('/').pop() || 'Untitled'
    const hasExtension = fullFileName.includes('.')
    const title = hasExtension
      ? fullFileName.substring(0, fullFileName.lastIndexOf('.'))
      : fullFileName

    // Check if current tab is empty untitled — reuse it instead of creating new
    const activeTab = tabStore.tabs.find(t => t.id === tabStore.activeTabId)
    const isEmptyUntitled = activeTab && !activeTab.path &&
      (!activeTab.content || activeTab.content.trim() === '' ||
       activeTab.content.replace(/<[^>]*>/g, '').trim() === '')

    if (isEmptyUntitled && activeTab) {
      tabStore.updateTab(activeTab.id, {
        documentId: newDocumentId,
        path,
        title,
        isDirty: false,
        content: parsed.content,
        frontmatter: parsed.frontmatter
      })
    } else {
      tabStore.addTab({
        documentId: newDocumentId,
        path,
        title,
        isDirty: false,
        content: parsed.content,
        frontmatter: parsed.frontmatter,
        cursorPosition: { line: 1, column: 1 }
      })
    }

    // Set up document in editorStore
    useEditorStore.getState().setDocument({
      documentId: newDocumentId,
      path,
      content: parsed.content,
      frontmatter: parsed.frontmatter,
      isDirty: false
    })

    useEditorStore.getState().setCursorPosition(1, 1)
    setCurrentDocumentId(newDocumentId)

    // Load conversations, annotations, and suggestions for the document
    await useChatStore.getState().loadForDocument(newDocumentId)
    await useAnnotationStore.getState().loadAnnotations(newDocumentId)
    await useSuggestionStore.getState().loadSuggestions(newDocumentId)
    await useCommentStore.getState().loadComments(newDocumentId)

    // Clear reMarkable read-only state
    useEditorStore.getState().setRemarkableReadOnly(false, null)

    // Mark as editing
    useEditorStore.getState().setEditing(true)

    // Add to recent files
    useSettingsStore.getState().addRecentFile(path)

    // Highlight file in sidebar
    useFileListStore.getState().revealAndSelectPath(path)

    // Resume annotation position updates
    setTimeout(() => {
      useAnnotationStore.getState().setLoadingDocument(false)
    }, 100)

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

    useSuggestionStore.getState().setDocumentId(newDocumentId)
    useCommentStore.getState().setDocumentId(newDocumentId)

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
      const oldDocumentId = document.documentId
      const newDocumentId = await generateIdFromPath(finalPath)

      // Save-as changes the document identity. Await callback writes before
      // reading the old key, then migrate the complete review state alongside
      // the existing conversations/annotations migration.
      const suggestionStore = useSuggestionStore.getState()
      if (suggestionStore.pendingSave) await suggestionStore.pendingSave
      const reviewEventStore = useReviewEventStore.getState()
      if (reviewEventStore.pendingSave) await reviewEventStore.pendingSave

      const liveEditor = useEditorInstanceStore.getState().editor
      // The extension's lightweight reader type predates TipTap's concrete
      // Editor type; keep this boundary explicit while reusing the reader.
      const migratedReviewState = await migrateReviewState(oldDocumentId, newDocumentId, {
        liveSuggestions: liveEditor
          ? getAISuggestions(liveEditor as unknown as Parameters<typeof getAISuggestions>[0])
          : [],
        history: suggestionStore.history,
        events: reviewEventStore.events,
        comments: useCommentStore.getState().pendingComments,
      })

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

      // Keep renderer stores on the new identity. The current editor still
      // owns its live marks, so avoid triggering a second mark restoration.
      useSuggestionStore.setState({
        documentId: newDocumentId,
        pendingSuggestions: liveEditor ? [] : migratedReviewState.suggestions,
        history: migratedReviewState.history,
      })
      useReviewEventStore.setState({
        documentId: newDocumentId,
        events: migratedReviewState.events,
        pendingSave: null,
      })
      useCommentStore.setState({
        documentId: newDocumentId,
        pendingComments: migratedReviewState.comments,
        needsRestore: false,
      })

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
}, provenance?: ToolProvenance): Promise<ToolResult<{ path: string; opened: boolean }>> {
  const api = getApi()

  if (!api) {
    return toolError('File API not available', 'API_NOT_AVAILABLE')
  }

  const { content = '' } = args

  // Sanitize filename: replace forbidden chars and strip leading dots
  // Context-aware colon handling: "example: one" → "example - one", "example:two" → "example-two"
  const rawFilename = (args.filename || 'Untitled.md')
    .replace(/\s*:\s+/g, ' - ')  // colon with trailing space → spaced dash
    .replace(/:/g, '-')           // remaining colons → dash
    .replace(/[/\\\0]/g, '-')     // path separators and null bytes
    .replace(/^\.+/, '')          // strip leading dots
  const sanitizedFilename = rawFilename || 'Untitled.md'

  try {
    // Get the default save directory from settings
    const settings = useSettingsStore.getState().settings
    const targetFolder = settings.defaultSaveDirectory || (await api.getDocumentsPath())

    // Ensure filename has .md extension
    const finalFilename = sanitizedFilename.endsWith('.md') ? sanitizedFilename : `${sanitizedFilename}.md`

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

    if (provenance && content.trim().length > 0) {
      const editorDocument = useEditorStore.getState().document
      const annotationContent = editorDocument.content || content
      const annotationTo = await waitForEditorDocumentContent(editorDocument.documentId, annotationContent)

      // Skip the annotation if the editor isn't ready yet — annotationTo must be a
      // ProseMirror position (doc.content.size), not a raw character count.
      if (annotationTo !== null) {
        useAnnotationStore.getState().addAnnotation({
          documentId: editorDocument.documentId,
          type: 'insertion',
          from: 0,
          to: annotationTo,
          content: annotationContent,
          provenance: {
            model: provenance.model,
            conversationId: provenance.conversationId,
            messageId: provenance.messageId,
          },
          explanation: `Created ${attemptFilename}`,
        })
      }
    }

    return toolSuccess({ path: fullPath, opened: true })
  } catch (e) {
    return toolError(`Failed to create and open file: ${e}`, 'CREATE_FAILED')
  }
}
