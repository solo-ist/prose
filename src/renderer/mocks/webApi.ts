/**
 * Web mode mock implementation of ElectronAPI.
 *
 * Uses an in-memory Map<string, string> as the filesystem, pre-populated with
 * fixture files. Injected as window.api before the React app boots, enabling
 * the full renderer to run in any browser without Electron.
 */

import type {
  ElectronAPI,
  FileItem,
  FileResult,
  LLMStreamChunk,
  LLMStreamToolCall,
  LLMStreamComplete,
  LLMStreamError,
  McpStatus,
  Settings,
  TestApiKeyRequest,
  TestApiKeyResult,
  LLMRequest,
  LLMResponse,
  LLMStreamRequest,
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
} from '../types'
import type { ToolResult } from '../../shared/tools/types'
import { FIXTURES } from './fixtures'

const DOCUMENTS_ROOT = '/Documents'

const defaultSettings: Settings = {
  theme: 'dark',
  llm: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-5-20250929',
    apiKey: '',
    emojiIcons: true,
  },
  editor: {
    fontSize: 16,
    lineHeight: 1.6,
    fontFamily: "'IBM Plex Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
  },
}

export function createMockApi(): ElectronAPI {
  // In-memory filesystem: path → content
  const filesystem = new Map<string, string>(Object.entries(FIXTURES))

  // In-memory settings
  let settings: Settings = { ...defaultSettings }

  /**
   * Build a FileItem tree from the flat filesystem map for the given directory.
   * maxDepth controls how many levels of nesting to eagerly load.
   */
  function listDirectorySync(dirPath: string, maxDepth: number = 1): FileItem[] {
    const normalized = dirPath.endsWith('/') ? dirPath.slice(0, -1) : dirPath
    const prefix = normalized + '/'
    const items = new Map<string, FileItem>()
    const now = new Date().toISOString()

    for (const filePath of filesystem.keys()) {
      if (!filePath.startsWith(prefix)) continue

      const relative = filePath.slice(prefix.length)
      const parts = relative.split('/')

      if (parts.length === 1) {
        // Direct file child
        const name = parts[0]
        if (!items.has(name)) {
          items.set(name, {
            name,
            path: normalized + '/' + name,
            isDirectory: false,
            modifiedAt: now,
          })
        }
      } else {
        // Nested — first segment is a folder
        const folderName = parts[0]
        if (!items.has(folderName)) {
          const folderPath = normalized + '/' + folderName
          items.set(folderName, {
            name: folderName,
            path: folderPath,
            isDirectory: true,
            modifiedAt: now,
            hasChildren: true,
            children: maxDepth > 1 ? listDirectorySync(folderPath, maxDepth - 1) : undefined,
          })
        }
      }
    }

    // Sort: folders first, then files, alphabetically within each group
    return Array.from(items.values()).sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }

  /**
   * Derive a unique path for a duplicate. Appends " copy" or " copy 2", etc.
   */
  function deriveDuplicatePath(original: string): string {
    const dot = original.lastIndexOf('.')
    const ext = dot >= 0 ? original.slice(dot) : ''
    const base = dot >= 0 ? original.slice(0, dot) : original
    let candidate = base + ' copy' + ext
    let n = 2
    while (filesystem.has(candidate)) {
      candidate = base + ' copy ' + n + ext
      n++
    }
    return candidate
  }

  return {
    // ─── File operations ────────────────────────────────────────────────────

    openFile: async (): Promise<FileResult | null> => {
      // Return the first fixture file as a simulated "open" result
      const firstEntry = Array.from(filesystem.entries()).find(([, v]) => v !== '')
      if (!firstEntry) return null
      return { path: firstEntry[0], content: firstEntry[1] }
    },

    saveFile: async (path: string, content: string): Promise<void> => {
      filesystem.set(path, content)
    },

    saveFileAs: async (content: string, defaultFilename?: string): Promise<string | null> => {
      const filename = defaultFilename ?? 'Untitled.md'
      const filePath = DOCUMENTS_ROOT + '/' + filename
      filesystem.set(filePath, content)
      return filePath
    },

    readFile: async (path: string): Promise<string> => {
      if (!filesystem.has(path)) {
        throw new Error(`File not found: ${path}`)
      }
      return filesystem.get(path)!
    },

    fileExists: async (path: string): Promise<boolean> => {
      return filesystem.has(path)
    },

    fileStat: async (_path: string) => {
      const now = new Date().toISOString()
      return { createdAt: now, modifiedAt: now, size: filesystem.get(_path)?.length ?? 0 }
    },

    listDirectory: async (path: string, maxDepth?: number): Promise<FileItem[]> => {
      return listDirectorySync(path, maxDepth ?? 1)
    },

    getDocumentsPath: async (): Promise<string> => {
      return DOCUMENTS_ROOT
    },

    selectFolder: async (): Promise<string | null> => {
      // In web mode, return the documents root as the "selected" folder
      return DOCUMENTS_ROOT
    },

    saveToFolder: async (folder: string, filename: string, content: string): Promise<string> => {
      const filePath = folder + '/' + filename
      filesystem.set(filePath, content)
      return filePath
    },

    renameFile: async (oldPath: string, newPath: string): Promise<void> => {
      if (!filesystem.has(oldPath)) {
        throw new Error(`File not found: ${oldPath}`)
      }
      const content = filesystem.get(oldPath)!
      filesystem.delete(oldPath)
      filesystem.set(newPath, content)
    },

    deleteFile: async (path: string): Promise<void> => {
      filesystem.delete(path)
    },

    trashFile: async (path: string): Promise<void> => {
      filesystem.delete(path)
    },

    duplicateFile: async (path: string): Promise<string> => {
      if (!filesystem.has(path)) {
        throw new Error(`File not found: ${path}`)
      }
      const newPath = deriveDuplicatePath(path)
      filesystem.set(newPath, filesystem.get(path)!)
      return newPath
    },

    showInFolder: async (_path: string): Promise<void> => {
      // No-op in web mode
    },

    // ─── Settings ───────────────────────────────────────────────────────────

    loadSettings: async (): Promise<Settings> => {
      return { ...settings }
    },

    saveSettings: async (updated: Settings): Promise<void> => {
      settings = { ...updated }
    },

    // ─── LLM ────────────────────────────────────────────────────────────────

    testApiKey: async (_request: TestApiKeyRequest): Promise<TestApiKeyResult> => {
      return { success: false, message: 'LLM API calls are not available in web mode.' }
    },

    llmChat: async (_request: LLMRequest): Promise<LLMResponse> => {
      return { content: 'Web mode: LLM calls are not available. Configure an API key in the Electron app.' }
    },

    llmChatStream: async (_request: LLMStreamRequest): Promise<{ success: boolean }> => {
      // Immediately emit a stub complete event
      const { streamId } = _request
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('llm:stream:complete', {
            detail: { streamId, content: 'Web mode: LLM calls are not available.' } satisfies LLMStreamComplete,
          })
        )
      }, 0)
      return { success: true }
    },

    llmAbortStream: async (_streamId: string): Promise<{ success: boolean }> => {
      return { success: true }
    },

    onLLMStreamChunk: (callback: (chunk: LLMStreamChunk) => void) => {
      const handler = (e: Event) => callback((e as CustomEvent<LLMStreamChunk>).detail)
      window.addEventListener('llm:stream:chunk', handler)
      return () => window.removeEventListener('llm:stream:chunk', handler)
    },

    onLLMStreamToolCall: (callback: (toolCall: LLMStreamToolCall) => void) => {
      const handler = (e: Event) => callback((e as CustomEvent<LLMStreamToolCall>).detail)
      window.addEventListener('llm:stream:tool-call', handler)
      return () => window.removeEventListener('llm:stream:tool-call', handler)
    },

    onLLMStreamComplete: (callback: (complete: LLMStreamComplete) => void) => {
      const handler = (e: Event) => callback((e as CustomEvent<LLMStreamComplete>).detail)
      window.addEventListener('llm:stream:complete', handler)
      return () => window.removeEventListener('llm:stream:complete', handler)
    },

    onLLMStreamError: (callback: (error: LLMStreamError) => void) => {
      const handler = (e: Event) => callback((e as CustomEvent<LLMStreamError>).detail)
      window.addEventListener('llm:stream:error', handler)
      return () => window.removeEventListener('llm:stream:error', handler)
    },

    // ─── Window ─────────────────────────────────────────────────────────────

    closeWindow: async (): Promise<void> => {
      window.close()
    },

    onFullscreenChange: (_callback: (isFullscreen: boolean) => void) => {
      return () => {}
    },

    // ─── Menu / event listeners ──────────────────────────────────────────────

    onMenuAction: (_callback: (action: string) => void) => {
      return () => {}
    },

    onFileOpenExternal: (_callback: (path: string) => void) => {
      return () => {}
    },

    // ─── Platform ───────────────────────────────────────────────────────────

    platform: 'linux',

    // ─── Renderer ready ──────────────────────────────────────────────────────

    signalRendererReady: async () => ({ success: true }),

    // ─── File association ────────────────────────────────────────────────────

    fileAssociationIsDefault: async (): Promise<boolean | null> => {
      return null
    },

    // ─── Emoji ───────────────────────────────────────────────────────────────

    emojiGenerate: async (_title: string, _contentPreview?: string) => {
      return { emoji: null, error: 'Not available in web mode' }
    },

    // ─── Recent files ────────────────────────────────────────────────────────

    getRecentFiles: async (): Promise<string[]> => {
      return []
    },

    clearRecentFiles: async (): Promise<void> => {},

    // ─── MCP ─────────────────────────────────────────────────────────────────

    onMcpToolInvoke: (_callback: (requestId: string, toolName: string, args: unknown) => void) => {
      return () => {}
    },

    sendMcpToolResult: (_requestId: string, _result: ToolResult) => {
      // No-op
    },

    onMcpStatus: (_callback: (status: McpStatus) => void) => {
      return () => {}
    },

    // ─── reMarkable ──────────────────────────────────────────────────────────

    remarkableRegister: async (_code: string): Promise<RemarkableRegisterResponse> => {
      throw new Error('reMarkable sync is not available in web mode')
    },

    remarkableValidate: async (_deviceToken: string): Promise<boolean> => {
      return false
    },

    remarkableSync: async (_deviceToken: string, _syncDirectory: string): Promise<RemarkableSyncResult> => {
      throw new Error('reMarkable sync is not available in web mode')
    },

    remarkableDisconnect: async (): Promise<void> => {},

    remarkableGetMetadata: async (_syncDirectory: string): Promise<RemarkableSyncMetadata | null> => {
      return null
    },

    remarkableListCloudNotebooks: async (_deviceToken: string): Promise<RemarkableCloudNotebook[]> => {
      return []
    },

    remarkableGetSyncState: async (_syncDirectory: string): Promise<RemarkableSyncState | null> => {
      return null
    },

    remarkableUpdateSyncSelection: async (_syncDirectory: string, _selectedNotebooks: string[]): Promise<void> => {},

    remarkableStoreApiKey: async (_apiKey: string): Promise<void> => {},

    remarkableGetApiKey: async (): Promise<string | null> => {
      return null
    },

    remarkableClearApiKey: async (): Promise<void> => {},

    remarkableGetOCRPath: async (_notebookId: string, _syncDirectory: string): Promise<string | null> => {
      return null
    },

    remarkableGetEditablePath: async (_notebookId: string, _syncDirectory: string): Promise<string | null> => {
      return null
    },

    remarkableCreateEditableVersion: async (_notebookId: string, _syncDirectory: string): Promise<string | null> => {
      return null
    },

    remarkableFindNotebookByFilePath: async (_filePath: string, _syncDirectory: string): Promise<string | null> => {
      return null
    },

    remarkableClearNotebookMarkdownPath: async (_notebookId: string, _syncDirectory: string): Promise<boolean> => {
      return false
    },

    // ─── Google Docs ─────────────────────────────────────────────────────────

    googleIsConfigured: async (): Promise<boolean> => false,

    googleStartAuth: async (): Promise<GoogleAuthResult> => ({
      success: false,
      error: 'Google Docs sync is not available in web mode.',
    }),

    googleDisconnect: async (): Promise<void> => {},

    googleGetConnectionStatus: async (): Promise<GoogleConnectionStatus> => ({
      connected: false,
      error: 'Google Docs sync is not available in web mode.',
    }),

    googleSync: async (): Promise<GoogleSyncDocResult> => ({
      success: false,
      direction: 'push',
      error: 'Google Docs sync is not available in web mode.',
    }),

    googlePull: async (_docId: string): Promise<GooglePullResult> => ({
      success: false,
      error: 'Google Docs sync is not available in web mode.',
    }),

    googleImport: async (_docId: string): Promise<GoogleImportResult> => ({
      success: false,
      error: 'Google Docs sync is not available in web mode.',
    }),

    googleEnsureFolder: async (): Promise<string> => '',

    googleSyncAll: async (_syncDir: string): Promise<GoogleSyncAllResult> => ({
      synced: 0,
      skipped: 0,
      errors: ['Google Docs sync is not available in web mode.'],
    }),

    googleListRecentDocs: async (_maxResults?: number): Promise<GoogleDocMetadata[]> => [],

    googleGetSyncMetadata: async (): Promise<GoogleSyncMetadata | null> => null,

    googleUpdateSyncMetadataEntry: async (_entry: GoogleDocEntry): Promise<void> => {},

    googleRemoveSyncMetadataEntry: async (_googleDocId: string): Promise<void> => {},

    // ─── External URL ────────────────────────────────────────────────────────

    openExternal: async (url: string): Promise<void> => {
      window.open(url, '_blank', 'noopener,noreferrer')
    },
  }
}
