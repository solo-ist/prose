/**
 * MCP end to end (#1235): the built app's HTTP endpoint and the built stdio
 * bridge, each at both protocol eras (2025-era `initialize` and 2026-07-28),
 * reaching the renderer's tool executors and answering with structured
 * results the SDK client validates against each tool's output schema.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { launchApp, waitForAppReady, dismissOnboarding, dismissOverlay, seedSettings } from './helpers'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BRIDGE = resolve(__dirname, '..', 'out', 'mcp-stdio.cjs')
const VERSION = (JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8')) as { version: string }).version
// Pinned for this launch so another Prose instance on the machine can't answer.
const MCP_PORT = process.env.PROSE_MCP_PORT ?? '9895'
const ERAS: Array<[string, string | undefined]> = [
  ['2025-era', undefined],
  ['2026-07-28', '2026-07-28']
]

let app: ElectronApplication
let userDataDir: string
let token: string

function newClient(pin: string | undefined): Client {
  return new Client({ name: 'prose-e2e', version: '1.0.0' }, pin ? { versionNegotiation: { mode: { pin } } } : {})
}

/** The tool names the app's own HTTP endpoint lists: the bridge must list the same. */
async function httpToolNames(): Promise<string[]> {
  const client = newClient(undefined)
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${MCP_PORT}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } }
    })
  )
  try {
    return (await client.listTools()).tools.map((t) => t.name).sort()
  } finally {
    await client.close()
  }
}

function stdioEnv(profile: string): Record<string, string> {
  return { ...(process.env as Record<string, string>), PROSE_USER_DATA_DIR: profile }
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  test.setTimeout(120_000)
  userDataDir = mkdtempSync(join(tmpdir(), 'prose-1235-'))
  seedSettings(userDataDir, { fileAssociation: { hasBeenPrompted: true } })
  const launched = await launchApp({ env: { PROSE_USER_DATA_DIR: userDataDir, PROSE_MCP_PORT: MCP_PORT } })
  app = launched.app
  await waitForAppReady(launched.page)
  await dismissOnboarding(launched.page).catch(() => {})
  await dismissOverlay(launched.page).catch(() => {})
  await expect.poll(() => existsSync(join(userDataDir, 'prose.sock')), { timeout: 15_000 }).toBe(true)
  token = readFileSync(join(userDataDir, 'mcp-auth-token'), 'utf8').trim()
})

test.afterAll(async () => {
  await app?.close()
  rmSync(userDataDir, { recursive: true, force: true })
})

for (const [label, pin] of ERAS) {
  test(`HTTP, ${label}: tools reach the renderer and answer with structured results`, async () => {
    const client = newClient(pin)
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${MCP_PORT}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } }
      })
    )
    try {
      expect(client.getServerVersion()).toMatchObject({ name: 'Prose', version: VERSION })
      expect(client.getInstructions()).toContain('The writer decides')

      const tabs = await client.callTool({ name: 'list_tabs', arguments: {} })
      expect(tabs.isError).toBeFalsy()
      const listed = tabs.structuredContent as { tabs: Array<{ tabId: string; isActive: boolean }> }
      expect(listed.tabs.length).toBeGreaterThan(0)
      expect(listed.tabs.some((t) => t.isActive)).toBe(true)

      const doc = await client.callTool({ name: 'read_document', arguments: {} })
      expect(doc.isError).toBeFalsy()
      expect(doc.structuredContent).toHaveProperty('markdown')
    } finally {
      await client.close()
    }
  })

  test(`stdio, ${label}: the bridge relays to the profile it was given`, async () => {
    const client = newClient(pin)
    await client.connect(
      new StdioClientTransport({ command: process.execPath, args: [BRIDGE], env: stdioEnv(userDataDir), stderr: 'ignore' })
    )
    try {
      expect(client.getServerVersion()).toMatchObject({ name: 'Prose', version: VERSION })
      const { tools } = await client.listTools()
      expect(tools.map((t) => t.name).sort()).toEqual(await httpToolNames())
      expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['read_document', 'list_review_events']))

      const tabs = await client.callTool({ name: 'list_tabs', arguments: {} })
      expect(tabs.isError).toBeFalsy()
      expect((tabs.structuredContent as { tabs: unknown[] }).tabs.length).toBeGreaterThan(0)
    } finally {
      await client.close()
    }
  })
}

test('stdio: with no app on its profile, tools still list and calls fail plainly', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'prose-1235-empty-'))
  const client = newClient(undefined)
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [BRIDGE], env: stdioEnv(empty), stderr: 'ignore' }))
  try {
    expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual(await httpToolNames())
    const result = await client.callTool({ name: 'list_tabs', arguments: {} })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('Prose is not running')
  } finally {
    await client.close()
    rmSync(empty, { recursive: true, force: true })
  }
})
