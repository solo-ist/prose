/**
 * MCP Bridge - IPC bridge for renderer communication.
 * Sends tool invocations to the renderer and tracks pending requests.
 */

import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import type { ToolResult } from '../../shared/tools/types'

interface PendingRequest {
  resolve: (result: ToolResult) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

const TOOL_TIMEOUT_MS = 30000 // 30 second timeout for tool execution

/**
 * Bridge for MCP server to communicate with renderer.
 */
export class McpBridge {
  private window: BrowserWindow | null = null
  private pendingRequests: Map<string, PendingRequest> = new Map()
  private requestId = 0

  constructor() {
    // Listen for results from renderer
    ipcMain.on('mcp:tool:result', (_event, requestId: string, result: ToolResult) => {
      this.handleResult(requestId, result)
    })
  }

  /**
   * Set the renderer window for communication.
   */
  setWindow(window: BrowserWindow): void {
    this.window = window
  }

  /**
   * Execute a tool by sending it to the renderer.
   * Returns a promise that resolves with the tool result.
   */
  executeTool(name: string, args: unknown): Promise<ToolResult> {
    return new Promise((resolve, reject) => {
      if (!this.window) {
        reject(new Error('No renderer window available'))
        return
      }

      const requestId = `mcp-${++this.requestId}`

      // Set up timeout
      const timeout = setTimeout(() => {
        const pending = this.pendingRequests.get(requestId)
        if (pending) {
          this.pendingRequests.delete(requestId)
          reject(new Error(`Tool execution timed out after ${TOOL_TIMEOUT_MS}ms`))
        }
      }, TOOL_TIMEOUT_MS)

      // Store pending request
      this.pendingRequests.set(requestId, { resolve, reject, timeout })

      // Send to renderer
      this.window.webContents.send('mcp:tool:invoke', requestId, name, args)
    })
  }

  /**
   * Handle result from renderer.
   */
  private handleResult(requestId: string, result: ToolResult): void {
    const pending = this.pendingRequests.get(requestId)
    if (!pending) {
      console.warn(`[MCP Bridge] Received result for unknown request: ${requestId}`)
      return
    }

    clearTimeout(pending.timeout)
    this.pendingRequests.delete(requestId)
    pending.resolve(result)
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    // Clear all pending requests
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('Bridge destroyed'))
    }
    this.pendingRequests.clear()
    this.window = null
  }
}

// Singleton instance
let bridgeInstance: McpBridge | null = null

/**
 * Get or create the MCP bridge instance.
 */
export function getMcpBridge(): McpBridge {
  if (!bridgeInstance) {
    bridgeInstance = new McpBridge()
  }
  return bridgeInstance
}
