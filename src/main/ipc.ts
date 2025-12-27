import { ipcMain, dialog } from 'electron'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import type { Settings } from '../renderer/types'

interface LLMMessage {
  role: 'user' | 'assistant'
  content: string
}

interface LLMRequest {
  provider: string
  model: string
  apiKey: string
  baseUrl?: string
  messages: LLMMessage[]
  system: string
}

const SETTINGS_DIR = join(homedir(), '.prose')
const SETTINGS_PATH = join(SETTINGS_DIR, 'settings.json')

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
  },
  recovery: {
    mode: 'silent'
  }
}

export function setupIpcHandlers(): void {
  // File: Open dialog
  ipcMain.handle('file:open', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown', 'txt'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const path = result.filePaths[0]
    const content = await readFile(path, 'utf-8')
    return { path, content }
  })

  // File: Save content to path
  ipcMain.handle('file:save', async (_event, path: string, content: string) => {
    await writeFile(path, content, 'utf-8')
  })

  // File: Read file at path
  ipcMain.handle('file:read', async (_event, path: string) => {
    return await readFile(path, 'utf-8')
  })

  // File: Save As dialog
  ipcMain.handle('file:saveAs', async (_event, content: string) => {
    const result = await dialog.showSaveDialog({
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (result.canceled || !result.filePath) {
      return null
    }

    await writeFile(result.filePath, content, 'utf-8')
    return result.filePath
  })

  // Settings: Load from ~/.prose/settings.json
  ipcMain.handle('settings:load', async () => {
    try {
      const content = await readFile(SETTINGS_PATH, 'utf-8')
      return { ...defaultSettings, ...JSON.parse(content) }
    } catch {
      return defaultSettings
    }
  })

  // Settings: Save to ~/.prose/settings.json
  ipcMain.handle('settings:save', async (_event, settings: Settings) => {
    try {
      await mkdir(SETTINGS_DIR, { recursive: true })
      await writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8')
    } catch (error) {
      console.error('Failed to save settings:', error)
      throw error
    }
  })

  // LLM: Chat completion (runs in main process to avoid CORS)
  ipcMain.handle('llm:chat', async (_event, request: LLMRequest) => {
    const { createAnthropic } = await import('@ai-sdk/anthropic')
    const { createOpenAI } = await import('@ai-sdk/openai')
    const { createOpenRouter } = await import('@openrouter/ai-sdk-provider')
    const { createOllama } = await import('ollama-ai-provider')
    const { streamText } = await import('ai')

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

      // Collect the full response
      let textContent = ''
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          const delta = (part as { text?: string; textDelta?: string }).text ??
                        (part as { text?: string; textDelta?: string }).textDelta ?? ''
          textContent += delta
        } else if (part.type === 'error') {
          console.error('[LLM] Stream error:', part.error)
          throw part.error
        }
      }

      return { content: textContent }
    } catch (error) {
      console.error('[LLM] Error:', error)
      throw error
    }
  })
}
