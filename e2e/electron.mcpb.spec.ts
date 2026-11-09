/**
 * The Claude Desktop extension (#1257): main builds this profile's `.mcpb`,
 * and the server inside it, run the way Claude Desktop runs an extension
 * (`node server/index.cjs` with the manifest's env), reaches this app.
 * PROSE_MCPB_OPEN=0 keeps Claude Desktop out of it: the file is written, not opened.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { launchApp, waitForAppReady, dismissOnboarding, dismissOverlay, seedSettings } from './helpers'

/* eslint-disable @typescript-eslint/no-explicit-any */

const __dirname = dirname(fileURLToPath(import.meta.url))
const BUNDLED_SERVER = resolve(__dirname, '..', 'out', 'mcp-stdio.cjs')
const MCP_PORT = process.env.PROSE_MCP_PORT ?? '9893'

let app: ElectronApplication
let page: Page
let userDataDir: string
let unpacked: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  test.setTimeout(120_000)
  userDataDir = mkdtempSync(join(tmpdir(), 'prose-1257-'))
  unpacked = mkdtempSync(join(tmpdir(), 'prose-1257-mcpb-'))
  seedSettings(userDataDir, { fileAssociation: { hasBeenPrompted: true } })
  const launched = await launchApp({ env: { PROSE_USER_DATA_DIR: userDataDir, PROSE_MCP_PORT: MCP_PORT, PROSE_MCPB_OPEN: '0' } })
  app = launched.app
  page = launched.page
  await waitForAppReady(page)
  await dismissOnboarding(page).catch(() => {})
  await dismissOverlay(page).catch(() => {})
  await expect.poll(() => existsSync(join(userDataDir, 'prose.sock')), { timeout: 15_000 }).toBe(true)
})

test.afterAll(async () => {
  await app?.close()
  rmSync(userDataDir, { recursive: true, force: true })
  rmSync(unpacked, { recursive: true, force: true })
})

test('builds this profile\'s .mcpb, and its server reaches the app the way Claude Desktop runs it', async () => {
  const result = await page.evaluate(() => (window as any).api.mcpInstallExtension())
  expect(result, JSON.stringify(result)).toMatchObject({ success: true, path: join(userDataDir, 'mcp-server', 'Prose.mcpb') })

  execFileSync('unzip', ['-q', result.path, '-d', unpacked])
  const manifest = JSON.parse(readFileSync(join(unpacked, 'manifest.json'), 'utf8'))
  expect(manifest).toMatchObject({
    manifest_version: '0.3',
    server: { type: 'node', entry_point: 'server/index.cjs', mcp_config: { command: 'node', env: { PROSE_USER_DATA_DIR: userDataDir } } },
    compatibility: { runtimes: { node: '>=20.0.0' } }
  })
  const server = join(unpacked, 'server', 'index.cjs')
  expect(Buffer.compare(readFileSync(server), readFileSync(BUNDLED_SERVER))).toBe(0)

  // Claude Desktop substitutes ${__dirname} and runs `node` with the manifest's env.
  const args = (manifest.server.mcp_config.args as string[]).map((a) => a.replace('${__dirname}', unpacked))
  const client = new Client({ name: 'claude-ai', version: '0.0.0-e2e' })
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args,
      env: { ...(process.env as Record<string, string>), ...manifest.server.mcp_config.env },
      stderr: 'ignore'
    })
  )
  try {
    const listed = (await client.listTools()).tools.map((t) => t.name).sort()
    expect(listed).toEqual((manifest.tools as Array<{ name: string }>).map((t) => t.name).sort())
    const tabs = await client.callTool({ name: 'list_tabs', arguments: {} })
    expect(tabs.isError, JSON.stringify(tabs.content)).toBeFalsy()
    expect((tabs.structuredContent as { tabs: unknown[] }).tabs.length).toBeGreaterThan(0)
  } finally {
    await client.close()
  }
})

test('Settings → Integrations offers the extension first', async () => {
  await page.evaluate(() => (window as any).__prose_account.openSettings())
  await page.getByRole('tab', { name: 'Integrations' }).click()
  const panel = page.getByTestId('mcp-extension')
  await panel.getByRole('button', { name: 'Install Claude Desktop Extension' }).click()
  await expect(panel).toContainText('Claude Desktop opened its install dialog')
})
