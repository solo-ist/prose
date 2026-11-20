/**
 * IPC for the Claude Desktop extension (#1257): build this profile's `.mcpb`
 * and hand it to Claude Desktop, which shows its install dialog. MCP is off
 * in the Mac App Store build, so the handler refuses there.
 */

import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { app, ipcMain, shell } from 'electron'
import { IS_MAS_BUILD } from '../env'
import { bundledMcpServerPath } from './bundledServer'
import { buildMcpb, mcpbManifest } from './mcpb'
import { proseVersion } from './version'

export interface McpExtensionResult {
  success: boolean
  /** The `.mcpb` written for this profile. */
  path?: string
  error?: string
}

export function setupMcpExtensionHandlers(): void {
  ipcMain.handle('mcp:installExtension', async (): Promise<McpExtensionResult> => {
    if (IS_MAS_BUILD) {
      return { success: false, error: 'The Claude Desktop extension is not available in the Mac App Store version.' }
    }
    try {
      const profile = {
        dir: app.getPath('userData'),
        // The installed app on its own profile: the bridge's default, so the manifest names no profile.
        isInstalledApp: app.isPackaged && !process.env.PROSE_USER_DATA_DIR
      }
      const manifest = mcpbManifest(proseVersion(), profile, process.platform)
      const dir = join(profile.dir, 'mcp-server')
      await mkdir(dir, { recursive: true })
      const path = join(dir, 'Prose.mcpb')
      await writeFile(path, buildMcpb(await readFile(bundledMcpServerPath()), manifest))

      // Test seam (like PROSE_CLAUDE_CONFIG_PATH): write without handing it to Claude Desktop.
      if (process.env.PROSE_MCPB_OPEN === '0') return { success: true, path }
      const failure = await shell.openPath(path)
      if (failure) {
        return { success: false, path, error: `Claude Desktop couldn't open the extension (${failure}). Is Claude Desktop installed?` }
      }
      return { success: true, path }
    } catch (err) {
      console.error('[MCP] Building the Claude Desktop extension failed:', err)
      return { success: false, error: 'The Claude Desktop extension could not be built' }
    }
  })
}
