/**
 * File tool executors - tools for file system operations.
 * These wrap the existing IPC handlers exposed via window.api.
 */

import type { ToolResult, FileItem } from '../../../../shared/tools/types'
import { toolSuccess, toolError } from '../../../../shared/tools/types'
import { TOOL_FILE_ACCESS, type FileAccessOptions } from '../../../../shared/fileAccess'
import { isFileOperationFailure } from '../../../../shared/fileOperationResult'
import { useEditorStore } from '../../../stores/editorStore'
import { useEditorInstanceStore } from '../../../stores/editorInstanceStore'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useAnnotationStore } from '../../../extensions/ai-annotations'
import { generateIdFromPath } from '../../persistence'
import { useTabStore } from '../../../stores/tabStore'
import { openFile, newTab, markActiveTabSaved } from '../../../tabs/actions'
import { flushActiveProjections } from '../../../document/session'
import { buildSaveContent } from '../../../hooks/useEditor'
import type { ToolProvenance } from '../provenanceTypes'

/** Human-readable text for a thrown value, including structured file-operation failures. */
function describeError(e: unknown): string {
  if (isFileOperationFailure(e)) return e.message
  if (e instanceof Error) return e.message
  return String(e)
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
export async function executeOpenFile(
  args: { path: string },
  // Default: the path is a model argument (class B) and main contains it.
  // create_and_open_file passes `{}` because its path is app-derived from the
  // user-chosen save folder + a sanitized filename (class C), which may live
  // outside the home folder (external volume) and must still open.
  access: FileAccessOptions = TOOL_FILE_ACCESS
): Promise<ToolResult<{ opened: boolean; path: string }>> {
  const api = getApi()

  if (!api) {
    return toolError('File API not available', 'API_NOT_AVAILABLE')
  }

  const { path } = args

  if (!path) {
    return toolError('Path is required', 'INVALID_INPUT')
  }

  try {
    // One implementation for every open (#1145): already open → switch,
    // empty untitled active tab → replace in place, else a new tab. The
    // leaving tab is flushed and its records persisted under its own id.
    await openFile(path, { access })
    return toolSuccess({ opened: true, path })
  } catch (e) {
    return toolError(`Failed to open file: ${describeError(e)}`, 'OPEN_FAILED')
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
    const tabId = await newTab({ content })
    const tab = useTabStore.getState().getTabById(tabId)
    if (!tab) return toolError('Failed to create new file: tab not found', 'CREATE_FAILED')

    return toolSuccess({
      created: true,
      documentId: tab.documentId
    })
  } catch (e) {
    return toolError(`Failed to create new file: ${describeError(e)}`, 'CREATE_FAILED')
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

  // The session projects the document to the store on a 500 ms debounce;
  // land it first so the save holds the last keystrokes.
  flushActiveProjections()
  const { document } = useEditorStore.getState()
  const targetPath = args.path ?? document.path
  const content = buildSaveContent(document.content, document.frontmatter, targetPath)

  try {
    let finalPath: string

    if (args.path) {
      // Save to the model-specified path — contained by main (#918).
      await api.saveFile(args.path, content, TOOL_FILE_ACCESS)
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

    // The active tab adopts the path: identity, records (conversations,
    // annotations, suggestions, comments) and the disk baseline follow.
    await markActiveTabSaved(finalPath)

    return toolSuccess({ saved: true, path: finalPath })
  } catch (e) {
    return toolError(`Failed to save file: ${describeError(e)}`, 'SAVE_FAILED')
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
    const files = await api.listDirectory(path, maxDepth, false, TOOL_FILE_ACCESS)
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
    return toolError(`Failed to list directory: ${describeError(e)}`, 'LIST_FAILED')
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
    const content = await api.readFile(path, TOOL_FILE_ACCESS)
    return toolSuccess({ content, path })
  } catch (e) {
    return toolError(`Failed to read file: ${describeError(e)}`, 'READ_FAILED')
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

    // Open the newly created file (user-chosen folder, not a model path — see executeOpenFile).
    const openResult = await executeOpenFile({ path: fullPath }, {})

    if (!openResult.success) {
      return toolError(
        `File created at ${fullPath} but failed to open: ${openResult.error}`,
        'OPEN_FAILED'
      )
    }

    if (provenance && content.trim().length > 0) {
      // Compute the expected documentId from the path — same derivation as executeOpenFile —
      // so we don't rely on reading editorStore before its async store update settles.
      const newDocumentId = await generateIdFromPath(fullPath)
      const annotationTo = await waitForEditorDocumentContent(newDocumentId, content)

      // Skip the annotation if the editor isn't ready yet — annotationTo must be a
      // ProseMirror position (doc.content.size), not a raw character count.
      if (annotationTo !== null) {
        useAnnotationStore.getState().addAnnotation({
          documentId: newDocumentId,
          type: 'insertion',
          from: 0,
          to: annotationTo,
          content,
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
    return toolError(`Failed to create and open file: ${describeError(e)}`, 'CREATE_FAILED')
  }
}
