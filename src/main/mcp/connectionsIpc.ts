/**
 * IPC for MCP connections (#1236): Settings → Integrations → Connections.
 * `create` is the one place a connection's token leaves main, once. MCP is
 * off in the Mac App Store build, so every handler refuses there.
 */

import { ipcMain } from 'electron'
import { IS_MAS_BUILD } from '../env'
import { getMcpConnectionStore } from './connectionStore'
import { McpConnectionError, type McpConnection } from './connections'
import { getMcpHttpServer } from './http-server'

export type McpConnectionResult<T> = { ok: true; value: T } | { ok: false; error: string }

export interface McpEndpointInfo {
  /** The HTTP endpoint is listening (false on MAS, or when its port was taken). */
  available: boolean
  port: number
  url: string
}

const MAS_ERROR = 'MCP connections are not available in the Mac App Store version.'

function run<T>(action: () => T): McpConnectionResult<T> {
  if (IS_MAS_BUILD) return { ok: false, error: MAS_ERROR }
  try {
    return { ok: true, value: action() }
  } catch (err) {
    if (err instanceof McpConnectionError) return { ok: false, error: err.message }
    console.error('[MCP] Connection operation failed:', err)
    return { ok: false, error: 'The connection could not be saved' }
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function setupMcpConnectionHandlers(): void {
  ipcMain.handle('mcp:connections:list', (): McpConnectionResult<McpConnection[]> => run(() => getMcpConnectionStore().list()))

  ipcMain.handle('mcp:connections:create', (_event, label: unknown): McpConnectionResult<{ connection: McpConnection; token: string }> =>
    run(() => getMcpConnectionStore().create(text(label)))
  )

  ipcMain.handle('mcp:connections:rename', (_event, id: unknown, label: unknown): McpConnectionResult<McpConnection> =>
    run(() => getMcpConnectionStore().rename(text(id), text(label)))
  )

  ipcMain.handle('mcp:connections:revoke', (_event, id: unknown): McpConnectionResult<null> =>
    run(() => {
      getMcpConnectionStore().revoke(text(id))
      return null
    })
  )

  ipcMain.handle('mcp:endpoint', (): McpEndpointInfo => {
    const port = IS_MAS_BUILD ? 0 : getMcpHttpServer().port
    return { available: port > 0, port, url: port > 0 ? `http://localhost:${port}/mcp` : '' }
  })
}
