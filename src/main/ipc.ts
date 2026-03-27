import { ipcMain, dialog, app, shell, BrowserWindow } from 'electron'
import { IS_MAS_BUILD } from './env'
import { readFile, writeFile, mkdir, access, rename, unlink, readdir, stat, copyFile } from 'fs/promises'
import { join, dirname, normalize, isAbsolute } from 'path'
import { randomUUID } from 'crypto'
import { homedir } from 'os'
import type { Settings } from '../renderer/types'
import { withRetry, getNetworkErrorMessage } from '../shared/utils/retry'
import { clearRecentFiles } from './recentFiles'
import { refreshMenu } from './menu'
import { credentialStore } from './credentialStore'

// Credential store keys
const LLM_API_KEY = 'llm-api-key'
const REMARKABLE_DEVICE_TOKEN = 'remarkable-device-token'

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

// Security-scoped bookmark stop function (MAS sandbox)
let stopAccessingBookmark: (() => void) | null = null

const SETTINGS_DIR = join(homedir(), '.prose')
const SETTINGS_PATH = join(SETTINGS_DIR, 'settings.json')
const ANTHROPIC_KEY_PATH = join(SETTINGS_DIR, '.remarkable-anthropic-key') // Legacy path for migration
const REMARKABLE_CREDENTIAL_KEY = 'remarkable-anthropic-key'

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
    model: 'claude-sonnet-4-5-20250929',
    apiKey: '',
    emojiIcons: false
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
    mode: 'off',
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

    // Track in macOS Dock recent items (renderer handles settingsStore tracking)
    app.addRecentDocument(path)

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
  ipcMain.handle('file:saveAs', async (_event, content: string, defaultFilename?: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultFilename,
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (result.canceled || !result.filePath) {
      return null
    }

    await writeFile(result.filePath, content, 'utf-8')

    // Track in macOS Dock recent items (renderer handles settingsStore tracking)
    app.addRecentDocument(result.filePath)

    return result.filePath
  })

  // File: Export as plain text
  ipcMain.handle('file:exportTxt', async (_event, content: string, defaultFilename?: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultFilename,
      filters: [
        { name: 'Text Files', extensions: ['txt'] }
      ]
    })

    if (result.canceled || !result.filePath) {
      return null
    }

    await writeFile(result.filePath, content, 'utf-8')
    return result.filePath
  })

  // File: Select folder dialog
  ipcMain.handle('file:selectFolder', async (_event, defaultPath?: string) => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      ...(defaultPath ? { defaultPath } : {}),
      ...(IS_MAS_BUILD ? { securityScopedBookmarks: true } : {})
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const path = result.filePaths[0]
    const bookmark = IS_MAS_BUILD ? (result.bookmarks?.[0] ?? null) : null

    // Activate bookmark access immediately for this session
    if (IS_MAS_BUILD && bookmark) {
      if (stopAccessingBookmark) {
        stopAccessingBookmark()
      }
      try {
        stopAccessingBookmark = app.startAccessingSecurityScopedResource(bookmark)
      } catch (err) {
        console.warn('[file:selectFolder] Could not activate bookmark:', err)
      }
    }

    return { path, bookmark }
  })

  // File: Save to folder with filename
  ipcMain.handle(
    'file:saveToFolder',
    async (_event, folder: string, filename: string, content: string) => {
      const safeFolder = validatePath(folder)
      // Preserve known extensions (.md, .markdown, .txt), default to .md
      const hasKnownExt = /\.(md|markdown|txt)$/.test(filename)
      const finalFilename = hasKnownExt ? filename : `${filename}.md`
      // Strip path separators from filename to prevent directory traversal
      const safeFilename = finalFilename.replace(/[/\\]/g, '-')
      const fullPath = join(safeFolder, safeFilename)
      await writeFile(fullPath, content, 'utf-8')
      return fullPath
    }
  )

  // File: Save image to disk alongside document
  // Returns { relativePath, localFileUrl } so the editor can display
  // via the local-file:// protocol while markdown uses relative paths.
  // Preserves original filename when available, adding a numeric suffix on conflict.
  ipcMain.handle(
    'file:saveImage',
    async (_event, documentDir: string, base64Data: string, mimeType: string, originalName?: string) => {
      const safeDir = validatePath(documentDir)
      const extMap: Record<string, string> = {
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/gif': '.gif',
        'image/webp': '.webp',
        'image/svg+xml': '.svg',
      }
      const ext = extMap[mimeType] || '.png'

      // Use original filename if meaningful, otherwise generate one
      let baseName: string
      if (originalName && originalName !== 'image.png' && originalName !== 'image.jpeg') {
        // Strip extension from original name — we'll use the mime-based one
        baseName = originalName.replace(/\.[^.]+$/, '')
      } else {
        baseName = randomUUID()
      }

      // Sanitize: remove path separators and problematic chars
      baseName = baseName.replace(/[/\\:*?"<>|]/g, '-').trim()

      // Find a unique filename, adding numeric suffix on conflict
      let filename = `${baseName}${ext}`
      let fullPath = join(safeDir, filename)
      let counter = 1
      while (true) {
        try {
          await access(fullPath)
          // File exists — try next suffix
          filename = `${baseName}-${counter}${ext}`
          fullPath = join(safeDir, filename)
          counter++
        } catch {
          // File doesn't exist — good to use
          break
        }
      }

      const buffer = Buffer.from(base64Data, 'base64')
      await writeFile(fullPath, buffer)
      return {
        relativePath: filename,
        localFileUrl: `local-file://${fullPath}`,
      }
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

  // File: Get file stats (timestamps, size)
  ipcMain.handle('file:stat', async (_event, path: string) => {
    const safePath = validatePath(path)
    const stats = await stat(safePath)
    return {
      createdAt: stats.birthtime.toISOString(),
      modifiedAt: stats.mtime.toISOString(),
      size: stats.size
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

  // File: Move to trash (recoverable delete)
  ipcMain.handle('file:trash', async (_event, path: string) => {
    const safePath = validatePath(path)
    await shell.trashItem(safePath)
  })

  // File: Duplicate file (returns new path)
  ipcMain.handle('file:duplicate', async (_event, path: string): Promise<string> => {
    const safePath = validatePath(path)
    const dir = safePath.substring(0, safePath.lastIndexOf('/'))
    const ext = safePath.match(/\.[^.]+$/)?.[0] || ''
    const baseName = safePath.substring(safePath.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '')

    // Find available name: "foo copy.md", "foo copy 2.md", etc.
    let copyNum = 0
    let newPath: string
    do {
      const suffix = copyNum === 0 ? ' copy' : ` copy ${copyNum + 1}`
      newPath = join(dir, `${baseName}${suffix}${ext}`)
      copyNum++
      try {
        await access(newPath)
        // File exists, try next number
      } catch {
        break // File doesn't exist, use this name
      }
    } while (copyNum < 100)

    // Guard: if all 100 names are taken, don't overwrite
    try {
      await access(newPath)
      throw new Error('Could not find available name for duplicate (100 copies exist)')
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Could not find')) throw e
      // access() threw = file doesn't exist = safe to use
    }

    await copyFile(safePath, newPath)
    return newPath
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
      const rawSettings = { ...defaultSettings, ...JSON.parse(content) }

      // Migration: if plaintext API key exists in JSON, migrate to secure storage
      if (credentialStore.isAvailable() && rawSettings.llm?.apiKey) {
        try {
          await credentialStore.set(LLM_API_KEY, rawSettings.llm.apiKey)
          rawSettings.llm = { ...rawSettings.llm, apiKey: '' }
          await writeFile(SETTINGS_PATH, JSON.stringify(rawSettings, null, 2), 'utf-8')
          console.log('[settings:load] Migrated plaintext API key to secure storage')
        } catch (err) {
          console.error('[settings:load] Migration failed:', err)
        }
      }

      // Migration: if plaintext reMarkable device token exists, migrate to secure storage
      if (credentialStore.isAvailable() && rawSettings.remarkable?.deviceToken) {
        try {
          await credentialStore.set(REMARKABLE_DEVICE_TOKEN, rawSettings.remarkable.deviceToken)
          rawSettings.remarkable = { ...rawSettings.remarkable, deviceToken: '' }
          await writeFile(SETTINGS_PATH, JSON.stringify(rawSettings, null, 2), 'utf-8')
          console.log('[settings:load] Migrated plaintext reMarkable device token to secure storage')
        } catch (err) {
          console.error('[settings:load] reMarkable token migration failed:', err)
        }
      }

      // Inject secrets from secure storage
      if (credentialStore.isAvailable()) {
        const storedKey = await credentialStore.get(LLM_API_KEY)
        if (storedKey) {
          rawSettings.llm = { ...rawSettings.llm, apiKey: storedKey }
        }
        const storedToken = await credentialStore.get(REMARKABLE_DEVICE_TOKEN)
        if (storedToken && rawSettings.remarkable) {
          rawSettings.remarkable = { ...rawSettings.remarkable, deviceToken: storedToken }
        }
      }

      // Restore security-scoped bookmark for MAS sandbox directory access
      if (IS_MAS_BUILD && rawSettings.masDirectoryBookmark) {
        if (stopAccessingBookmark) {
          stopAccessingBookmark()
          stopAccessingBookmark = null
        }
        try {
          stopAccessingBookmark = app.startAccessingSecurityScopedResource(
            rawSettings.masDirectoryBookmark
          )
        } catch (err) {
          console.warn('[settings:load] Security-scoped bookmark invalid, clearing:', err)
          rawSettings.masDirectoryBookmark = undefined
          rawSettings.defaultSaveDirectory = undefined
          try {
            await writeFile(SETTINGS_PATH, JSON.stringify(rawSettings, null, 2), 'utf-8')
          } catch { /* best effort */ }
        }
      }

      return rawSettings
    } catch {
      return defaultSettings
    }
  })

  // Settings: Save to ~/.prose/settings.json
  ipcMain.handle('settings:save', async (_event, settings: Settings) => {
    try {
      await mkdir(SETTINGS_DIR, { recursive: true })

      if (credentialStore.isAvailable()) {
        // Store API key securely; save settings without it
        const { apiKey, ...llmWithoutKey } = settings.llm
        if (apiKey) {
          await credentialStore.set(LLM_API_KEY, apiKey)
        }

        // Store reMarkable device token securely
        if (settings.remarkable?.deviceToken) {
          await credentialStore.set(REMARKABLE_DEVICE_TOKEN, settings.remarkable.deviceToken)
        }

        // Don't delete stored key when apiKey is empty — preserves the
        // credential if the field is momentarily cleared during editing
        const settingsToSave = {
          ...settings,
          llm: { ...llmWithoutKey, apiKey: '' },
          ...(settings.remarkable ? { remarkable: { ...settings.remarkable, deviceToken: '' } } : {})
        }
        await writeFile(SETTINGS_PATH, JSON.stringify(settingsToSave, null, 2), 'utf-8')
      } else {
        // Secure storage unavailable — save settings but strip secrets
        // to avoid storing credentials in plaintext on disk
        console.warn('[settings:save] Secure storage unavailable, secrets will not be persisted')
        const { apiKey: _stripped, ...llmWithoutKey } = settings.llm
        const settingsToSave = {
          ...settings,
          llm: { ...llmWithoutKey, apiKey: '' },
          ...(settings.remarkable ? { remarkable: { ...settings.remarkable, deviceToken: '' } } : {})
        }
        await writeFile(SETTINGS_PATH, JSON.stringify(settingsToSave, null, 2), 'utf-8')
      }
    } catch (error) {
      console.error('Failed to save settings:', error)
      throw error
    }
  })

  ipcMain.handle('settings:isSecureStorageAvailable', () => {
    return credentialStore.isAvailable()
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
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'Hi' }]
          })
          return { success: true, message: 'API key is valid' }
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
    const { streamText } = await import('ai')

    const anthropic = createAnthropic({
      apiKey: request.apiKey,
      baseURL: 'https://api.anthropic.com/v1'
    })
    const model = anthropic(request.model)

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
          max_tokens: request.maxTokens || 4096,
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

    // Non-tool path: use AI SDK with Anthropic
    const { createAnthropic } = await import('@ai-sdk/anthropic')
    const { streamText } = await import('ai')

    const anthropic = createAnthropic({
      apiKey: request.apiKey,
      baseURL: 'https://api.anthropic.com/v1'
    })
    const model = anthropic(request.model)

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

      // Get Anthropic API key - first from credentialStore (LLM key if provider is Anthropic),
      // then fall back to the reMarkable-specific secure storage
      let anthropicApiKey: string | undefined
      try {
        const content = await readFile(SETTINGS_PATH, 'utf-8')
        const settings = JSON.parse(content) as Settings
        // API key is now in credentialStore after migration
        if (credentialStore.isAvailable()) {
          anthropicApiKey = (await credentialStore.get(LLM_API_KEY)) ?? undefined
        } else if (settings.llm?.apiKey) {
          // Fallback for non-MAS platforms without secure storage
          anthropicApiKey = settings.llm.apiKey
        }
      } catch {
        // Settings not found or invalid
      }

      // If no key from LLM settings, try reMarkable-specific credential store
      if (!anthropicApiKey) {
        const remarkableKey = await credentialStore.get(REMARKABLE_CREDENTIAL_KEY)
          ?? await credentialStore.migrateFromLegacyFile(ANTHROPIC_KEY_PATH, REMARKABLE_CREDENTIAL_KEY)
        if (remarkableKey) {
          anthropicApiKey = remarkableKey
        }
      }

      return await syncAll(deviceToken, syncDirectory, anthropicApiKey)
    }
  )

  // reMarkable: Disconnect (clear cached connection + purge sync data)
  ipcMain.handle('remarkable:disconnect', async (_event, syncDirectory?: string) => {
    const { disconnect } = await import('./remarkable/client')
    disconnect()

    if (syncDirectory) {
      const { purgeSync } = await import('./remarkable/sync')
      await purgeSync(syncDirectory)
    }

    await credentialStore.delete(REMARKABLE_CREDENTIAL_KEY)
    // Also clean up legacy file if it exists
    try { await unlink(ANTHROPIC_KEY_PATH) } catch { /* ignore */ }
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

  // reMarkable: Store Anthropic API key securely via credentialStore
  ipcMain.handle('remarkable:storeApiKey', async (_event, apiKey: string) => {
    await credentialStore.set(REMARKABLE_CREDENTIAL_KEY, apiKey)
  })

  ipcMain.handle('remarkable:getApiKey', async () => {
    return await credentialStore.get(REMARKABLE_CREDENTIAL_KEY)
      ?? await credentialStore.migrateFromLegacyFile(ANTHROPIC_KEY_PATH, REMARKABLE_CREDENTIAL_KEY)
  })

  ipcMain.handle('remarkable:clearApiKey', async () => {
    await credentialStore.delete(REMARKABLE_CREDENTIAL_KEY)
    // Also clean up legacy file if it exists
    try { await unlink(ANTHROPIC_KEY_PATH) } catch { /* ignore */ }
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

  // Emoji: Generate emoji for a tab title (runs in main process to avoid CORS)
  ipcMain.handle('emoji:generate', async (_event, title: string, contentPreview?: string): Promise<{ emoji: string | null; error?: string }> => {
    try {
      // Read settings to check provider, then get API key from secure storage
      let settings: Settings
      try {
        const content = await readFile(SETTINGS_PATH, 'utf-8')
        settings = { ...defaultSettings, ...JSON.parse(content) }
      } catch {
        settings = defaultSettings
      }

      // Get API key from credentialStore (primary) or settings.json (fallback for non-MAS)
      let apiKey = settings.llm.apiKey
      if (!apiKey && credentialStore.isAvailable()) {
        apiKey = (await credentialStore.get(LLM_API_KEY)) || ''
      }

      if (!apiKey) {
        return { emoji: null, error: 'no-api-key' }
      }

      const Anthropic = (await import('@anthropic-ai/sdk')).default
      const client = new Anthropic({ apiKey })

      // Build prompt with optional content preview for better context
      let prompt = title
      if (contentPreview) {
        prompt = `Title: ${title}\nContent preview: ${contentPreview}`
      }

      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 10,
        system: 'Respond with exactly ONE emoji that represents the document. Nothing else — no text, no explanation, just the emoji.',
        messages: [{ role: 'user', content: prompt }]
      })

      const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : ''
      const emojiMatch = text.match(/\p{Emoji_Presentation}/u)

      return { emoji: emojiMatch ? emojiMatch[0] : null }
    } catch (err) {
      console.error('[emoji:generate] Error:', err)
      return { emoji: null, error: err instanceof Error ? err.message : 'Unknown error' }
    }
  })

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

  ipcMain.handle('window:isFullScreen', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    return window?.isFullScreen() ?? false
  })

  ipcMain.handle('window:exitFullScreen', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window?.isFullScreen()) {
      window.setFullScreen(false)
    }
  })

  // Recent Files: Refresh the native menu (called by renderer after settingsStore.addRecentFile)
  ipcMain.handle('recentFiles:refreshMenu', async () => {
    refreshMenu()
  })

  // Recent Files: Clear all recent files
  ipcMain.handle('recentFiles:clear', async () => {
    clearRecentFiles()
    refreshMenu()
    app.clearRecentDocuments()
  })

  // Shell: Open external URL (for CMD+Click on links)
  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    // Validate URL before opening
    try {
      const parsed = new URL(url)
      // Only allow http/https protocols for security
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        await shell.openExternal(url)
      }
    } catch {
      // Invalid URL, ignore
    }
  })

  // File Association: Check if app is default handler (informational only)
  // Returns: true, false, or null (can't determine)
  ipcMain.handle('fileAssociation:isDefault', async () => {
    if (process.platform !== 'darwin') return null

    try {
      const { execSync } = await import('child_process')
      // Try duti if available (informational query only)
      // Use stdio option to properly suppress stderr and avoid EPIPE errors
      const result = execSync('duti -x md', {
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 5000,
      }).toString().trim()
      const lines = result.split('\n')
      const bundleId = lines[2] // Third line is bundle ID
      return bundleId === 'ist.solo.prose' || bundleId?.toLowerCase().includes('prose')
    } catch {
      return null // Can't determine - that's fine
    }
  })

  // Google: Check if credentials are configured (env vars present)
  ipcMain.handle('google:isConfigured', () => {
    return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
  })

  // Google: Start OAuth flow
  ipcMain.handle('google:startAuth', async () => {
    if (IS_MAS_BUILD) {
      return { success: false, error: 'Google Docs sync is not available in the Mac App Store version.' }
    }
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

  // MCP: Get installation status
  ipcMain.handle('mcp:getStatus', async (): Promise<{
    installed: boolean
    version: string | null
    appVersion: string
    needsUpdate: boolean
    configPath: string
    serverPath: string
  }> => {
    const MCP_SERVER_DIR = join(app.getPath('userData'), 'mcp-server')
    const MCP_SERVER_PATH = join(MCP_SERVER_DIR, 'mcp-stdio.js')
    const VERSION_PATH = join(MCP_SERVER_DIR, 'version.json')
    const CONFIG_PATH = join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
    const appVersion = app.getVersion()

    let installed = false
    let version: string | null = null
    let needsUpdate = false

    try {
      await access(MCP_SERVER_PATH)
      installed = true

      // Check version
      try {
        const versionData = JSON.parse(await readFile(VERSION_PATH, 'utf-8'))
        version = versionData.version
        needsUpdate = version !== appVersion
      } catch {
        // No version file, needs update
        needsUpdate = true
      }
    } catch {
      // Server not installed
    }

    return {
      installed,
      version,
      appVersion,
      needsUpdate,
      configPath: CONFIG_PATH,
      serverPath: MCP_SERVER_PATH
    }
  })

  // MCP: Install server
  ipcMain.handle('mcp:install', async (): Promise<{ success: boolean; error?: string }> => {
    if (IS_MAS_BUILD) {
      return { success: false, error: 'MCP server installation is not available in the Mac App Store version.' }
    }
    const MCP_SERVER_DIR = join(app.getPath('userData'), 'mcp-server')
    const MCP_SERVER_PATH = join(MCP_SERVER_DIR, 'mcp-stdio.js')
    const VERSION_PATH = join(MCP_SERVER_DIR, 'version.json')
    const CONFIG_PATH = join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
    const appVersion = app.getVersion()

    try {
      // Create MCP server directory
      await mkdir(MCP_SERVER_DIR, { recursive: true })

      // Copy the mcp-stdio.js from app resources
      const resourcePath = app.isPackaged
        ? join(process.resourcesPath, 'mcp-stdio.js')
        : join(__dirname, '../../out/mcp-stdio.js')

      const serverCode = await readFile(resourcePath, 'utf-8')
      await writeFile(MCP_SERVER_PATH, serverCode, 'utf-8')

      // Write version file
      await writeFile(VERSION_PATH, JSON.stringify({ version: appVersion }), 'utf-8')

      // Update Claude Desktop config
      let config: { mcpServers?: Record<string, unknown> } = { mcpServers: {} }
      let configExists = false
      try {
        const configContent = await readFile(CONFIG_PATH, 'utf-8')
        config = JSON.parse(configContent)
        configExists = true
      } catch {
        // Config doesn't exist, we'll create it
      }

      // Backup existing config before modifying
      if (configExists) {
        const BACKUP_PATH = CONFIG_PATH + '.backup'
        try {
          await copyFile(CONFIG_PATH, BACKUP_PATH)
          console.log('[MCP:install] Backed up config to', BACKUP_PATH)
        } catch (backupErr) {
          console.error('[MCP:install] Failed to backup config:', backupErr)
          // Continue anyway - backup failure shouldn't block install
        }
      }

      // Ensure mcpServers exists
      if (!config.mcpServers) {
        config.mcpServers = {}
      }

      // Remove old lowercase key if present (migration)
      if (config.mcpServers.prose) {
        delete config.mcpServers.prose
      }

      // Add Prose entry (capitalized key)
      config.mcpServers.Prose = {
        command: 'node',
        args: [MCP_SERVER_PATH]
      }

      // Ensure Claude config directory exists
      await mkdir(join(homedir(), 'Library', 'Application Support', 'Claude'), { recursive: true })
      await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')

      return { success: true }
    } catch (error) {
      console.error('[MCP:install] Error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  })

  // MCP: Uninstall server
  ipcMain.handle('mcp:uninstall', async (): Promise<{ success: boolean; error?: string }> => {
    const MCP_SERVER_DIR = join(app.getPath('userData'), 'mcp-server')
    const CONFIG_PATH = join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')

    try {
      // Remove from Claude Desktop config
      try {
        const configContent = await readFile(CONFIG_PATH, 'utf-8')
        const config = JSON.parse(configContent)
        // Remove both capitalized and legacy lowercase keys
        let removed = false
        if (config.mcpServers?.Prose) {
          delete config.mcpServers.Prose
          removed = true
        }
        if (config.mcpServers?.prose) {
          delete config.mcpServers.prose
          removed = true
        }
        if (removed) {
          await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
        }
      } catch {
        // Config doesn't exist or can't be read, that's fine
      }

      // Remove server files
      try {
        const { rm } = await import('fs/promises')
        await rm(MCP_SERVER_DIR, { recursive: true, force: true })
      } catch {
        // Directory doesn't exist, that's fine
      }

      return { success: true }
    } catch (error) {
      console.error('[MCP:uninstall] Error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  })
}
