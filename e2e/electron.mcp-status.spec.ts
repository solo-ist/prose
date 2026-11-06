/**
 * MCP update detection (#1056).
 *
 * `needsUpdate` used to compare the app version against a marker storing the
 * app version, so every release offered a reinstall that changed nothing.
 * It now compares what is installed against what mcp:install would write.
 *
 * Runs entirely against scratch paths — an isolated PROSE_USER_DATA_DIR for
 * the installed server, and PROSE_CLAUDE_CONFIG_PATH for Claude Desktop's
 * config — so the machine's real MCP install is never read or touched.
 */

import { test, expect } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ElectronApplication, Page } from '@playwright/test'
import { launchApp, waitForAppReady } from './helpers'

interface McpStatus {
  installed: boolean
  version: string | null
  appVersion: string
  needsUpdate: boolean
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const BUNDLED_SERVER = resolve(__dirname, '..', 'out', 'mcp-stdio.cjs')

function getStatus(page: Page): Promise<McpStatus> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).api.mcpGetStatus() as Promise<McpStatus>
  })
}

/** A profile with the MCP server "installed" from the given source bytes. */
function seedProfile(serverSource: string, marker: Record<string, unknown>) {
  const userData = mkdtempSync(join(tmpdir(), 'prose-mcp-'))
  const serverDir = join(userData, 'mcp-server')
  mkdirSync(serverDir, { recursive: true })
  const serverPath = join(serverDir, 'mcp-stdio.cjs')
  writeFileSync(serverPath, serverSource)
  writeFileSync(join(serverDir, 'version.json'), JSON.stringify(marker))

  const configPath = join(mkdtempSync(join(tmpdir(), 'prose-claude-')), 'claude_desktop_config.json')
  writeFileSync(
    configPath,
    JSON.stringify({ mcpServers: { Prose: { command: '/usr/bin/node', args: [serverPath] } } }),
  )
  return { userData, configPath, serverPath }
}

async function launchWith(env: Record<string, string>) {
  const launched = await launchApp({ env })
  await waitForAppReady(launched.page)
  return launched
}

let app: ElectronApplication | undefined

test.afterEach(async () => {
  await app?.close()
  app = undefined
})

test.skip(process.platform !== 'darwin', 'MCP install targets Claude Desktop on macOS')

test('a current install reports no update, whatever the app version says', async () => {
  test.setTimeout(60_000)
  expect(existsSync(BUNDLED_SERVER), 'run npm run build first').toBe(true)

  // The marker deliberately carries a stale app version — the old code's
  // entire update signal. It must no longer matter.
  const { userData, configPath } = seedProfile(readFileSync(BUNDLED_SERVER, 'utf-8'), {
    version: '0.0.1-ancient',
  })
  const launched = await launchWith({ PROSE_USER_DATA_DIR: userData, PROSE_CLAUDE_CONFIG_PATH: configPath })
  app = launched.app

  const status = await getStatus(launched.page)
  expect(status.installed).toBe(true)
  expect(status.needsUpdate).toBe(false)
  expect(status.version).toBe('0.0.1-ancient')
})

test('a legacy marker with no fingerprint migrates without a spurious prompt', async () => {
  test.setTimeout(60_000)
  // Legacy installs wrote { version } and nothing else. Contents match, so
  // there is nothing to prompt about.
  const { userData, configPath } = seedProfile(readFileSync(BUNDLED_SERVER, 'utf-8'), { version: '1.8.2' })
  const launched = await launchWith({ PROSE_USER_DATA_DIR: userData, PROSE_CLAUDE_CONFIG_PATH: configPath })
  app = launched.app

  expect((await getStatus(launched.page)).needsUpdate).toBe(false)
})

test('a changed MCP surface does report an update', async () => {
  test.setTimeout(60_000)
  // Stands in for a tool-schema change: the surface compiles into these bytes.
  const stale = readFileSync(BUNDLED_SERVER, 'utf-8') + '\n// an older build\n'
  const { userData, configPath } = seedProfile(stale, { version: '1.8.2' })
  const launched = await launchWith({ PROSE_USER_DATA_DIR: userData, PROSE_CLAUDE_CONFIG_PATH: configPath })
  app = launched.app

  expect((await getStatus(launched.page)).needsUpdate).toBe(true)
})

test('a config entry that lost its Prose server reports an update', async () => {
  test.setTimeout(60_000)
  const { userData, configPath } = seedProfile(readFileSync(BUNDLED_SERVER, 'utf-8'), { version: '1.8.2' })
  writeFileSync(configPath, JSON.stringify({ mcpServers: {} }))
  const launched = await launchWith({ PROSE_USER_DATA_DIR: userData, PROSE_CLAUDE_CONFIG_PATH: configPath })
  app = launched.app

  expect((await getStatus(launched.page)).needsUpdate).toBe(true)
})

test('nothing installed reports neither installed nor needing an update', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'prose-mcp-empty-'))
  const configPath = join(mkdtempSync(join(tmpdir(), 'prose-claude-')), 'claude_desktop_config.json')
  const launched = await launchWith({ PROSE_USER_DATA_DIR: userData, PROSE_CLAUDE_CONFIG_PATH: configPath })
  app = launched.app

  const status = await getStatus(launched.page)
  expect(status.installed).toBe(false)
  expect(status.needsUpdate).toBe(false)
})
