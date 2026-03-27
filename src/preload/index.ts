import { contextBridge, ipcRenderer } from 'electron'
import type { Settings } from '../renderer/types'
import type { ToolResult } from '../shared/tools/types'

export interface FileResult {
  path: string
  content: string
}

export interface LLMMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
}

export interface LLMToolDefinition {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface LLMRequest {
  provider: string
  model: string
  apiKey: string
  baseUrl?: string
  messages: LLMMessage[]
  system: string
}

export interface LLMResponse {
  content: string
}

export interface LLMStreamRequest extends LLMRequest {
  streamId: string
  tools?: LLMToolDefinition[]
  maxToolRoundtrips?: number
}

export interface LLMStreamChunk {
  streamId: string
  delta: string
}

export interface LLMStreamToolCall {
  streamId: string
  toolCall: {
    id: string
    name: string
    args: unknown
  }
}

export interface LLMStreamComplete {
  streamId: string
  content: string
  toolCalls?: Array<{
    id: string
    name: string
    args: unknown
  }>
}

export interface LLMStreamError {
  streamId: string
  error: string
}

export interface McpStatus {
  connected: boolean
  port: number
  error?: string
}

export interface TestApiKeyRequest {
  provider: string
  apiKey: string
  baseUrl?: string
}

export interface TestApiKeyResult {
  success: boolean
  message: string
}

export interface GoogleAuthResult {
  success: boolean
  email?: string
  picture?: string
  error?: string
}

export interface GoogleConnectionStatus {
  connected: boolean
  email?: string
  picture?: string
  error?: string
}

export interface GoogleSyncDocResult {
  success: boolean
  direction: 'push' | 'pull' | 'create'
  docId?: string
  webViewLink?: string
  content?: string
  modifiedTime?: string
  error?: string
}

export interface GooglePullResult {
  success: boolean
  content?: string
  modifiedTime?: string
  error?: string
}

export interface GoogleImportResult {
  success: boolean
  content?: string
  title?: string
  docId?: string
  error?: string
}

export interface GoogleSyncAllResult {
  synced: number
  skipped: number
  errors: string[]
}

export interface GoogleDocMetadata {
  id: string
  title: string
  modifiedTime: string
  webViewLink: string
}

export interface GoogleDocEntry {
  title: string
  googleDocId: string
  localPath: string
  webViewLink: string
  syncedAt: string
  remoteModifiedTime: string
  localModifiedAt?: string
  status?: 'ok' | 'missing'
}

export interface GoogleSyncMetadata {
  lastSyncedAt: string
  documents: Record<string, GoogleDocEntry>
}

export interface McpServerStatus {
  installed: boolean
  version: string | null
  appVersion: string
  needsUpdate: boolean
  configPath: string
  serverPath: string
}

export interface McpInstallResult {
  success: boolean
  error?: string
}

export interface ElectronAPI {
  openFile: () => Promise<FileResult | null>
  saveFile: (path: string, content: string) => Promise<void>
  saveFileAs: (content: string, defaultFilename?: string) => Promise<string | null>
  exportTxt: (content: string, defaultFilename?: string) => Promise<string | null>
  readFile: (path: string) => Promise<string>
  loadSettings: () => Promise<Settings>
  saveSettings: (settings: Settings) => Promise<void>
  testApiKey: (request: TestApiKeyRequest) => Promise<TestApiKeyResult>
  onMenuAction: (callback: (action: string) => void) => () => void
  onFileOpenExternal: (callback: (path: string) => void) => () => void
  llmChat: (request: LLMRequest) => Promise<LLMResponse>
  platform: 'aix' | 'darwin' | 'freebsd' | 'linux' | 'openbsd' | 'sunos' | 'win32' | 'android' | 'cygwin' | 'netbsd'
  // Renderer ready signal
  signalRendererReady: () => Promise<{ success: boolean }>
  // Streaming LLM
  llmChatStream: (request: LLMStreamRequest) => Promise<{ success: boolean }>
  llmAbortStream: (streamId: string) => Promise<{ success: boolean }>
  onLLMStreamChunk: (callback: (chunk: LLMStreamChunk) => void) => () => void
  onLLMStreamToolCall: (callback: (toolCall: LLMStreamToolCall) => void) => () => void
  onLLMStreamComplete: (callback: (complete: LLMStreamComplete) => void) => () => void
  onLLMStreamError: (callback: (error: LLMStreamError) => void) => () => void
  // Folder operations for quick save
  selectFolder: () => Promise<{ path: string; bookmark: string | null } | null>
  saveToFolder: (folder: string, filename: string, content: string) => Promise<string>
  getDocumentsPath: () => Promise<string>
  fileExists: (path: string) => Promise<boolean>
  fileStat: (path: string) => Promise<{ createdAt: string; modifiedAt: string; size: number }>
  showInFolder: (path: string) => Promise<void>
  renameFile: (oldPath: string, newPath: string) => Promise<void>
  deleteFile: (path: string) => Promise<void>
  trashFile: (path: string) => Promise<void>
  duplicateFile: (path: string) => Promise<string>
  // Window operations
  closeWindow: () => Promise<void>
  isFullScreen: () => Promise<boolean>
  exitFullScreen: () => Promise<void>
  listDirectory: (path: string, maxDepth?: number) => Promise<FileItem[]>
  remarkableRegister: (code: string) => Promise<RemarkableRegisterResponse>
  remarkableValidate: (deviceToken: string) => Promise<boolean>
  remarkableSync: (deviceToken: string, syncDirectory: string) => Promise<RemarkableSyncResult>
  remarkableDisconnect: (syncDirectory?: string) => Promise<void>
  remarkableGetMetadata: (syncDirectory: string) => Promise<RemarkableSyncMetadata | null>
  remarkableListCloudNotebooks: (deviceToken: string) => Promise<RemarkableCloudNotebook[]>
  remarkableGetSyncState: (syncDirectory: string) => Promise<RemarkableSyncState | null>
  remarkableUpdateSyncSelection: (syncDirectory: string, selectedNotebooks: string[]) => Promise<void>
  // Secure API key storage for reMarkable OCR
  remarkableStoreApiKey: (apiKey: string) => Promise<void>
  remarkableGetApiKey: () => Promise<string | null>
  remarkableClearApiKey: () => Promise<void>
  // reMarkable read-only/editable version paths
  remarkableGetOCRPath: (notebookId: string, syncDirectory: string) => Promise<string | null>
  remarkableGetEditablePath: (notebookId: string, syncDirectory: string) => Promise<string | null>
  remarkableCreateEditableVersion: (notebookId: string, syncDirectory: string) => Promise<string | null>
  remarkableFindNotebookByFilePath: (filePath: string, syncDirectory: string) => Promise<string | null>
  remarkableClearNotebookMarkdownPath: (notebookId: string, syncDirectory: string) => Promise<boolean>
  // MCP tool execution (only used in MCP server mode)
  onMcpToolInvoke: (
    callback: (requestId: string, toolName: string, args: unknown) => void
  ) => () => void
  sendMcpToolResult: (requestId: string, result: ToolResult) => void
  // MCP server status
  onMcpStatus: (callback: (status: McpStatus) => void) => () => void
  // File association (default markdown editor)
  fileAssociationIsDefault: () => Promise<boolean | null>
  // Google Docs integration
  googleIsConfigured: () => Promise<boolean>
  googleStartAuth: () => Promise<GoogleAuthResult>
  googleDisconnect: () => Promise<void>
  googleGetConnectionStatus: () => Promise<GoogleConnectionStatus>
  googleSync: (content: string, frontmatter: Record<string, unknown>, title: string) => Promise<GoogleSyncDocResult>
  googlePull: (docId: string) => Promise<GooglePullResult>
  googleImport: (docId: string) => Promise<GoogleImportResult>
  googleEnsureFolder: () => Promise<string>
  googleSyncAll: (syncDir: string) => Promise<GoogleSyncAllResult>
  googleListRecentDocs: (maxResults?: number) => Promise<GoogleDocMetadata[]>
  googleGetSyncMetadata: () => Promise<GoogleSyncMetadata | null>
  googleUpdateSyncMetadataEntry: (entry: GoogleDocEntry) => Promise<void>
  googleRemoveSyncMetadataEntry: (googleDocId: string) => Promise<void>
  // MCP Server integration
  mcpGetStatus: () => Promise<McpServerStatus>
  mcpInstall: () => Promise<McpInstallResult>
  mcpUninstall: () => Promise<McpInstallResult>
  // Emoji generation (runs in main process to avoid CORS)
  emojiGenerate: (title: string, contentPreview?: string) => Promise<{ emoji: string | null; error?: string }>
  // Window fullscreen state
  onFullscreenChange: (callback: (isFullscreen: boolean) => void) => () => void
  // Recent files
  refreshRecentMenu: () => Promise<void>
  clearRecentFiles: () => Promise<void>
  // Sentry error tracking
  sentrySetEnabled: (enabled: boolean) => Promise<void>
}

export interface FileItem {
  name: string
  path: string
  isDirectory: boolean
  modifiedAt: string
  children?: FileItem[]
  hasChildren?: boolean // For lazy loading - indicates folder has content without loading it
}

export interface RemarkableRegisterResponse {
  deviceToken: string
}

export interface RemarkableSyncResult {
  syncedAt: string
  synced: number
  skipped: number
  errors: string[]
}

export interface RemarkableNotebookMetadata {
  name: string
  parent: string | null
  type: 'folder' | 'notebook'
  fileType?: 'epub' | 'pdf' | 'notebook'
  lastModified: string
  hash: string
  localPath: string
  markdownPath?: string
}

export interface RemarkableSyncMetadata {
  lastSyncedAt: string
  notebooks: Record<string, RemarkableNotebookMetadata>
}

export interface RemarkableCloudNotebook {
  id: string
  name: string
  type: 'folder' | 'notebook'
  parent: string | null
  fileType?: string
}

export interface RemarkableSyncState {
  selectedNotebooks: string[]
  lastUpdated: string
}

const api: ElectronAPI = {
  openFile: () => ipcRenderer.invoke('file:open'),
  saveFile: (path: string, content: string) => ipcRenderer.invoke('file:save', path, content),
  saveFileAs: (content: string, defaultFilename?: string) => ipcRenderer.invoke('file:saveAs', content, defaultFilename),
  exportTxt: (content: string, defaultFilename?: string) => ipcRenderer.invoke('file:exportTxt', content, defaultFilename),
  readFile: (path: string) => ipcRenderer.invoke('file:read', path),
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings: Settings) => ipcRenderer.invoke('settings:save', settings),
  testApiKey: (request: TestApiKeyRequest) => ipcRenderer.invoke('settings:testApiKey', request),
  isSecureStorageAvailable: () => ipcRenderer.invoke('settings:isSecureStorageAvailable'),
  onMenuAction: (callback: (action: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, action: string): void => {
      callback(action)
    }
    ipcRenderer.on('menu:action', handler)
    return () => {
      ipcRenderer.removeListener('menu:action', handler)
    }
  },
  onFileOpenExternal: (callback: (path: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, path: string): void => {
      callback(path)
    }
    ipcRenderer.on('file:openExternal', handler)
    return () => {
      ipcRenderer.removeListener('file:openExternal', handler)
    }
  },
  llmChat: (request: LLMRequest) => ipcRenderer.invoke('llm:chat', request),
  platform: process.platform,
  // Renderer ready signal
  signalRendererReady: () => ipcRenderer.invoke('renderer:ready'),
  // Streaming LLM
  llmChatStream: (request: LLMStreamRequest) => ipcRenderer.invoke('llm:stream', request),
  llmAbortStream: (streamId: string) => ipcRenderer.invoke('llm:stream:abort', streamId),
  // Folder operations for quick save
  selectFolder: (defaultPath?: string) => ipcRenderer.invoke('file:selectFolder', defaultPath),
  saveToFolder: (folder: string, filename: string, content: string) =>
    ipcRenderer.invoke('file:saveToFolder', folder, filename, content),
  getDocumentsPath: () => ipcRenderer.invoke('file:documentsPath'),
  saveImage: (documentDir: string, base64Data: string, mimeType: string, originalName?: string) =>
    ipcRenderer.invoke('file:saveImage', documentDir, base64Data, mimeType, originalName),
  fileExists: (path: string) => ipcRenderer.invoke('file:exists', path),
  fileStat: (path: string) => ipcRenderer.invoke('file:stat', path),
  showInFolder: (path: string) => ipcRenderer.invoke('file:showInFolder', path),
  renameFile: (oldPath: string, newPath: string) => ipcRenderer.invoke('file:rename', oldPath, newPath),
  deleteFile: (path: string) => ipcRenderer.invoke('file:delete', path),
  trashFile: (path: string) => ipcRenderer.invoke('file:trash', path),
  duplicateFile: (path: string) => ipcRenderer.invoke('file:duplicate', path),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isFullScreen: () => ipcRenderer.invoke('window:isFullScreen'),
  exitFullScreen: () => ipcRenderer.invoke('window:exitFullScreen'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  listDirectory: (path: string, maxDepth?: number) => ipcRenderer.invoke('file:listDirectory', path, maxDepth),
  remarkableRegister: (code: string) => ipcRenderer.invoke('remarkable:register', code),
  remarkableValidate: (deviceToken: string) => ipcRenderer.invoke('remarkable:validate', deviceToken),
  remarkableSync: (deviceToken: string, syncDirectory: string) =>
    ipcRenderer.invoke('remarkable:sync', deviceToken, syncDirectory),
  remarkableDisconnect: (syncDirectory?: string) => ipcRenderer.invoke('remarkable:disconnect', syncDirectory),
  remarkableGetMetadata: (syncDirectory: string) => ipcRenderer.invoke('remarkable:getMetadata', syncDirectory),
  remarkableListCloudNotebooks: (deviceToken: string) =>
    ipcRenderer.invoke('remarkable:listCloudNotebooks', deviceToken),
  remarkableGetSyncState: (syncDirectory: string) =>
    ipcRenderer.invoke('remarkable:getSyncState', syncDirectory),
  remarkableUpdateSyncSelection: (syncDirectory: string, selectedNotebooks: string[]) =>
    ipcRenderer.invoke('remarkable:updateSyncSelection', syncDirectory, selectedNotebooks),
  // Secure API key storage for reMarkable OCR
  remarkableStoreApiKey: (apiKey: string) => ipcRenderer.invoke('remarkable:storeApiKey', apiKey),
  remarkableGetApiKey: () => ipcRenderer.invoke('remarkable:getApiKey'),
  remarkableClearApiKey: () => ipcRenderer.invoke('remarkable:clearApiKey'),
  // reMarkable read-only/editable version paths
  remarkableGetOCRPath: (notebookId: string, syncDirectory: string) =>
    ipcRenderer.invoke('remarkable:getOCRPath', notebookId, syncDirectory),
  remarkableGetEditablePath: (notebookId: string, syncDirectory: string) =>
    ipcRenderer.invoke('remarkable:getEditablePath', notebookId, syncDirectory),
  remarkableCreateEditableVersion: (notebookId: string, syncDirectory: string) =>
    ipcRenderer.invoke('remarkable:createEditableVersion', notebookId, syncDirectory),
  remarkableFindNotebookByFilePath: (filePath: string, syncDirectory: string) =>
    ipcRenderer.invoke('remarkable:findNotebookByFilePath', filePath, syncDirectory),
  remarkableClearNotebookMarkdownPath: (notebookId: string, syncDirectory: string) =>
    ipcRenderer.invoke('remarkable:clearNotebookMarkdownPath', notebookId, syncDirectory),
  // MCP tool execution
  onMcpToolInvoke: (callback: (requestId: string, toolName: string, args: unknown) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      requestId: string,
      toolName: string,
      args: unknown
    ): void => {
      callback(requestId, toolName, args)
    }
    ipcRenderer.on('mcp:tool:invoke', handler)
    return () => {
      ipcRenderer.removeListener('mcp:tool:invoke', handler)
    }
  },
  sendMcpToolResult: (requestId: string, result: ToolResult) => {
    ipcRenderer.send('mcp:tool:result', requestId, result)
  },
  onMcpStatus: (callback: (status: McpStatus) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: McpStatus): void => {
      callback(status)
    }
    ipcRenderer.on('mcp:status', handler)
    return () => {
      ipcRenderer.removeListener('mcp:status', handler)
    }
  },
  onLLMStreamChunk: (callback: (chunk: LLMStreamChunk) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: LLMStreamChunk): void => {
      callback(chunk)
    }
    ipcRenderer.on('llm:stream:chunk', handler)
    return () => {
      ipcRenderer.removeListener('llm:stream:chunk', handler)
    }
  },
  onLLMStreamToolCall: (callback: (toolCall: LLMStreamToolCall) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, toolCall: LLMStreamToolCall): void => {
      callback(toolCall)
    }
    ipcRenderer.on('llm:stream:tool-call', handler)
    return () => {
      ipcRenderer.removeListener('llm:stream:tool-call', handler)
    }
  },
  onLLMStreamComplete: (callback: (complete: LLMStreamComplete) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, complete: LLMStreamComplete): void => {
      callback(complete)
    }
    ipcRenderer.on('llm:stream:complete', handler)
    return () => {
      ipcRenderer.removeListener('llm:stream:complete', handler)
    }
  },
  onLLMStreamError: (callback: (error: LLMStreamError) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, error: LLMStreamError): void => {
      callback(error)
    }
    ipcRenderer.on('llm:stream:error', handler)
    return () => {
      ipcRenderer.removeListener('llm:stream:error', handler)
    }
  },
  // File association
  fileAssociationIsDefault: () => ipcRenderer.invoke('fileAssociation:isDefault'),
  // Google Docs integration
  googleIsConfigured: () => ipcRenderer.invoke('google:isConfigured'),
  googleStartAuth: () => ipcRenderer.invoke('google:startAuth'),
  googleDisconnect: () => ipcRenderer.invoke('google:disconnect'),
  googleGetConnectionStatus: () => ipcRenderer.invoke('google:getConnectionStatus'),
  googleSync: (content: string, frontmatter: Record<string, unknown>, title: string) =>
    ipcRenderer.invoke('google:sync', content, frontmatter, title),
  googlePull: (docId: string) => ipcRenderer.invoke('google:pull', docId),
  googleImport: (docId: string) => ipcRenderer.invoke('google:import', docId),
  googleEnsureFolder: () => ipcRenderer.invoke('google:ensureFolder'),
  googleSyncAll: (syncDir: string) => ipcRenderer.invoke('google:syncAll', syncDir),
  googleListRecentDocs: (maxResults?: number) => ipcRenderer.invoke('google:listRecentDocs', maxResults),
  googleGetSyncMetadata: () => ipcRenderer.invoke('google:getSyncMetadata'),
  googleUpdateSyncMetadataEntry: (entry: GoogleDocEntry) => ipcRenderer.invoke('google:updateSyncMetadataEntry', entry),
  googleRemoveSyncMetadataEntry: (googleDocId: string) => ipcRenderer.invoke('google:removeSyncMetadataEntry', googleDocId),
  // MCP Server integration
  mcpGetStatus: () => ipcRenderer.invoke('mcp:getStatus'),
  mcpInstall: () => ipcRenderer.invoke('mcp:install'),
  mcpUninstall: () => ipcRenderer.invoke('mcp:uninstall'),
  // Emoji generation
  emojiGenerate: (title: string, contentPreview?: string) => ipcRenderer.invoke('emoji:generate', title, contentPreview),
  // Recent files
  refreshRecentMenu: () => ipcRenderer.invoke('recentFiles:refreshMenu'),
  clearRecentFiles: () => ipcRenderer.invoke('recentFiles:clear'),
  // Sentry error tracking
  sentrySetEnabled: (enabled: boolean) => ipcRenderer.invoke('sentry:setEnabled', enabled),
  // Window fullscreen state
  onFullscreenChange: (callback: (isFullscreen: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, isFullscreen: boolean): void => {
      callback(isFullscreen)
    }
    ipcRenderer.on('window:fullscreen-change', handler)
    return () => {
      ipcRenderer.removeListener('window:fullscreen-change', handler)
    }
  },
  // Auto-updater
  onUpdateAvailable: (callback: (info: { version: string; releaseNotes?: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, info: { version: string; releaseNotes?: string }): void => {
      callback(info)
    }
    ipcRenderer.on('updater:update-available', handler)
    return () => {
      ipcRenderer.removeListener('updater:update-available', handler)
    }
  },
  onDownloadProgress: (callback: (progress: { percent: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: { percent: number }): void => {
      callback(progress)
    }
    ipcRenderer.on('updater:download-progress', handler)
    return () => {
      ipcRenderer.removeListener('updater:download-progress', handler)
    }
  },
  onUpdateDownloaded: (callback: (info: { version: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, info: { version: string }): void => {
      callback(info)
    }
    ipcRenderer.on('updater:update-downloaded', handler)
    return () => {
      ipcRenderer.removeListener('updater:update-downloaded', handler)
    }
  },
  updaterDownload: () => ipcRenderer.invoke('updater:download'),
  updaterInstall: () => ipcRenderer.invoke('updater:install'),
  updaterCheck: () => ipcRenderer.invoke('updater:check'),
}

contextBridge.exposeInMainWorld('api', api)
