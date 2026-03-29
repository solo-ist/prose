/**
 * Mock ElectronAPI for web mode.
 *
 * Implements the full ElectronAPI interface using an in-memory Map<string, string>
 * as the filesystem. Pre-populated with fixture files so the UI renders with
 * content out of the box.
 */

import type {
  ElectronAPI,
  Settings,
  FileItem,
  FileResult,
  LLMRequest,
  LLMResponse,
  LLMStreamRequest,
  LLMStreamChunk,
  LLMStreamToolCall,
  LLMStreamComplete,
  LLMStreamError,
  RemarkableRegisterResponse,
  RemarkableSyncResult,
  RemarkableSyncMetadata,
  RemarkableCloudNotebook,
  RemarkableSyncState,
  GoogleAuthResult,
  GoogleConnectionStatus,
  GoogleSyncDocResult,
  GooglePullResult,
  GoogleImportResult,
  GoogleSyncAllResult,
  GoogleDocMetadata,
  GoogleSyncMetadata,
  GoogleDocEntry,
  McpStatus,
  TestApiKeyRequest,
  TestApiKeyResult,
} from '../types'
import type { ToolResult } from '../../shared/tools/types'
import { fixtures, DOCUMENTS_ROOT } from './fixtures'

// ---------------------------------------------------------------------------
// In-memory filesystem
// ---------------------------------------------------------------------------

const fs = new Map<string, string>(Object.entries(fixtures))

const now = () => new Date().toISOString()

// ---------------------------------------------------------------------------
// Settings (in-memory with localStorage fallback)
// ---------------------------------------------------------------------------

const SETTINGS_KEY = 'prose:web-mode-settings'

const defaultSettings: Settings = {
  theme: 'dark',
  llm: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-5-20250929',
    apiKey: '',
  },
  editor: {
    fontSize: 16,
    lineHeight: 1.6,
    fontFamily: '"IBM Plex Mono", monospace',
  },
}

let memorySettings: Settings = { ...defaultSettings }

// ---------------------------------------------------------------------------
// listDirectory helper
// ---------------------------------------------------------------------------

/**
 * Build a FileItem[] tree from the flat map keys, rooted at `dirPath`.
 * When maxDepth === 1, subdirectories get hasChildren set but no children array.
 */
function buildTree(dirPath: string, maxDepth = 10, depth = 0): FileItem[] {
  // Normalise: strip trailing slash
  const root = dirPath.replace(/\/$/, '')

  // Collect all immediate children (files and folders one level deep)
  const seen = new Set<string>()
  const items: FileItem[] = []

  for (const filePath of fs.keys()) {
    if (!filePath.startsWith(root + '/')) continue

    const rest = filePath.slice(root.length + 1) // e.g. "foo.md" or "subdir/bar.md"
    const firstSegment = rest.split('/')[0]
    if (!firstSegment || seen.has(firstSegment)) continue
    seen.add(firstSegment)

    const childPath = `${root}/${firstSegment}`
    const isDirectory = rest.includes('/')

    if (isDirectory) {
      const hasChildren = Array.from(fs.keys()).some(
        (p) => p.startsWith(childPath + '/') && p !== childPath
      )
      const item: FileItem = {
        name: firstSegment,
        path: childPath,
        isDirectory: true,
        modifiedAt: now(),
        hasChildren,
      }
      if (maxDepth > 1 && depth < maxDepth - 1) {
        item.children = buildTree(childPath, maxDepth, depth + 1)
      }
      items.push(item)
    } else {
      items.push({
        name: firstSegment,
        path: childPath,
        isDirectory: false,
        modifiedAt: now(),
      })
    }
  }

  // Sort: directories first, then alphabetical
  items.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return items
}

// ---------------------------------------------------------------------------
// Mock API implementation
// ---------------------------------------------------------------------------

