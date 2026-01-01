import { contextBridge, ipcRenderer } from 'electron'
import type { Settings } from '../renderer/types'

export interface FileResult {
  path: string
  content: string
}

export interface LLMMessage {
  role: 'user' | 'assistant'
  content: string
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
}

export interface LLMStreamChunk {
  streamId: string
  delta: string
}

export interface LLMStreamComplete {
  streamId: string
  content: string
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
  listDirectory: (path: string) => Promise<FileItem[]>
  remarkableSync: (request: RemarkableSyncRequest) => Promise<RemarkableSyncResponse>
}

export interface FileItem {
  name: string
  path: string
  isDirectory: boolean
  modifiedAt: string
  children?: FileItem[]
}

export interface RemarkableSyncRequest {
  lambdaUrl: string
  apiKey: string
  syncDirectory: string
}

export interface RemarkableSyncFile {
  path: string
  content: string
  pages: number
}

export interface RemarkableSyncResponse {
  syncedAt: string
  files: RemarkableSyncFile[]
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
  listDirectory: (path: string) => ipcRenderer.invoke('file:listDirectory', path),
  remarkableSync: (request: RemarkableSyncRequest) => ipcRenderer.invoke('remarkable:sync', request),
  onLLMStreamChunk: (callback: (chunk: LLMStreamChunk) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: LLMStreamChunk): void => {
      callback(chunk)
    }
    ipcRenderer.on('llm:stream:chunk', handler)
    return () => {
      ipcRenderer.removeListener('llm:stream:chunk', handler)
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
