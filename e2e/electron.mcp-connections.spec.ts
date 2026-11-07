/**
 * MCP connections (#1236): a client's named, revocable token. A call made
 * with it over HTTP is attributed to the connection, the store holds only
 * the token's hash, and revoking the connection stops the token at once.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { launchApp, waitForAppReady, dismissOnboarding, dismissOverlay, waitForEditor, executeProseTool, seedSettings } from './helpers'

/* eslint-disable @typescript-eslint/no-explicit-any */

// Pinned for this launch so another Prose instance on the machine can't answer.
const MCP_PORT = process.env.PROSE_MCP_PORT ?? '9896'
const ENDPOINT = `http://127.0.0.1:${MCP_PORT}/mcp`
const LABEL = 'Codex on this Mac'

let app: ElectronApplication
let page: Page
let userDataDir: string
let docsDir: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  test.setTimeout(120_000)
  userDataDir = mkdtempSync(join(tmpdir(), 'prose-1236-'))
  docsDir = mkdtempSync(join(tmpdir(), 'prose-1236-docs-'))
  seedSettings(userDataDir, { defaultSaveDirectory: docsDir })
  const launched = await launchApp({ env: { PROSE_USER_DATA_DIR: userDataDir, PROSE_MCP_PORT: MCP_PORT } })
  app = launched.app
  page = launched.page
  await waitForAppReady(page)
  await dismissOnboarding(page).catch(() => {})
  await dismissOverlay(page).catch(() => {})
})

test.afterAll(async () => {
  await app?.close()
  rmSync(userDataDir, { recursive: true, force: true })
  rmSync(docsDir, { recursive: true, force: true })
})

async function connectWith(token: string): Promise<Client> {
  const client = new Client({ name: 'prose-e2e', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(ENDPOINT), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
  return client
}

function rawStatus(token: string): Promise<number> {
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
      Connection: 'close'
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
  }).then((r) => r.status)
}

test('a connection token attributes calls to the connection, and revoking it stops the token', async () => {
  const path = join(docsDir, 'connections.md')
  writeFileSync(path, '# Connections\n\nA sentence for the connection to comment on.\n')
  const opened = await executeProseTool(page, 'open_file', { path })
  expect(opened.success, JSON.stringify(opened)).toBe(true)
  await waitForEditor(page)

  // Create the connection the way Settings does: the token comes back once.
  const created = await page.evaluate((label) => (window as any).api.mcpCreateConnection(label), LABEL)
  expect(created.ok, JSON.stringify(created)).toBe(true)
  const { connection, token } = created.value as { connection: { id: string; label: string }; token: string }
  expect(connection.label).toBe(LABEL)
  expect(token).toMatch(/^prose_mcp_/)

  // The store holds the hash only, owner-readable.
  const storePath = join(userDataDir, 'mcp-connections.json')
  expect(readFileSync(storePath, 'utf8')).not.toContain(token)
  expect(statSync(storePath).mode & 0o777).toBe(0o600)

  // A client using the connection's token over HTTP.
  const client = await connectWith(token)
  try {
    const read = await client.callTool({ name: 'read_document', arguments: {} })
    const nodes = (read.structuredContent as { nodes: Array<{ id: string; content: string }> }).nodes
    const nodeId = nodes.find((n) => n.content.includes('A sentence'))!.id
    // An actor in the arguments is ignored: identity comes from the token.
    const added = await client.callTool({
      name: 'add_comment',
      arguments: { nodeId, comment: 'From the connection', actor: { kind: 'human', self: true } }
    })
    expect(added.isError, JSON.stringify(added.content)).toBeFalsy()

    const listed = await client.callTool({ name: 'list_comments', arguments: {} })
    const comment = (listed.structuredContent as { comments: Array<{ comment: string; by: string; byKind: string }> }).comments.find(
      (c) => c.comment === 'From the connection'
    )
    expect(comment).toMatchObject({ by: LABEL, byKind: 'mcp-agent' })
  } finally {
    await client.close()
  }

  // The stored record carries the connection.
  const documentId = await page.evaluate(() => (window as any).__prose_tools.getAnnotationDocId())
  await expect
    .poll(async () => {
      const rows = (await page.evaluate((id) => (window as any).__prose_tools.loadCommentsFromDB(id), documentId)) as any[]
      return rows.find((r) => r.comment === 'From the connection')?.actor
    })
    .toEqual({ kind: 'mcp-agent', connectionId: connection.id, connectionLabel: LABEL, via: 'http' })

  // Its last use is recorded.
  const listedConnections = await page.evaluate(() => (window as any).api.mcpListConnections())
  expect(listedConnections.value[0].lastUsedAt).toEqual(expect.any(Number))

  // Revoke: the same token is refused on the next request.
  expect(await rawStatus(token)).toBe(200)
  const revoked = await page.evaluate((id) => (window as any).api.mcpRevokeConnection(id), connection.id)
  expect(revoked.ok).toBe(true)
  expect(await rawStatus(token)).toBe(401)
  expect(readFileSync(storePath, 'utf8')).not.toContain(connection.id)
})

test('Settings → Integrations shows a new token once and lists the connection', async () => {
  await page.evaluate(() => (window as any).__prose_account.openSettings())
  await page.getByRole('tab', { name: 'Integrations' }).click()
  const panel = page.getByTestId('mcp-connections')
  await panel.getByTestId('mcp-connection-name').fill('Claude Code')
  await panel.getByTestId('mcp-connection-add').click()

  const token = (await panel.getByTestId('mcp-connection-token').textContent()) ?? ''
  expect(token).toMatch(/^prose_mcp_/)
  // The setup snippets carry the endpoint and the fresh token.
  await expect(panel.getByTestId('mcp-setup-claude-code')).toContainText(`--header "Authorization: Bearer ${token}"`)
  await expect(panel.getByTestId('mcp-setup-claude-code')).toContainText(`http://localhost:${MCP_PORT}/mcp`)
  await expect(panel.getByTestId('mcp-connection-row')).toHaveCount(1)
  await expect(panel.getByTestId('mcp-connection-row')).toContainText('Claude Code')
  await expect(panel.getByTestId('mcp-connection-row')).toContainText('Never used')

  // Done: the token is gone from the screen, and the snippet falls back to the placeholder.
  await panel.getByRole('button', { name: 'Done' }).click()
  await expect(panel.getByTestId('mcp-connection-token')).toHaveCount(0)
  await expect(panel.getByTestId('mcp-setup-claude-code')).not.toContainText(token)

  // The token works until revoked from the list.
  expect(await rawStatus(token)).toBe(200)
  await panel.getByRole('button', { name: 'Revoke Claude Code' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke' }).click()
  await expect(panel.getByTestId('mcp-connection-row')).toHaveCount(0)
  expect(await rawStatus(token)).toBe(401)
})