export function createMockApi(): ElectronAPI {
  return {
    // ---- File operations --------------------------------------------------

    openFile: async (): Promise<FileResult | null> => {
      if ('showOpenFilePicker' in window) {
        try {
          const [fileHandle] = await (window as Window & { showOpenFilePicker: (options?: object) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker({
            types: [
              { description: 'Markdown files', accept: { 'text/markdown': ['.md', '.markdown'] } },
              { description: 'Text files', accept: { 'text/plain': ['.txt'] } },
            ],
          })
          const file = await fileHandle.getFile()
          const content = await file.text()
          // Also store in in-memory fs so readFile/saveFile work
          const path = `${DOCUMENTS_ROOT}/${file.name}`
          fs.set(path, content)
          return { path, content }
        } catch (e) {
          if ((e as Error).name !== 'AbortError') console.error('Error opening file:', e)
          return null
        }
      }
      // Fallback: <input type="file">
      return new Promise((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.md,.markdown,.txt'
        input.onchange = async (e) => {
          const file = (e.target as HTMLInputElement).files?.[0]
          if (file) {
            const content = await file.text()
            const path = `${DOCUMENTS_ROOT}/${file.name}`
            fs.set(path, content)
            resolve({ path, content })
          } else {
            resolve(null)
          }
        }
        input.click()
      })
    },

    saveFile: async (path: string, content: string): Promise<void> => {
      fs.set(path, content)
    },

    saveFileAs: async (content: string, defaultFilename?: string): Promise<string | null> => {
      if ('showSaveFilePicker' in window) {
        try {
          const fileHandle = await (window as Window & { showSaveFilePicker: (options?: object) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
            suggestedName: defaultFilename ?? 'Untitled.md',
            types: [{ description: 'Markdown files', accept: { 'text/markdown': ['.md'] } }],
          })
          const writable = await fileHandle.createWritable()
          await writable.write(content)
          await writable.close()
          const path = `${DOCUMENTS_ROOT}/${fileHandle.name}`
          fs.set(path, content)
          return path
        } catch (e) {
          if ((e as Error).name !== 'AbortError') console.error('Error saving file:', e)
          return null
        }
      }
      // Fallback: <a download>
      const filename = defaultFilename ?? 'Untitled.md'
      const blob = new Blob([content], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      const path = `${DOCUMENTS_ROOT}/${filename}`
      fs.set(path, content)
      return path
    },

    readFile: async (path: string): Promise<string> => {
      if (!fs.has(path)) throw new Error(`File not found: ${path}`)
      return fs.get(path) ?? ''
    },

    // ---- Settings ---------------------------------------------------------

    loadSettings: async (): Promise<Settings> => {
      try {
        const stored = localStorage.getItem(SETTINGS_KEY)
        if (stored) {
          memorySettings = { ...defaultSettings, ...JSON.parse(stored) }
          return memorySettings
        }
      } catch {
        // ignore
      }
      return { ...defaultSettings }
    },

    saveSettings: async (settings: Settings): Promise<void> => {
      memorySettings = settings
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
      } catch {
        // ignore
      }
    },

    testApiKey: async (_request: TestApiKeyRequest): Promise<TestApiKeyResult> => ({
      success: false,
      message: 'Not available in web mode',
    }),

    // ---- Event listeners --------------------------------------------------

    onMenuAction: (_callback: (action: string) => void) => () => {},

    onFileOpenExternal: (_callback: (path: string) => void) => () => {},

    // ---- LLM (stub) -------------------------------------------------------

    llmChat: async (_request: LLMRequest): Promise<LLMResponse> => {
      return {
        content:
          '**Web mode:** LLM calls are not available without an API key. Configure your Anthropic API key in Settings to enable AI features.',
      }
    },

    llmChatStream: async (request: LLMStreamRequest): Promise<{ success: boolean }> => {
      const { streamId } = request
      const message =
        '**Web mode:** LLM calls are not available without an API key. Configure your Anthropic API key in Settings.'

      // Emit a single complete event
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('llm:stream:complete', {
            detail: { streamId, content: message } satisfies LLMStreamComplete,
          })
        )
      }, 50)

      return { success: true }
    },

    llmAbortStream: async (_streamId: string): Promise<{ success: boolean }> => ({
      success: false,
    }),

    onLLMStreamChunk: (callback: (chunk: LLMStreamChunk) => void) => {
      const handler = (e: Event) => callback((e as CustomEvent).detail)
      window.addEventListener('llm:stream:chunk', handler)
      return () => window.removeEventListener('llm:stream:chunk', handler)
    },

    onLLMStreamToolCall: (callback: (toolCall: LLMStreamToolCall) => void) => {
      const handler = (e: Event) => callback((e as CustomEvent).detail)
      window.addEventListener('llm:stream:tool-call', handler)
      return () => window.removeEventListener('llm:stream:tool-call', handler)
    },

    onLLMStreamComplete: (callback: (complete: LLMStreamComplete) => void) => {
      const handler = (e: Event) => callback((e as CustomEvent).detail)
      window.addEventListener('llm:stream:complete', handler)
      return () => window.removeEventListener('llm:stream:complete', handler)
    },

    onLLMStreamError: (callback: (error: LLMStreamError) => void) => {
      const handler = (e: Event) => callback((e as CustomEvent).detail)
      window.addEventListener('llm:stream:error', handler)
      return () => window.removeEventListener('llm:stream:error', handler)
    },

    // ---- Platform ---------------------------------------------------------

    platform: 'linux',

    // ---- Renderer ready ---------------------------------------------------

    signalRendererReady: async () => ({ success: true }),

    // ---- Folder / filesystem operations -----------------------------------

    selectFolder: async (): Promise<{ path: string; bookmark: string | null } | null> => ({ path: DOCUMENTS_ROOT, bookmark: null }),

    saveToFolder: async (folder: string, filename: string, content: string): Promise<string> => {
      const path = `${folder}/${filename}`
      fs.set(path, content)
      return path
    },

    getDocumentsPath: async (): Promise<string> => DOCUMENTS_ROOT,

    fileExists: async (path: string): Promise<boolean> => fs.has(path),

    fileStat: async (
      _path: string
    ): Promise<{ createdAt: string; modifiedAt: string; size: number }> => ({
      createdAt: now(),
      modifiedAt: now(),
      size: fs.get(_path)?.length ?? 0,
    }),

    showInFolder: async (_path: string): Promise<void> => {},

    renameFile: async (oldPath: string, newPath: string): Promise<void> => {
      if (!fs.has(oldPath)) throw new Error(`File not found: ${oldPath}`)
      fs.set(newPath, fs.get(oldPath)!)
      fs.delete(oldPath)
    },

    deleteFile: async (path: string): Promise<void> => {
      fs.delete(path)
    },

    trashFile: async (path: string): Promise<void> => {
      fs.delete(path)
    },

    duplicateFile: async (path: string): Promise<string> => {
      if (!fs.has(path)) throw new Error(`File not found: ${path}`)
      const ext = path.includes('.') ? path.slice(path.lastIndexOf('.')) : ''
      const base = path.slice(0, path.length - ext.length)
      const newPath = `${base} copy${ext}`
      fs.set(newPath, fs.get(path)!)
      return newPath
    },

    listDirectory: async (path: string, maxDepth = 1): Promise<FileItem[]> =>
      buildTree(path, maxDepth),

    // ---- Window operations (no-ops) --------------------------------------

    closeWindow: async (): Promise<void> => {
      window.close()
    },

    openExternal: async (url: string): Promise<void> => {
      window.open(url, '_blank', 'noopener,noreferrer')
    },

    // ---- MCP (stubs) ------------------------------------------------------

    onMcpToolInvoke: (
      _callback: (requestId: string, toolName: string, args: unknown) => void
    ) => () => {},

    sendMcpToolResult: (_requestId: string, _result: ToolResult): void => {},

    onMcpStatus: (callback: (status: McpStatus) => void) => {
      // Report not connected immediately
      setTimeout(() => callback({ connected: false, port: 0 }), 0)
      return () => {}
    },

    // ---- File association (stub) ------------------------------------------

    fileAssociationIsDefault: async (): Promise<boolean | null> => null,

    // ---- reMarkable (stubs) -----------------------------------------------

    remarkableRegister: async (_code: string): Promise<RemarkableRegisterResponse> => {
      throw new Error('reMarkable not available in web mode')
    },

    remarkableValidate: async (_deviceToken: string): Promise<boolean> => false,

    remarkableSync: async (
      _deviceToken: string,
      _syncDirectory: string
    ): Promise<RemarkableSyncResult> => {
      throw new Error('reMarkable sync is not available in web mode')
    },

    remarkableDisconnect: async (_syncDirectory?: string): Promise<void> => {},

    remarkableGetMetadata: async (
      _syncDirectory: string
    ): Promise<RemarkableSyncMetadata | null> => null,

    remarkableListCloudNotebooks: async (
      _deviceToken: string
    ): Promise<RemarkableCloudNotebook[]> => [],

    remarkableGetSyncState: async (
      _syncDirectory: string
    ): Promise<RemarkableSyncState | null> => null,

    remarkableUpdateSyncSelection: async (
      _syncDirectory: string,
      _selectedNotebooks: string[]
    ): Promise<void> => {},

    remarkableStoreApiKey: async (_apiKey: string): Promise<void> => {},

    remarkableGetApiKey: async (): Promise<string | null> => null,

    remarkableClearApiKey: async (): Promise<void> => {},

    remarkableGetOCRPath: async (
      _notebookId: string,
      _syncDirectory: string
    ): Promise<string | null> => null,

    remarkableGetEditablePath: async (
      _notebookId: string,
      _syncDirectory: string
    ): Promise<string | null> => null,

    remarkableCreateEditableVersion: async (
      _notebookId: string,
      _syncDirectory: string
    ): Promise<string | null> => null,

    remarkableFindNotebookByFilePath: async (
      _filePath: string,
      _syncDirectory: string
    ): Promise<string | null> => null,

    remarkableClearNotebookMarkdownPath: async (
      _notebookId: string,
      _syncDirectory: string
    ): Promise<boolean> => false,

    // ---- Google Docs (stubs) ----------------------------------------------

    googleIsConfigured: async (): Promise<boolean> => false,

    googleStartAuth: async (): Promise<GoogleAuthResult> => ({
      success: false,
      error: 'Google Docs is not available in web mode',
    }),

    googleDisconnect: async (): Promise<void> => {},

    googleGetConnectionStatus: async (): Promise<GoogleConnectionStatus> => ({
      connected: false,
      error: 'Google Docs is not available in web mode',
    }),

    googleSync: async (): Promise<GoogleSyncDocResult> => ({
      success: false,
      direction: 'push',
      error: 'Google Docs is not available in web mode',
    }),

    googlePull: async (_docId: string): Promise<GooglePullResult> => ({
      success: false,
      error: 'Google Docs is not available in web mode',
    }),

    googleImport: async (_docId: string): Promise<GoogleImportResult> => ({
      success: false,
      error: 'Google Docs is not available in web mode',
    }),

    googleEnsureFolder: async (): Promise<string> => DOCUMENTS_ROOT,

    googleSyncAll: async (_syncDir: string): Promise<GoogleSyncAllResult> => ({
      synced: 0,
      skipped: 0,
      errors: ['Google Docs is not available in web mode'],
    }),

    googleListRecentDocs: async (_maxResults?: number): Promise<GoogleDocMetadata[]> => [],

    googleGetSyncMetadata: async (): Promise<GoogleSyncMetadata | null> => null,

    googleUpdateSyncMetadataEntry: async (_entry: GoogleDocEntry): Promise<void> => {},

    googleRemoveSyncMetadataEntry: async (_googleDocId: string): Promise<void> => {},

    // ---- Emoji generation (stub) -----------------------------------------

    emojiGenerate: async (
      _title: string,
      _contentPreview?: string
    ): Promise<{ emoji: string | null; error?: string }> => ({
      emoji: null,
      error: 'Not available in web mode',
    }),

    // ---- Fullscreen (stub) ------------------------------------------------

    onFullscreenChange: (_callback: (isFullscreen: boolean) => void) => () => {},

    // ---- Recent files (stub) ----------------------------------------------

    getRecentFiles: async (): Promise<string[]> => [],

    clearRecentFiles: async (): Promise<void> => {},
  }
}
