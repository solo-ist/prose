// @vitest-environment node
/** Which profile the stdio bridge serves (#1235, finishing #1139). */
import { describe, expect, it } from 'vitest'
import { resolveProfile } from './profile'

const HOME = '/Users/u'
const INSTALLED = '/Users/u/Library/Application Support/Prose'
const base = { env: {}, platform: 'darwin' as const, home: HOME }

describe('resolveProfile', () => {
  it('the bundled copy in the app serves the installed app, which it may launch', () => {
    expect(resolveProfile({ ...base, scriptDir: '/Applications/Prose.app/Contents/Resources' })).toEqual({ dir: INSTALLED, isInstalledApp: true })
  })

  it('a copy installed into a profile serves that profile', () => {
    expect(resolveProfile({ ...base, scriptDir: '/Users/u/Library/Application Support/Prose Dev/mcp-server' })).toEqual({
      dir: '/Users/u/Library/Application Support/Prose Dev',
      isInstalledApp: false
    })
    // Electron names the installed profile "prose"; macOS paths are case-insensitive.
    expect(resolveProfile({ ...base, scriptDir: '/Users/u/Library/Application Support/prose/mcp-server' }).isInstalledApp).toBe(true)
  })

  it('PROSE_USER_DATA_DIR wins, matching the app', () => {
    expect(resolveProfile({ ...base, env: { PROSE_USER_DATA_DIR: '/tmp/p' }, scriptDir: `${INSTALLED}/mcp-server` })).toEqual({
      dir: '/tmp/p',
      isInstalledApp: false
    })
  })

  it('follows the platform conventions elsewhere', () => {
    expect(resolveProfile({ env: { XDG_CONFIG_HOME: '/x' }, platform: 'linux', home: '/home/u', scriptDir: '/opt/prose' }).dir).toBe('/x/Prose')
    expect(resolveProfile({ env: { APPDATA: 'C:\\A' }, platform: 'win32', home: 'C:\\U', scriptDir: 'C:\\P' }).dir).toContain('Prose')
  })
})
