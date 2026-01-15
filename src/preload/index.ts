import { contextBridge, ipcRenderer } from 'electron'
import type { Settings } from '../renderer/types'

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

export interface ElectronAPI {
  openFile: () => Promise<FileResult | null>
  saveFile: (path: string, content: string) => Promise<void>
  saveFileAs: (content: string) => Promise<string | null>
  readFile: (path: string) => Promise<string>
  loadSettings: () => Promise<Settings>
  saveSettings: (settings: Settings) => Promise<void>
  onMenuAction: (callback: (action: string) => void) => () => void
  onFileOpenExternal: (callback: (path: string) => void) => () => void
  llmChat: (request: LLMRequest) => Promise<LLMResponse>
  platform: 'aix' | 'darwin' | 'freebsd' | 'linux' | 'openbsd' | 'sunos' | 'win32' | 'android' | 'cygwin' | 'netbsd'
  // Streaming LLM
  llmChatStream: (request: LLMStreamRequest) => Promise<{ success: boolean }>
  llmAbortStream: (streamId: string) => Promise<{ success: boolean }>
  onLLMStreamChunk: (callback: (chunk: LLMStreamChunk) => void) => () => void
  onLLMStreamToolCall: (callback: (toolCall: LLMStreamToolCall) => void) => () => void
  onLLMStreamComplete: (callback: (complete: LLMStreamComplete) => void) => () => void
  onLLMStreamError: (callback: (error: LLMStreamError) => void) => () => void
  // Folder operations for quick save
  selectFolder: () => Promise<string | null>
  saveToFolder: (folder: string, filename: string, content: string) => Promise<string>
  getDocumentsPath: () => Promise<string>
  fileExists: (path: string) => Promise<boolean>
  showInFolder: (path: string) => Promise<void>
  renameFile: (oldPath: string, newPath: string) => Promise<void>
  deleteFile: (path: string) => Promise<void>
  listDirectory: (path: string, maxDepth?: number) => Promise<FileItem[]>
  remarkableRegister: (code: string) => Promise<RemarkableRegisterResponse>
  remarkableValidate: (deviceToken: string) => Promise<boolean>
  remarkableSync: (deviceToken: string, syncDirectory: string) => Promise<RemarkableSyncResult>
  remarkableDisconnect: () => Promise<void>
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
  saveFileAs: (content: string) => ipcRenderer.invoke('file:saveAs', content),
  readFile: (path: string) => ipcRenderer.invoke('file:read', path),
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings: Settings) => ipcRenderer.invoke('settings:save', settings),
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
  // Streaming LLM
  llmChatStream: (request: LLMStreamRequest) => ipcRenderer.invoke('llm:stream', request),
  llmAbortStream: (streamId: string) => ipcRenderer.invoke('llm:stream:abort', streamId),
  // Folder operations for quick save
  selectFolder: () => ipcRenderer.invoke('file:selectFolder'),
  saveToFolder: (folder: string, filename: string, content: string) =>
    ipcRenderer.invoke('file:saveToFolder', folder, filename, content),
  getDocumentsPath: () => ipcRenderer.invoke('file:documentsPath'),
  fileExists: (path: string) => ipcRenderer.invoke('file:exists', path),
  showInFolder: (path: string) => ipcRenderer.invoke('file:showInFolder', path),
  renameFile: (oldPath: string, newPath: string) => ipcRenderer.invoke('file:rename', oldPath, newPath),
  deleteFile: (path: string) => ipcRenderer.invoke('file:delete', path),
  listDirectory: (path: string, maxDepth?: number) => ipcRenderer.invoke('file:listDirectory', path, maxDepth),
  remarkableRegister: (code: string) => ipcRenderer.invoke('remarkable:register', code),
  remarkableValidate: (deviceToken: string) => ipcRenderer.invoke('remarkable:validate', deviceToken),
  remarkableSync: (deviceToken: string, syncDirectory: string) =>
    ipcRenderer.invoke('remarkable:sync', deviceToken, syncDirectory),
  remarkableDisconnect: () => ipcRenderer.invoke('remarkable:disconnect'),
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
  }
}

contextBridge.exposeInMainWorld('api', api)
