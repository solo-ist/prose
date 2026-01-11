import { ipcMain, dialog, app, shell, safeStorage } from 'electron'
import { readFile, writeFile, mkdir, access, rename, unlink, readdir, stat } from 'fs/promises'
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

interface LLMStreamRequest extends LLMRequest {
  streamId: string
}

// Track active streams for abort support
const activeStreams = new Map<string, AbortController>()

const SETTINGS_DIR = join(homedir(), '.prose')
const SETTINGS_PATH = join(SETTINGS_DIR, 'settings.json')
const ANTHROPIC_KEY_PATH = join(SETTINGS_DIR, '.remarkable-anthropic-key')

/**
 * Expand ~ to home directory
 */
function expandPath(path: string): string {
  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2))
  }
  if (path === '~') {
    return homedir()
  }
  return path
}

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
    const expandedPath = expandPath(path)
    return await readFile(expandedPath, 'utf-8')
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

  // File: Select folder dialog
  ipcMain.handle('file:selectFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  // File: Save to folder with filename
  ipcMain.handle(
    'file:saveToFolder',
    async (_event, folder: string, filename: string, content: string) => {
      // Ensure .md extension
      const finalFilename = filename.endsWith('.md') ? filename : `${filename}.md`
      const fullPath = join(folder, finalFilename)
      await writeFile(fullPath, content, 'utf-8')
      return fullPath
    }
  )

  // File: Get Documents path
  ipcMain.handle('file:documentsPath', async () => {
    return app.getPath('documents')
  })

  // File: Check if file exists
  ipcMain.handle('file:exists', async (_event, path: string) => {
    try {
      const expandedPath = expandPath(path)
      await access(expandedPath)
      return true
    } catch {
      return false
    }
  })

  // File: Show in folder (Finder on macOS)
  ipcMain.handle('file:showInFolder', async (_event, path: string) => {
    const expandedPath = expandPath(path)
    shell.showItemInFolder(expandedPath)
  })

  // File: Rename file
  ipcMain.handle('file:rename', async (_event, oldPath: string, newPath: string) => {
    await rename(oldPath, newPath)
  })

  // File: Delete file
  ipcMain.handle('file:delete', async (_event, path: string) => {
    await unlink(path)
  })

  // File: List directory contents (with lazy loading support)
  ipcMain.handle('file:listDirectory', async (_event, dirPath: string, maxDepth: number = 1) => {
    interface FileItem {
      name: string
      path: string
      isDirectory: boolean
      modifiedAt: string
      children?: FileItem[]
      hasChildren?: boolean // For lazy loading - indicates folder has content without loading it
    }

    async function listDir(dir: string, depth: number = 0): Promise<FileItem[]> {
      try {
        const entries = await readdir(dir, { withFileTypes: true })
        const items: FileItem[] = []

        for (const entry of entries) {
          // Skip hidden files
          if (entry.name.startsWith('.')) continue

          const fullPath = join(dir, entry.name)
          let stats
          try {
            stats = await stat(fullPath)
          } catch {
            // Skip files we can't stat (permissions, broken symlinks, etc.)
            continue
          }

          if (entry.isDirectory()) {
            if (depth < maxDepth) {
              // Recurse if within depth limit
              const children = await listDir(fullPath, depth + 1)
              items.push({
                name: entry.name,
                path: fullPath,
                isDirectory: true,
                modifiedAt: stats.mtime.toISOString(),
                children,
                hasChildren: children.length > 0
              })
            } else {
              // Beyond depth limit - just check if folder has any relevant content
              let hasChildren = false
              try {
                const subEntries = await readdir(fullPath, { withFileTypes: true })
                hasChildren = subEntries.some(e =>
                  !e.name.startsWith('.') &&
                  (e.isDirectory() || e.name.endsWith('.md') || e.name.endsWith('.markdown') || e.name.endsWith('.txt'))
                )
              } catch {
                // Can't read folder, assume no children
              }
              items.push({
                name: entry.name,
                path: fullPath,
                isDirectory: true,
                modifiedAt: stats.mtime.toISOString(),
                hasChildren
              })
            }
          } else if (entry.name.endsWith('.md') || entry.name.endsWith('.markdown') || entry.name.endsWith('.txt')) {
            items.push({
              name: entry.name,
              path: fullPath,
              isDirectory: false,
              modifiedAt: stats.mtime.toISOString()
            })
          }
        }

        // Sort: directories first, then by name
        return items.sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
          return a.name.localeCompare(b.name)
        })
      } catch {
        return []
      }
    }

    // Expand ~ to home directory
    const expandedPath = expandPath(dirPath)
    return listDir(expandedPath, 0)
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

  // LLM: Streaming chat completion
  ipcMain.handle('llm:stream', async (event, request: LLMStreamRequest) => {
    const { streamId } = request
    const abortController = new AbortController()
    activeStreams.set(streamId, abortController)

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
        messages: request.messages,
        abortSignal: abortController.signal
      })

      let fullContent = ''
      for await (const part of result.fullStream) {
        // Check if aborted
        if (abortController.signal.aborted) {
          break
        }

        if (part.type === 'text-delta') {
          const delta = (part as { text?: string; textDelta?: string }).text ??
                        (part as { text?: string; textDelta?: string }).textDelta ?? ''
          fullContent += delta

          // Send chunk to renderer
          event.sender.send('llm:stream:chunk', {
            streamId,
            delta
          })
        } else if (part.type === 'error') {
          throw (part as { error: unknown }).error
        }
      }

      // Send completion
      event.sender.send('llm:stream:complete', {
        streamId,
        content: fullContent
      })

      return { success: true }
    } catch (error) {
      if (abortController.signal.aborted) {
        // Graceful abort - send completion with accumulated content
        event.sender.send('llm:stream:complete', {
          streamId,
          content: ''
        })
      } else {
        event.sender.send('llm:stream:error', {
          streamId,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
      return { success: false }
    } finally {
      activeStreams.delete(streamId)
    }
  })

  // LLM: Abort streaming request
  ipcMain.handle('llm:stream:abort', async (_event, streamId: string) => {
    const controller = activeStreams.get(streamId)
    if (controller) {
      controller.abort()
      return { success: true }
    }
    return { success: false }
  })

  // reMarkable: Register device with one-time code
  ipcMain.handle('remarkable:register', async (_event, code: string) => {
    const { registerDevice } = await import('./remarkable/client')
    const deviceToken = await registerDevice(code)
    return { deviceToken }
  })

  // reMarkable: Validate existing device token
  ipcMain.handle('remarkable:validate', async (_event, deviceToken: string) => {
    const { validateToken } = await import('./remarkable/client')
    return await validateToken(deviceToken)
  })

  // reMarkable: Sync notebooks to local directory
  ipcMain.handle(
    'remarkable:sync',
    async (_event, deviceToken: string, syncDirectory: string) => {
      const { syncAll } = await import('./remarkable/sync')

      // Get Anthropic API key - first from LLM settings if using Anthropic provider,
      // then fall back to separate secure storage
      let anthropicApiKey: string | undefined
      try {
        const content = await readFile(SETTINGS_PATH, 'utf-8')
        const settings = JSON.parse(content) as Settings
        if (settings.llm?.provider === 'anthropic' && settings.llm?.apiKey) {
          anthropicApiKey = settings.llm.apiKey
        }
      } catch {
        // Settings not found or invalid
      }

      // If no key from LLM settings, try separate secure storage
      if (!anthropicApiKey && safeStorage.isEncryptionAvailable()) {
        try {
          const encryptedKey = await readFile(ANTHROPIC_KEY_PATH)
          anthropicApiKey = safeStorage.decryptString(encryptedKey)
        } catch {
          // File doesn't exist or can't be read
        }
      }

      return await syncAll(deviceToken, syncDirectory, anthropicApiKey)
    }
  )

  // reMarkable: Disconnect (clear cached connection)
  ipcMain.handle('remarkable:disconnect', async () => {
    const { disconnect } = await import('./remarkable/client')
    disconnect()
  })

  // reMarkable: Get sync metadata (notebook list with status)
  ipcMain.handle('remarkable:getMetadata', async (_event, syncDirectory: string) => {
    const { getSyncStatus } = await import('./remarkable/sync')
    return await getSyncStatus(syncDirectory)
  })

  // reMarkable: List cloud notebooks (for selection UI)
  ipcMain.handle('remarkable:listCloudNotebooks', async (_event, deviceToken: string) => {
    const { listCloudNotebooks } = await import('./remarkable/sync')
    return await listCloudNotebooks(deviceToken)
  })

  // reMarkable: Get sync state (which notebooks are selected)
  ipcMain.handle('remarkable:getSyncState', async (_event, syncDirectory: string) => {
    const { getSyncState } = await import('./remarkable/sync')
    return await getSyncState(syncDirectory)
  })

  // reMarkable: Update sync selection
  ipcMain.handle(
    'remarkable:updateSyncSelection',
    async (_event, syncDirectory: string, selectedNotebooks: string[]) => {
      const { updateSyncSelection } = await import('./remarkable/sync')
      await updateSyncSelection(syncDirectory, selectedNotebooks)
    }
  )

  // reMarkable: Store Anthropic API key securely
  ipcMain.handle('remarkable:storeApiKey', async (_event, apiKey: string) => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure storage is not available on this system')
    }

    await mkdir(SETTINGS_DIR, { recursive: true })
    const encryptedKey = safeStorage.encryptString(apiKey)
    await writeFile(ANTHROPIC_KEY_PATH, encryptedKey)
  })

  ipcMain.handle('remarkable:getApiKey', async () => {
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[reMarkable] Secure storage not available')
      return null
    }

    try {
      const encryptedKey = await readFile(ANTHROPIC_KEY_PATH)
      return safeStorage.decryptString(encryptedKey)
    } catch {
      // File doesn't exist or can't be read
      return null
    }
  })

  ipcMain.handle('remarkable:clearApiKey', async () => {
    try {
      await unlink(ANTHROPIC_KEY_PATH)
    } catch {
      // File doesn't exist, ignore
    }
  })
}
