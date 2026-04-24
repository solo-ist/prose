/**
 * reMarkable Cloud API client wrapper using rmapi-js
 */
import { register as rmapiRegister, remarkable, type RemarkableApi, type Entry, type DocumentType } from 'rmapi-js'

export interface RemarkableNotebook {
  id: string
  hash: string
  name: string
  parent: string | null
  type: 'folder' | 'notebook'
  fileType?: 'epub' | 'pdf' | 'notebook'
  lastModified: string
  lastOpened?: string
  pinned: boolean
}

export interface RemarkableClient {
  listNotebooks(): Promise<RemarkableNotebook[]>
  downloadNotebook(id: string, hash: string): Promise<Uint8Array>
  moveNotebook(hash: string, newParentId: string): Promise<void>
  createFolder(name: string, parentId?: string): Promise<string>
  disconnect(): void
}

// Cached API instance
let cachedApi: RemarkableApi | null = null
let cachedToken: string | null = null

/**
 * Register a new device with reMarkable cloud
 * @param code - The 8-letter one-time code from my.remarkable.com
 * @returns The device token for future authentication
 */
export async function registerDevice(code: string): Promise<string> {
  // reMarkable API requires lowercase codes
  const normalizedCode = code.toLowerCase().replace(/[^a-z]/g, '')

  if (normalizedCode.length !== 8) {
    throw new Error('Invalid code format. Please enter the 8-letter code from my.remarkable.com')
  }

  try {
    console.log('[reMarkable] Attempting registration with code:', normalizedCode.substring(0, 2) + '...')
    const deviceToken = await rmapiRegister(normalizedCode, {
      deviceDesc: 'desktop-macos'
    })
    console.log('[reMarkable] Registration successful')
    return deviceToken
  } catch (error) {
    console.error('[reMarkable] Registration error:', error)

    // rmapi-js throws ResponseError with status info
    const responseError = error as { status?: number; statusText?: string; message?: string }
    if (responseError.status) {
      console.error('[reMarkable] HTTP Status:', responseError.status, responseError.statusText)

      if (responseError.status === 400) {
        throw new Error('Invalid or expired code. Please get a new code from my.remarkable.com')
      }
      if (responseError.status === 429) {
        throw new Error('Too many registration attempts. Please wait a few minutes and try again.')
      }
      throw new Error(`Registration failed (HTTP ${responseError.status}): ${responseError.statusText}`)
    }

    if (error instanceof Error) {
      throw new Error(`Registration failed: ${error.message}`)
    }
    throw error
  }
}

/**
 * Connect to reMarkable cloud with an existing device token
 * @param deviceToken - The device token from previous registration
 * @returns A client instance for interacting with reMarkable
 */
export async function connect(deviceToken: string): Promise<RemarkableClient> {
  // Reuse cached API if token matches
  if (cachedApi && cachedToken === deviceToken) {
    return createClient(cachedApi)
  }

  try {
    const api = await remarkable(deviceToken)
    cachedApi = api
    cachedToken = deviceToken
    return createClient(api)
  } catch (error) {
    cachedApi = null
    cachedToken = null
    if (error instanceof Error) {
      if (error.message.includes('401') || error.message.includes('Unauthorized')) {
        throw new Error('Device token expired or revoked. Please re-register your device.')
      }
      throw new Error(`Connection failed: ${error.message}`)
    }
    throw error
  }
}

/**
 * Validate a device token by attempting to connect
 */
export async function validateToken(deviceToken: string): Promise<boolean> {
  try {
    await connect(deviceToken)
    return true
  } catch {
    return false
  }
}

/**
 * Clear the cached API connection
 */
export function disconnect(): void {
  cachedApi = null
  cachedToken = null
}

function createClient(api: RemarkableApi): RemarkableClient {
  return {
    async listNotebooks(): Promise<RemarkableNotebook[]> {
      const items = await api.listItems(true)

      return items.map((item: Entry): RemarkableNotebook => {
        const isDocument = item.type === 'DocumentType'
        const doc = item as DocumentType

        return {
          id: item.id,
          hash: item.hash,
          name: item.visibleName,
          parent: item.parent === '' ? null : item.parent === 'trash' ? 'trash' : item.parent,
          type: item.type === 'CollectionType' ? 'folder' : 'notebook',
          fileType: isDocument ? doc.fileType : undefined,
          lastModified: item.lastModified,
          lastOpened: isDocument ? doc.lastOpened : undefined,
          pinned: item.pinned
        }
      }).filter(item => item.parent !== 'trash') // Exclude trashed items
    },

    async downloadNotebook(id: string, hash: string): Promise<Uint8Array> {
      // getDocument returns a zip containing all notebook files
      return await api.getDocument(hash)
    },

    async moveNotebook(hash: string, newParentId: string): Promise<void> {
      await api.move(hash, newParentId)
    },

    async createFolder(name: string, parentId?: string): Promise<string> {
      // rmapi-js's putFolder takes FolderOptions ({ parent?: string }), NOT
      // a bare parent string. Passing a string causes JS to destructure it
      // into { parent: undefined }, defaulting parent to "" (root) — so
      // every nested folder silently lands at the cloud root regardless of
      // the intended parent. The options-object form fixes that.
      //
      // Return the folder's id, not its hash. Callers use this value as the
      // `parent` argument to subsequent move() calls, and rmapi-js's
      // move(hash, parent) expects parent to be a document id (UUID4).
      // notebookMetadata.notebooks is also keyed by id, so callers that store
      // this value as `parent` in local metadata stay consistent with how
      // existing folders are referenced.
      const entry = await api.putFolder(name, { parent: parentId || '' })
      return entry.id
    },

    disconnect(): void {
      disconnect()
    }
  }
}
