/**
 * The remote MCP relay, end to end (#1239, on M5a #1238): the real app, a
 * real local gateway (spawned from gateway/, against Postgres), and a remote
 * client that gets its OAuth token from that gateway the way ChatGPT or
 * claude.ai would (DCR, sign-in, consent, PKCE), then talks MCP to
 * <gateway>/mcp. Covers the second gate in the app: an unapproved client is
 * refused; approved for reading, it reads but can't comment although its
 * token could; given comment, its records carry `via: 'relay'` and the
 * connection's label; the kill switch makes it "Prose is not running"; and
 * removing the connection revokes it at the gateway.
 *
 * Needs PROSE_E2E_GATEWAY_DATABASE_URL (a Postgres with the gateway's
 * migrations applied) and gateway/ installed; skipped without them. CI's
 * e2e job provides both.
 */

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { launchApp, waitForAppReady, dismissOnboarding, dismissOverlay, waitForEditor, executeProseTool, seedSettings } from './helpers'

/* eslint-disable @typescript-eslint/no-explicit-any */

const DATABASE_URL = process.env.PROSE_E2E_GATEWAY_DATABASE_URL ?? ''
const GATEWAY_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../gateway')
const GW_PORT = Number(process.env.PROSE_E2E_GATEWAY_PORT ?? 4060)
const GW = `http://127.0.0.1:${GW_PORT}`
const MCP_URL = `${GW}/mcp`
const RUN = Date.now().toString(36)
const EMAIL = `relay-e2e-${RUN}@example.invalid`
const CLIENT_NAME = 'Relay E2E Assistant'
const REDIRECT = 'https://relay-e2e.test/callback'

test.skip(!DATABASE_URL || !existsSync(join(GATEWAY_DIR, 'node_modules')), 'needs PROSE_E2E_GATEWAY_DATABASE_URL and gateway/ installed')
test.describe.configure({ mode: 'serial' })

let gateway: ChildProcess | null = null
let gatewayLog = ''
let app: ElectronApplication
let page: Page
let userDataDir: string
let docsDir: string
let clientId = ''
let accessToken = ''

async function until<T>(probe: () => Promise<T | null | undefined | false>, label: string, timeoutMs = 30_000): Promise<T> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const value = await probe()
    if (value) return value
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`timed out waiting for ${label}`)
}

/** The 6-digit code the dev gateway logs for `email`, after `from` in its log. */
function codeFor(email: string, from: number): Promise<string> {
  const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return until(async () => gatewayLog.slice(from).match(new RegExp(`Sign-in code for ${escaped}: (\\d{6})`))?.[1], `a sign-in code for ${email}`)
}

const cookieOf = (res: Response) => (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')

/** The remote client's whole OAuth journey: register, authorize, sign in, consent, exchange. */
async function remoteClientToken(scope: string): Promise<{ clientId: string; accessToken: string }> {
  const registered = await (
    await fetch(`${GW}/api/auth/oauth2/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: CLIENT_NAME,
        redirect_uris: [REDIRECT],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code']
      })
    })
  ).json()
  const verifier = randomBytes(32).toString('base64url')
  const authorize = new URL(`${GW}/api/auth/oauth2/authorize`)
  for (const [k, v] of Object.entries({
    response_type: 'code',
    client_id: registered.client_id,
    redirect_uri: REDIRECT,
    scope,
    state: 'e2e',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    resource: MCP_URL
  })) {
    authorize.searchParams.set(k, v)
  }
  // Node's fetch is a CORS-mode fetch to the provider, which answers {redirect, url}.
  const toSignIn = (await (await fetch(authorize, { headers: { Accept: 'text/html' } })).json()).url as string
  const oauthQuery = new URL(toSignIn, GW).search.slice(1)
  const from = gatewayLog.length
  await fetch(`${GW}/api/sign-in/code`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: GW }, body: JSON.stringify({ email: EMAIL }) })
  const signedIn = await fetch(`${GW}/api/auth/sign-in/email-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: GW },
    body: JSON.stringify({ email: EMAIL, otp: await codeFor(EMAIL, from), oauth_query: oauthQuery })
  })
  const browserCookie = cookieOf(signedIn)
  const toConsent = (await signedIn.json()).url as string
  const consent = await (
    await fetch(`${GW}/api/auth/oauth2/consent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: browserCookie, Origin: GW },
      body: JSON.stringify({ accept: true, oauth_query: new URL(toConsent, GW).search.slice(1) })
    })
  ).json()
  const code = new URL(consent.url).searchParams.get('code')!
  const token = await (
    await fetch(`${GW}/api/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: registered.client_id, code_verifier: verifier, resource: MCP_URL })
    })
  ).json()
  if (!token.access_token) throw new Error(`no token: ${JSON.stringify(token)}`)
  return { clientId: registered.client_id, accessToken: token.access_token }
}

