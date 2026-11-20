import { readFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

/**
 * Prose's version for the MCP server info. app.getVersion() reports
 * Electron's own version when the app runs unpackaged (dev, e2e: there is no
 * package.json beside the entry), so read the project's package.json there.
 */
export function proseVersion(): string {
  if (app.isPackaged) return app.getVersion()
  try {
    // out/main/index.js → the project root.
    return (JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as { version: string }).version
  } catch {
    return app.getVersion()
  }
}
