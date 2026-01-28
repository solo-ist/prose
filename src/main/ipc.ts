import { ipcMain, dialog, app, shell, safeStorage, BrowserWindow } from 'electron'
import { readFile, writeFile, mkdir, access, rename, unlink, readdir, stat } from 'fs/promises'
import { join, normalize, isAbsolute } from 'path'
import { homedir } from 'os'
import type { Settings } from '../renderer/types'
import { withRetry, getNetworkErrorMessage } from '../shared/utils/retry'

// Content block types for Anthropic API tool use
interface LLMTextBlock {
  type: 'text'
  text: string
}

interface LLMToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}

type LLMContentBlock = LLMTextBlock | LLMToolUseBlock

interface LLMMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string | LLMContentBlock[]
  tool_call_id?: string
}

interface LLMToolDefinition {
  name: string
  description: string
  input_schema: Record<string, unknown>
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
  tools?: LLMToolDefinition[]
  maxToolRoundtrips?: number
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

/**
 * Validate and sanitize a file path to prevent path traversal attacks.
 * Expands ~ paths and normalizes, then blocks any path containing traversal sequences.
 */
function validatePath(inputPath: string): string {
  const expanded = expandPath(inputPath)
  const normalized = normalize(expanded)

  // Block traversal sequences after normalization
  // On Windows, normalize() resolves .. but we check anyway for safety
  if (normalized.includes('..')) {
    throw new Error('Path traversal not allowed')
  }

  return normalized
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
    fontFamily: "'IBM Plex Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace"
  },
  recovery: {
    mode: 'silent'
  },
  autosave: {
    enabled: false,
    intervalSeconds: 30
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
    const safePath = validatePath(path)
    await writeFile(safePath, content, 'utf-8')
  })

  // File: Read file at path
  ipcMain.handle('file:read', async (_event, path: string) => {
    const safePath = validatePath(path)
    return await readFile(safePath, 'utf-8')
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
      const safePath = validatePath(path)
      await access(safePath)
      return true
    } catch {
      return false
    }
  })

  // File: Show in folder (Finder on macOS)
  ipcMain.handle('file:showInFolder', async (_event, path: string) => {
    const safePath = validatePath(path)
    shell.showItemInFolder(safePath)
  })

  // File: Rename file
  ipcMain.handle('file:rename', async (_event, oldPath: string, newPath: string) => {
    const safeOldPath = validatePath(oldPath)
    const safeNewPath = validatePath(newPath)
    await rename(safeOldPath, safeNewPath)
  })

  // File: Delete file
  ipcMain.handle('file:delete', async (_event, path: string) => {
    const safePath = validatePath(path)
    await unlink(safePath)
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

    // Validate and expand path
    const safePath = validatePath(dirPath)
    return listDir(safePath, 0)
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

  // Settings: Test API key (validates by making a minimal request)
  ipcMain.handle('settings:testApiKey', async (_event, request: {
    provider: string
    apiKey: string
    baseUrl?: string
  }): Promise<{ success: boolean; message: string }> => {
    const { provider, apiKey, baseUrl } = request

    try {
      switch (provider) {
        case 'anthropic': {
          const Anthropic = (await import('@anthropic-ai/sdk')).default
          const client = new Anthropic({ apiKey })
          // Make a minimal request to validate the key
          await client.messages.create({
            model: 'claude-3-5-haiku-20241022',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'Hi' }]
          })
          return { success: true, message: 'API key is valid' }
        }
        case 'openai': {
          const { createOpenAI } = await import('@ai-sdk/openai')
          const openai = createOpenAI({ apiKey })
          const { generateText } = await import('ai')
          await generateText({
            model: openai('gpt-4o-mini'),
            maxTokens: 1,
            prompt: 'Hi'
          })
          return { success: true, message: 'API key is valid' }
        }
        case 'openrouter': {
          const { createOpenRouter } = await import('@openrouter/ai-sdk-provider')
          const openrouter = createOpenRouter({ apiKey })
          const { generateText } = await import('ai')
          await generateText({
            model: openrouter('openai/gpt-4o-mini'),
            maxTokens: 1,
            prompt: 'Hi'
          })
          return { success: true, message: 'API key is valid' }
        }
        case 'ollama': {
          // For Ollama, test connectivity to the base URL
          const url = baseUrl || 'http://localhost:11434'
          const response = await fetch(`${url}/api/tags`)
          if (!response.ok) {
            throw new Error(`Ollama server returned ${response.status}`)
          }
          return { success: true, message: 'Connected to Ollama server' }
        }
        default:
          return { success: false, message: `Unknown provider: ${provider}` }
      }
    } catch (error) {
      console.error('[testApiKey] Error:', error)

      // Parse error messages for better user feedback
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      if (errorMessage.includes('401') || errorMessage.includes('Unauthorized') || errorMessage.includes('invalid_api_key')) {
        return { success: false, message: 'Invalid API key' }
      }
      if (errorMessage.includes('403') || errorMessage.includes('Forbidden')) {
        return { success: false, message: 'API key does not have required permissions' }
      }
      if (errorMessage.includes('429') || errorMessage.includes('rate_limit')) {
        return { success: false, message: 'Rate limited - but API key is valid' }
      }
      if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('fetch failed')) {
        return { success: false, message: 'Could not connect to server' }
      }
      if (errorMessage.includes('ETIMEDOUT') || errorMessage.includes('timeout')) {
        return { success: false, message: 'Connection timed out' }
      }

      return { success: false, message: errorMessage }
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
      // Use retry logic for transient network errors
      const textContent = await withRetry(
        async () => {
          const result = streamText({
            model,
            system: request.system,
            messages: request.messages
          })

          // Collect the full response
          let content = ''
          for await (const part of result.fullStream) {
            if (part.type === 'text-delta') {
              const delta = (part as { text?: string; textDelta?: string }).text ??
                            (part as { text?: string; textDelta?: string }).textDelta ?? ''
              content += delta
            } else if (part.type === 'error') {
              console.error('[LLM] Stream error:', part.error)
              throw part.error
            }
          }
          return content
        },
        {
          maxRetries: 2,
          onRetry: (attempt, error, delay) => {
            console.log(`[LLM] Retry attempt ${attempt} after ${delay}ms:`, error.message)
          }
        }
      )

      return { content: textContent }
    } catch (error) {
      console.error('[LLM] Error:', error)
      // Enhance error message for user
      if (error instanceof Error) {
        error.message = getNetworkErrorMessage(error)
      }
      throw error
    }
  })

  // LLM: Streaming chat completion (with optional tool support)
  ipcMain.handle('llm:stream', async (event, request: LLMStreamRequest) => {
    console.log('[LLM:stream] ========== HANDLER CALLED ==========')
    const { streamId, tools: toolDefinitions } = request
    console.log('[LLM:stream] Starting stream:', streamId, 'tools:', toolDefinitions?.length || 0)
    const abortController = new AbortController()
    activeStreams.set(streamId, abortController)

    // For Anthropic with tools, use the Anthropic SDK directly to avoid AI SDK tool format issues
    if (request.provider === 'anthropic' && toolDefinitions && toolDefinitions.length > 0) {
      console.log('[LLM:stream] Using direct Anthropic SDK for tool support')
      try {
        const Anthropic = (await import('@anthropic-ai/sdk')).default
        const client = new Anthropic({ apiKey: request.apiKey })

        // Convert tool definitions to Anthropic's native format
        const anthropicTools = toolDefinitions.map(toolDef => ({
          name: toolDef.name,
          description: toolDef.description,
          input_schema: toolDef.input_schema as Anthropic.Tool['input_schema']
        }))

        // Convert messages to Anthropic format
        const anthropicMessages = request.messages.map(msg => {
          if (msg.role === 'tool') {
            // Tool result messages become user messages with tool_result content block
            return {
              role: 'user' as const,
              content: [{
                type: 'tool_result' as const,
                tool_use_id: msg.tool_call_id || '',
                content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
              }]
            }
          }
          // For user/assistant messages, pass content through as-is
          // Content can be a string or array of content blocks (for tool_use)
          return {
            role: msg.role as 'user' | 'assistant',
            content: msg.content
          }
        })

        console.log('[LLM:stream] Creating Anthropic stream with tools:', anthropicTools.map(t => t.name))

        const stream = client.messages.stream({
          model: request.model,
          max_tokens: 4096,
          system: request.system,
          messages: anthropicMessages,
          tools: anthropicTools
        })

        let fullContent = ''
        const toolCalls: Array<{ id: string; name: string; args: unknown }> = []

        stream.on('text', (text) => {
          if (abortController.signal.aborted) return
          console.log('[LLM:stream] Text chunk:', text.substring(0, 50))
          fullContent += text
          event.sender.send('llm:stream:chunk', { streamId, delta: text })
        })

        stream.on('contentBlockStart', (block) => {
          if (abortController.signal.aborted) return
          console.log('[LLM:stream] Content block start:', block.content_block.type)
          if (block.content_block.type === 'tool_use') {
            console.log('[LLM:stream] Tool use started:', block.content_block.name)
          }
        })

        stream.on('contentBlockStop', (block) => {
          if (abortController.signal.aborted) return
          console.log('[LLM:stream] Content block stop')
        })

        stream.on('error', (err) => {
          console.error('[LLM:stream] Stream error event:', err)
        })

        stream.on('end', () => {
          console.log('[LLM:stream] Stream ended')
        })

        // Wait for the stream to complete
        console.log('[LLM:stream] Waiting for finalMessage...')
        const finalMessage = await stream.finalMessage()
        console.log('[LLM:stream] Got finalMessage, stop_reason:', finalMessage.stop_reason)

        // Extract tool calls from the final message
        for (const block of finalMessage.content) {
          if (block.type === 'tool_use') {
            const toolCall = {
              id: block.id,
              name: block.name,
              args: block.input
            }
            toolCalls.push(toolCall)
            event.sender.send('llm:stream:tool-call', { streamId, toolCall })
          }
        }

        console.log('[LLM:stream] Sending complete:', fullContent.length, 'chars, toolCalls:', toolCalls.length)
        event.sender.send('llm:stream:complete', {
          streamId,
          content: fullContent,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined
        })

        return { success: true }
      } catch (error) {
        console.error('[LLM:stream] Anthropic direct error:', error)
        event.sender.send('llm:stream:error', {
          streamId,
          error: getNetworkErrorMessage(error)
        })
        return { success: false }
      } finally {
        activeStreams.delete(streamId)
      }
    }

    // For other providers or no tools, use AI SDK
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
      console.log('[LLM:stream] Calling streamText with model:', request.model)
      const result = streamText({
        model,
        system: request.system,
        messages: request.messages,
        abortSignal: abortController.signal
      })

      let fullContent = ''

      for await (const part of result.fullStream) {
        if (abortController.signal.aborted) {
          break
        }

        if (part.type === 'text-delta') {
          const delta = (part as { text?: string; textDelta?: string }).text ??
                        (part as { text?: string; textDelta?: string }).textDelta ?? ''
          fullContent += delta
          event.sender.send('llm:stream:chunk', { streamId, delta })
        } else if (part.type === 'error') {
          throw (part as { error: unknown }).error
        }
      }

      console.log('[LLM:stream] Sending complete:', fullContent.length, 'chars')
      event.sender.send('llm:stream:complete', { streamId, content: fullContent })

      return { success: true }
    } catch (error) {
      console.error('[LLM:stream] Error:', error)
      if (abortController.signal.aborted) {
        event.sender.send('llm:stream:complete', { streamId, content: '' })
      } else {
        event.sender.send('llm:stream:error', {
          streamId,
          error: getNetworkErrorMessage(error)
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

  // reMarkable: Get OCR path (read-only source)
  ipcMain.handle(
    'remarkable:getOCRPath',
    async (_event, notebookId: string, syncDirectory: string) => {
      const { getOCRPath } = await import('./remarkable/sync')
      return await getOCRPath(notebookId, syncDirectory)
    }
  )

  // reMarkable: Get editable path (if exists)
  ipcMain.handle(
    'remarkable:getEditablePath',
    async (_event, notebookId: string, syncDirectory: string) => {
      const { getEditablePath } = await import('./remarkable/sync')
      return await getEditablePath(notebookId, syncDirectory)
    }
  )

  // reMarkable: Create editable version from OCR
  ipcMain.handle(
    'remarkable:createEditableVersion',
    async (_event, notebookId: string, syncDirectory: string) => {
      const { createEditableVersion } = await import('./remarkable/sync')
      return await createEditableVersion(notebookId, syncDirectory)
    }
  )

  // reMarkable: Find notebook by its markdown file path
  ipcMain.handle(
    'remarkable:findNotebookByFilePath',
    async (_event, filePath: string, syncDirectory: string) => {
      const { findNotebookByFilePath } = await import('./remarkable/sync')
      return await findNotebookByFilePath(filePath, syncDirectory)
    }
  )

  // reMarkable: Clear notebook markdown path (unsync editable version)
  ipcMain.handle(
    'remarkable:clearNotebookMarkdownPath',
    async (_event, notebookId: string, syncDirectory: string) => {
      const { clearNotebookMarkdownPath } = await import('./remarkable/sync')
      return await clearNotebookMarkdownPath(notebookId, syncDirectory)
    }
  )

  // Window: Close window (macOS) or quit app (Windows/Linux)
  ipcMain.handle('window:close', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window) {
      if (process.platform === 'darwin') {
        window.close()
      } else {
        app.quit()
      }
    }
  })

  // File Association: Check if app is default handler (informational only)
  // Returns: true, false, or null (can't determine)
  ipcMain.handle('fileAssociation:isDefault', async () => {
    if (process.platform !== 'darwin') return null

    try {
      const { execSync } = await import('child_process')
      // Try duti if available (informational query only)
      const result = execSync('duti -x md 2>/dev/null').toString().trim()
      const lines = result.split('\n')
      const bundleId = lines[2] // Third line is bundle ID
      return bundleId === 'com.prose.app' || bundleId?.toLowerCase().includes('prose')
    } catch {
      return null // Can't determine - that's fine
    }
  })

  // Google: Start OAuth flow
  ipcMain.handle('google:startAuth', async () => {
    const { startOAuthFlow } = await import('./google/auth')
    return await startOAuthFlow()
  })

  // Google: Disconnect (clear tokens)
  ipcMain.handle('google:disconnect', async () => {
    const { clearTokens } = await import('./google/auth')
    await clearTokens()
  })

  // Google: Get connection status
  ipcMain.handle('google:getConnectionStatus', async () => {
    const { validateConnection } = await import('./google/auth')
    return await validateConnection()
  })

  // Google: Unified sync (determines push/pull/create automatically)
  ipcMain.handle('google:sync', async (_event, content: string, frontmatter: Record<string, unknown>, title: string) => {
    const { syncDocument } = await import('./google/sync')
    return await syncDocument(content, frontmatter, title)
  })

  // Google: Pull document from Google Docs
  ipcMain.handle('google:pull', async (_event, docId: string) => {
    const { pullFromGoogle } = await import('./google/sync')
    return await pullFromGoogle(docId)
  })

  // Google: Import document from Google Docs
  ipcMain.handle('google:import', async (_event, docId: string) => {
    const { importFromGoogle } = await import('./google/sync')
    return await importFromGoogle(docId)
  })

  // Google: Ensure ~/Documents/Google Docs/ folder exists
  ipcMain.handle('google:ensureFolder', async () => {
    const { ensureGoogleDocsFolder } = await import('./google/sync')
    return await ensureGoogleDocsFolder()
  })

  // Google: Sync all Prose-linked docs to local folder
  ipcMain.handle('google:syncAll', async (_event, syncDir: string) => {
    const { syncAllGoogleDocs } = await import('./google/sync')
    return await syncAllGoogleDocs(syncDir)
  })

  // Google: List recent docs
  ipcMain.handle('google:listRecentDocs', async (_event, maxResults?: number) => {
    const { listRecentDocs } = await import('./google/client')
    return await listRecentDocs(maxResults)
  })

  // Google: Get sync metadata (with file-existence checks)
  ipcMain.handle('google:getSyncMetadata', async () => {
    const { getGoogleSyncMetadata } = await import('./google/sync')
    return await getGoogleSyncMetadata()
  })

  // Google: Add/update a metadata entry
  ipcMain.handle('google:updateSyncMetadataEntry', async (_event, entry: import('./google/sync').GoogleDocEntry) => {
    const { updateGoogleSyncMetadataEntry } = await import('./google/sync')
    await updateGoogleSyncMetadataEntry(entry)
  })

  // Google: Remove a metadata entry
  ipcMain.handle('google:removeSyncMetadataEntry', async (_event, googleDocId: string) => {
    const { removeGoogleSyncMetadataEntry } = await import('./google/sync')
    await removeGoogleSyncMetadataEntry(googleDocId)
  })
}
