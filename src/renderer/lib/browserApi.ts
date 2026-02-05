/**
 * Browser fallback implementation for Electron API
 * Used when running in a browser without Electron
 */

import { streamText } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { createOllama } from 'ollama-ai-provider'
import type {
  Settings,
  FileResult,
  LLMRequest,
  LLMResponse,
  LLMStreamRequest,
  LLMStreamChunk,
  LLMStreamToolCall,
  LLMStreamComplete,
  LLMStreamError,
  ElectronAPI
} from '../types'

const SETTINGS_KEY = 'prose:settings'

const defaultSettings: Settings = {
  theme: 'dark',
  llm: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-5-20250929',
    apiKey: ''
  },
  editor: {
    fontSize: 16,
    lineHeight: 1.6,
    fontFamily: "'IBM Plex Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace"
  }
}

/**
 * Browser-based API implementation
 */
export const browserApi: ElectronAPI = {
  // File operations using File System Access API (where available)
  openFile: async (): Promise<FileResult | null> => {
    if ('showOpenFilePicker' in window) {
      try {
        const [fileHandle] = await (window as Window & { showOpenFilePicker: (options?: object) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker({
          types: [
            {
              description: 'Markdown files',
              accept: { 'text/markdown': ['.md', '.markdown'] }
            },
            {
              description: 'Text files',
              accept: { 'text/plain': ['.txt'] }
            }
          ]
        })
        const file = await fileHandle.getFile()
        const content = await file.text()
        return { path: file.name, content }
      } catch (e) {
        // User cancelled or error
        if ((e as Error).name !== 'AbortError') {
          console.error('Error opening file:', e)
        }
        return null
      }
    }
    // Fallback: use input element
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.md,.markdown,.txt'
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (file) {
          const content = await file.text()
          resolve({ path: file.name, content })
        } else {
          resolve(null)
        }
      }
      input.click()
    })
  },

  saveFile: async (_path: string, content: string): Promise<void> => {
    // In browser mode, we can't save to a specific path
    // Fall back to download
    const blob = new Blob([content], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = _path || 'document.md'
    a.click()
    URL.revokeObjectURL(url)
  },

  saveFileAs: async (content: string): Promise<string | null> => {
    if ('showSaveFilePicker' in window) {
      try {
        const fileHandle = await (window as Window & { showSaveFilePicker: (options?: object) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
          types: [
            {
              description: 'Markdown files',
              accept: { 'text/markdown': ['.md'] }
            }
          ]
        })
        const writable = await fileHandle.createWritable()
        await writable.write(content)
        await writable.close()
        return fileHandle.name
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          console.error('Error saving file:', e)
        }
        return null
      }
    }
    // Fallback: download
    await browserApi.saveFile('document.md', content)
    return 'document.md'
  },

  readFile: async (_path: string): Promise<string> => {
    // In browser mode, we can't read arbitrary paths
    throw new Error('Cannot read files by path in browser mode')
  },

  loadSettings: async (): Promise<Settings> => {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY)
      if (stored) {
        return { ...defaultSettings, ...JSON.parse(stored) }
      }
    } catch (e) {
      console.error('Error loading settings from localStorage:', e)
    }
    return defaultSettings
  },

  saveSettings: async (settings: Settings): Promise<void> => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch (e) {
      console.error('Error saving settings to localStorage:', e)
      throw e
    }
  },

  onMenuAction: (_callback: (action: string) => void) => {
    // No menu actions in browser mode
    return () => {}
  },

  onFileOpenExternal: (_callback: (path: string) => void) => {
    // No external file open in browser mode
    return () => {}
  },

  llmChat: async (request: LLMRequest): Promise<LLMResponse> => {
    let model
    switch (request.provider) {
      case 'anthropic': {
        // Note: Anthropic blocks browser requests due to CORS
        const anthropic = createAnthropic({
          apiKey: request.apiKey,
          baseURL: 'https://api.anthropic.com/v1'
        })
        model = anthropic(request.model)
        break
      }
      case 'openai': {
        // Note: OpenAI also blocks browser requests
        const openai = createOpenAI({ apiKey: request.apiKey })
        model = openai(request.model)
        break
      }
      case 'openrouter': {
        // OpenRouter allows browser requests with proper headers
        const openrouter = createOpenRouter({ apiKey: request.apiKey })
        model = openrouter(request.model)
        break
      }
      case 'ollama': {
        // Ollama is local, so CORS depends on configuration
        const ollama = createOllama({
          baseURL: request.baseUrl || 'http://localhost:11434/api'
        })
        model = ollama(request.model)
        break
      }
      default:
        throw new Error(`Unknown provider: ${request.provider}`)
    }

    try {
      const result = streamText({
        model,
        system: request.system,
        messages: request.messages
      })

      let textContent = ''
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          const delta =
            (part as { text?: string; textDelta?: string }).text ??
            (part as { text?: string; textDelta?: string }).textDelta ??
            ''
          textContent += delta
        } else if (part.type === 'error') {
          throw part.error
        }
      }

      return { content: textContent }
    } catch (error) {
      // Provide helpful error for CORS issues
      if (
        error instanceof Error &&
        (error.message.includes('CORS') || error.message.includes('Failed to fetch'))
      ) {
        const provider = request.provider
        if (provider === 'anthropic' || provider === 'openai') {
          throw new Error(
            `${provider} blocks browser requests. Please use the Electron app, or switch to OpenRouter or Ollama.`
          )
        }
      }
      throw error
    }
  },

  // Streaming LLM (limited browser support due to CORS)
  llmChatStream: async (request: LLMStreamRequest): Promise<{ success: boolean }> => {
    const { streamId } = request

    let model
    switch (request.provider) {
      case 'anthropic': {
        const anthropic = createAnthropic({
          apiKey: request.apiKey,
          baseURL: 'https://api.anthropic.com/v1'
        })
        model = anthropic(request.model)
        break
      }
      case 'openai': {
        const openai = createOpenAI({ apiKey: request.apiKey })
        model = openai(request.model)
        break
      }
      case 'openrouter': {
        const openrouter = createOpenRouter({ apiKey: request.apiKey })
        model = openrouter(request.model)
        break
      }
      case 'ollama': {
        const ollama = createOllama({
          baseURL: request.baseUrl || 'http://localhost:11434/api'
        })
        model = ollama(request.model)
        break
      }
      default:
        throw new Error(`Unknown provider: ${request.provider}`)
    }

    try {
      const result = streamText({
        model,
        system: request.system,
        messages: request.messages
      })

      let fullContent = ''
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          const delta =
            (part as { text?: string; textDelta?: string }).text ??
            (part as { text?: string; textDelta?: string }).textDelta ??
            ''
          fullContent += delta

          // Dispatch chunk event
          window.dispatchEvent(
            new CustomEvent('llm:stream:chunk', {
              detail: { streamId, delta }
            })
          )
        } else if (part.type === 'error') {
          throw part.error
        }
      }

      // Dispatch complete event
      window.dispatchEvent(
        new CustomEvent('llm:stream:complete', {
          detail: { streamId, content: fullContent }
        })
      )

      return { success: true }
    } catch (error) {
      // Provide helpful error for CORS issues
      let errorMessage = error instanceof Error ? error.message : 'Unknown error'
      if (
        error instanceof Error &&
        (error.message.includes('CORS') || error.message.includes('Failed to fetch'))
      ) {
        const provider = request.provider
        if (provider === 'anthropic' || provider === 'openai') {
          errorMessage = `${provider} blocks browser requests. Please use the Electron app, or switch to OpenRouter or Ollama.`
        }
      }

      window.dispatchEvent(
        new CustomEvent('llm:stream:error', {
          detail: { streamId, error: errorMessage }
        })
      )
      return { success: false }
    }
  },

  llmAbortStream: async (_streamId: string): Promise<{ success: boolean }> => {
    // Browser mode doesn't support abort (would need AbortController tracking)
    return { success: false }
  },

  // Folder operations - limited in browser mode
  selectFolder: async (): Promise<string | null> => {
    // Not supported in browser
    return null
  },

  saveToFolder: async (_folder: string, filename: string, content: string): Promise<string> => {
    // Fall back to download
    await browserApi.saveFile(filename, content)
    return filename
  },

  getDocumentsPath: async (): Promise<string> => {
    // Return placeholder - browser can't access filesystem
    return '~/Documents'
  },

  fileExists: async (_path: string): Promise<boolean> => {
    // Can't check in browser mode
    return false
  },

  showInFolder: async (_path: string): Promise<void> => {
    // Can't reveal in folder in browser mode
  },

  renameFile: async (_oldPath: string, _newPath: string): Promise<void> => {
    // Can't rename files in browser mode
    throw new Error('Cannot rename files in browser mode')
  },

  deleteFile: async (_path: string): Promise<void> => {
    // Can't delete files in browser mode
    throw new Error('Cannot delete files in browser mode')
  },

  closeWindow: async (): Promise<void> => {
    // Try to close the window/tab in browser mode
    window.close()
  },

  isFullScreen: async (): Promise<boolean> => {
    return !!document.fullscreenElement
  },

  exitFullScreen: async (): Promise<void> => {
    if (document.fullscreenElement) {
      document.exitFullscreen()
    }
  },

  openExternal: async (url: string): Promise<void> => {
    // In browser mode, just open in a new tab
    window.open(url, '_blank', 'noopener,noreferrer')
  },

  listDirectory: async (_path: string): Promise<import('../types').FileItem[]> => {
    // Can't list directories in browser mode
    return []
  },

  remarkableSync: async (
    _request: import('../types').RemarkableSyncRequest
  ): Promise<import('../types').RemarkableSyncResponse> => {
    // Can't sync in browser mode - need Electron to write files
    throw new Error('reMarkable sync is not available in browser mode')
  },

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

  platform: null,

  // MCP tool execution - not available in browser mode
  onMcpToolInvoke: (_callback: (requestId: string, toolName: string, args: unknown) => void) => {
    // No MCP in browser mode
    return () => {}
  },
  sendMcpToolResult: (_requestId: string, _result: import('../../shared/tools/types').ToolResult) => {
    // No MCP in browser mode
  },
  onMcpStatus: (_callback: (status: { connected: boolean; port: number; error?: string }) => void) => {
    // No MCP in browser mode - immediately report not connected
    return () => {}
  },

  // Google Docs integration - not available in browser mode
  googleStartAuth: async () => ({
    success: false,
    error: 'Google Docs sync is not available in browser mode. Please use the Electron app.'
  }),
  googleDisconnect: async () => {},
  googleGetConnectionStatus: async () => ({
    connected: false,
    error: 'Google Docs sync is not available in browser mode.'
  }),
  googleSync: async () => ({
    success: false,
    direction: 'push' as const,
    error: 'Google Docs sync is not available in browser mode.'
  }),
  googlePull: async () => ({
    success: false,
    error: 'Google Docs sync is not available in browser mode.'
  }),
  googleImport: async () => ({
    success: false,
    error: 'Google Docs sync is not available in browser mode.'
  }),
  googleEnsureFolder: async () => '',
  googleSyncAll: async () => ({
    synced: 0,
    skipped: 0,
    errors: ['Google Docs sync is not available in browser mode.']
  }),
  googleListRecentDocs: async () => [],
  googleGetSyncMetadata: async () => null,
  googleUpdateSyncMetadataEntry: async () => {},
  googleRemoveSyncMetadataEntry: async () => {}
}

/**
 * Returns the appropriate API based on environment
 */
export function getApi(): ElectronAPI {
  if (typeof window !== 'undefined' && window.api) {
    return window.api
  }
  return browserApi
}

/**
 * Check if running in Electron
 */
export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.api
}

/**
 * Check if running in Electron on macOS
 */
export function isMacOS(): boolean {
  return isElectron() && getApi().platform === 'darwin'
}