/** One raw JSON-RPC request to the gateway's /mcp, as the remote client. */
async function rawCall(method: string, params: Record<string, unknown>): Promise<{ status: number; body: any }> {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-11-25',
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

async function mcpClient(): Promise<Client> {
  const client = new Client({ name: 'relay-e2e', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL), { requestInit: { headers: { Authorization: `Bearer ${accessToken}` } } }))
  return client
}

async function openIntegrations(): Promise<void> {
  await page.evaluate(() => (window as any).__prose_account.openSettings())
  await page.getByRole('tab', { name: 'Integrations' }).click()
}

test.beforeAll(async () => {
  test.setTimeout(180_000)
  gateway = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: GATEWAY_DIR,
    env: {
      ...process.env,
      PORT: String(GW_PORT),
      GATEWAY_PORT: String(GW_PORT),
      NODE_ENV: 'development',
      BETTER_AUTH_URL: GW,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? 'e2e-only-secret-not-for-production-0123456789',
      DATABASE_URL,
      UPSTREAM_URL: 'http://127.0.0.1:4001',
      RESEND_API_KEY: '',
      SIGN_IN_CODE_IP_MAX: '100',
      SIGN_IN_VERIFY_IP_MAX: '100',
      RELAY_CALL_TIMEOUT_S: '30'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  gateway.stdout?.on('data', (d) => (gatewayLog += d.toString()))
  gateway.stderr?.on('data', (d) => (gatewayLog += d.toString()))
  await until(async () => (await fetch(`${GW}/health`).catch(() => null))?.ok, 'the local gateway', 60_000)

  userDataDir = mkdtempSync(join(tmpdir(), 'prose-1239-'))
  docsDir = mkdtempSync(join(tmpdir(), 'prose-1239-docs-'))
  seedSettings(userDataDir, { defaultSaveDirectory: docsDir, webPlatform: { gatewayUrl: GW } })
  const launched = await launchApp({
    env: { PROSE_USER_DATA_DIR: userDataDir, PROSE_MCP_PORT: process.env.PROSE_MCP_PORT ?? '9899' },
    // Linux CI has no keyring: without it safeStorage can't hold the session.
    args: process.platform === 'linux' ? ['--password-store=basic'] : []
  })
  app = launched.app
  page = launched.page
  // The switch only selects the basic_text backend; isEncryptionAvailable()
  // stays false on Linux until the app opts into the in-memory key (as in
  // electron.settings-account.spec.ts). A no-op on macOS and Windows.
  await app.evaluate(({ safeStorage }) => safeStorage.setUsePlainTextEncryption(true))
  await waitForAppReady(page)
  await dismissOnboarding(page).catch(() => {})
  await dismissOverlay(page).catch(() => {})

  // The desktop signs in to the gateway the way Settings → Account does.
  const from = gatewayLog.length
  const requested = await page.evaluate((email) => (window as any).api.shareRequestSignIn(email), EMAIL)
  expect(requested.ok, JSON.stringify(requested)).toBe(true)
  const completed = await page.evaluate((code) => (window as any).api.shareCompleteSignIn(code), await codeFor(EMAIL, from))
  expect(completed.ok, JSON.stringify(completed)).toBe(true)

  // The remote client's token, consented at the gateway for reading and commenting.
  ;({ clientId, accessToken } = await remoteClientToken('read comment offline_access'))

  const path = join(docsDir, 'relay.md')
  writeFileSync(path, '# Relay\n\nA sentence the remote assistant can read.\n')
  const opened = await executeProseTool(page, 'open_file', { path })
  expect(opened.success, JSON.stringify(opened)).toBe(true)
  await waitForEditor(page)
})

test.afterAll(async () => {
  await app?.close()
  gateway?.kill('SIGTERM')
  if (userDataDir) rmSync(userDataDir, { recursive: true, force: true })
  if (docsDir) rmSync(docsDir, { recursive: true, force: true })
})

test('Remote access is off by default, and the gateway says Prose is not running', async () => {
  const status = await page.evaluate(() => (window as any).api.mcpRemoteStatus())
  expect(status).toMatchObject({ available: true, enabled: false, signedIn: true, state: 'off', connectorUrl: MCP_URL })
  const call = await rawCall('tools/call', { name: 'read_document', arguments: {} })
  expect(call.body?.error?.message).toMatch(/Prose is not running/)
})

test('turned on, an unapproved client is refused and waits for approval in Settings', async () => {
  await openIntegrations()
  const panel = page.getByTestId('remote-access')
  await panel.getByTestId('remote-access-switch').click()
  await expect(panel.getByTestId('remote-access-status')).toHaveAttribute('data-state', 'connected')
  await expect(panel.getByTestId('remote-connector-url')).toHaveText(MCP_URL)

  const refused = await rawCall('tools/call', { name: 'read_document', arguments: {} })
  expect(refused.body?.error?.message).toBe(`Approve ${CLIENT_NAME} in Prose → Settings → Integrations → Connections, then try again.`)

  const row = panel.locator('[data-testid="remote-connection-row"][data-status="pending"]')
  await expect(row).toContainText(`${CLIENT_NAME} wants to use Prose`)
  await expect(row).toContainText('Unverified')
})

test('approved to read, it reads the open document but cannot comment, though its token could', async () => {
  const panel = page.getByTestId('remote-access')
  await panel.getByRole('button', { name: `Approve ${CLIENT_NAME}` }).click()
  await expect(panel.locator('[data-testid="remote-connection-row"][data-status="approved"]')).toContainText(CLIENT_NAME)

  const client = await mcpClient()
  try {
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain('read_document')
    expect(names).not.toContain('add_comment')
    expect(names).not.toContain('open_file')

    const read = await client.callTool({ name: 'read_document', arguments: {} })
    expect(read.isError, JSON.stringify(read.content)).toBeFalsy()
    expect(JSON.stringify(read.structuredContent)).toContain('A sentence the remote assistant can read.')

    // The gateway passes add_comment (the token has comment); the desktop refuses it.
    const comment = await client.callTool({ name: 'add_comment', arguments: { nodeId: 'x', comment: 'Not allowed' } })
    expect(comment.isError).toBe(true)
    expect(JSON.stringify(comment.content)).toContain('not available to this connection')
  } finally {
    await client.close()
  }
})

test('given comment, its records carry via relay and the connection’s label', async () => {
  const LABEL = 'Assistant on the web'
  const renamed = await page.evaluate(({ id, label }) => (window as any).api.mcpRemoteUpdate(id, { label }), { id: clientId, label: LABEL })
  expect(renamed.ok, JSON.stringify(renamed)).toBe(true)
  const panel = page.getByTestId('remote-access')
  await panel.getByRole('checkbox', { name: `${LABEL}: comment` }).click()
  await expect.poll(async () => (await page.evaluate(() => (window as any).api.mcpRemoteList())).value[0].scopes).toEqual(['read', 'comment'])

  const client = await mcpClient()
  try {
    const read = await client.callTool({ name: 'read_document', arguments: {} })
    const nodes = (read.structuredContent as { nodes: Array<{ id: string; content: string }> }).nodes
    const nodeId = nodes.find((n) => n.content.includes('A sentence'))!.id
    const added = await client.callTool({ name: 'add_comment', arguments: { nodeId, comment: 'From the relay' } })
    expect(added.isError, JSON.stringify(added.content)).toBeFalsy()
    const listed = await client.callTool({ name: 'list_comments', arguments: {} })
    const comment = (listed.structuredContent as { comments: Array<{ comment: string; by: string; byKind: string }> }).comments.find(
      (c) => c.comment === 'From the relay'
    )
    // The writer's label first, the client's registered name beside it.
    expect(comment).toMatchObject({ by: `${LABEL} · ${CLIENT_NAME}`, byKind: 'mcp-agent' })
  } finally {
    await client.close()
  }

  const documentId = await page.evaluate(() => (window as any).__prose_tools.getAnnotationDocId())
  await expect
    .poll(async () => {
      const rows = (await page.evaluate((id) => (window as any).__prose_tools.loadCommentsFromDB(id), documentId)) as any[]
      return rows.find((r) => r.comment === 'From the relay')?.actor
    })
    .toEqual({ kind: 'mcp-agent', connectionId: `remote:${clientId}`, connectionLabel: LABEL, client: CLIENT_NAME, via: 'relay' })
})

test('the kill switch: off, the client gets "Prose is not running" at once', async () => {
  const panel = page.getByTestId('remote-access')
  await panel.getByTestId('remote-access-switch').click()
  await expect(panel.getByTestId('remote-access-status')).toHaveAttribute('data-state', 'off')
  await expect.poll(async () => (await rawCall('tools/call', { name: 'read_document', arguments: {} })).body?.error?.message ?? '').toMatch(
    /Prose is not running/
  )
})

test('removing the connection revokes the client at the gateway', async () => {
  const panel = page.getByTestId('remote-access')
  await panel.getByTestId('remote-access-switch').click()
  await expect(panel.getByTestId('remote-access-status')).toHaveAttribute('data-state', 'connected')
  expect((await rawCall('ping', {})).status).toBe(200)

  await panel.getByRole('button', { name: 'Remove Assistant on the web' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click()
  // The row goes as soon as the app refuses the client; the gateway's revoke follows.
  await expect(panel.getByTestId('remote-connection-row')).toHaveCount(0)
  await expect.poll(async () => (await rawCall('ping', {})).status, { timeout: 10_000 }).toBe(401)
})
