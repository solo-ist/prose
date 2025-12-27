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

export interface ElectronAPI {
  openFile: () => Promise<FileResult | null>
  saveFile: (path: string, content: string) => Promise<void>
  saveFileAs: (content: string) => Promise<string | null>
  readFile: (path: string) => Promise<string>
  loadSettings: () => Promise<Settings>
  saveSettings: (settings: Settings) => Promise<void>
  onMenuAction: (callback: (action: string) => void) => () => void
  llmChat: (request: LLMRequest) => Promise<LLMResponse>
  rebuildMenu: () => Promise<void>
  platform: 'aix' | 'darwin' | 'freebsd' | 'linux' | 'openbsd' | 'sunos' | 'win32' | 'android' | 'cygwin' | 'netbsd'
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
  llmChat: (request: LLMRequest) => ipcRenderer.invoke('llm:chat', request),
  rebuildMenu: () => ipcRenderer.invoke('menu:rebuild'),
  platform: process.platform
}

contextBridge.exposeInMainWorld('api', api)
