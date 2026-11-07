import { join } from 'path'
import { app } from 'electron'
import { McpConnectionStore } from './connections'

let store: McpConnectionStore | null = null

/**
 * The app's MCP connection store (#1236), in the profile in force: resolved
 * on first use, which is after index.ts has redirected userData.
 */
export function getMcpConnectionStore(): McpConnectionStore {
  if (!store) store = new McpConnectionStore(join(app.getPath('userData'), 'mcp-connections.json'))
  return store
}

/** Write pending last-use times, if the store was ever opened. */
export function flushMcpConnectionStore(): void {
  try {
    store?.flush()
  } catch (err) {
    console.warn('[MCP] Could not save connection last-use times:', err)
  }
}
