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
  ElectronAPI
} from '../types'

const SETTINGS_KEY = 'prose:settings'

const defaultSettings: Settings = {
  theme: 'dark',
  llm: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    apiKey: ''
  },
  editor: {
    fontSize: 16,
    lineHeight: 1.6,
    fontFamily: "'Source Code Pro', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace"
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
  }
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
