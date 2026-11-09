import { join } from 'path'
import { app } from 'electron'

/** The mcp-stdio bundle this build ships: what both installs (config file, `.mcpb`) put in place. */
export function bundledMcpServerPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'mcp-stdio.cjs')
    : join(__dirname, '../../out/mcp-stdio.cjs')
}
