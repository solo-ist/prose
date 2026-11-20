/**
 * Which Prose profile the stdio bridge talks to: the socket and the auth
 * token live in that profile's folder.
 *
 * In order: PROSE_USER_DATA_DIR (the e2e/QA seam, matching the app's own
 * override); else the profile the bridge was installed into — Settings →
 * Integrations copies it to `<profile>/mcp-server/mcp-stdio.cjs`, so a bridge
 * installed from the dev app talks to the dev app (#1139); else the installed
 * app's `Prose` profile (the bundled copy in the app's Resources).
 */

import * as path from 'path'

export interface ProfileInputs {
  env: NodeJS.ProcessEnv
  /** The directory this script runs from (`__dirname`). */
  scriptDir: string
  platform: NodeJS.Platform
  home: string
}

export interface ResolvedProfile {
  dir: string
  /** The installed app's own profile: the only one the bridge may launch the app for. */
  isInstalledApp: boolean
}

/** The installed app's profile folder (Electron's userData for "Prose"). */
export function installedProfileDir({ env, platform, home }: Omit<ProfileInputs, 'scriptDir'>): string {
  switch (platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'Prose')
    case 'win32':
      return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Prose')
    default: // linux, freebsd, etc.
      return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Prose')
  }
}

export function resolveProfile(inputs: ProfileInputs): ResolvedProfile {
  const installed = installedProfileDir(inputs)
  const same = (a: string, b: string): boolean =>
    // macOS and Windows profile paths are case-insensitive ("prose" vs "Prose").
    inputs.platform === 'linux' ? a === b : a.toLowerCase() === b.toLowerCase()

  if (inputs.env.PROSE_USER_DATA_DIR) {
    const dir = inputs.env.PROSE_USER_DATA_DIR
    return { dir, isInstalledApp: same(dir, installed) }
  }
  if (path.basename(inputs.scriptDir) === 'mcp-server') {
    const dir = path.dirname(inputs.scriptDir)
    return { dir, isInstalledApp: same(dir, installed) }
  }
  return { dir: installed, isInstalledApp: true }
}
