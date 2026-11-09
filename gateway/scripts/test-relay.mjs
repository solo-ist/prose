/**
 * test-relay.mjs — integration suite for the MCP relay, gateway side (#1238).
 *
 * Self-contained, like test-share.mjs: spawns its own gateway on :4040 (dev
 * mode, so sign-in codes print to stdout), a stub Client ID Metadata Document
 * server on :4041 (CIMD_TEST_ORIGIN), and fake desktops (WebSocket clients on
 * /relay), then runs remote clients through the whole OAuth 2.1 flow and the
 * relay:
 *   discovery → DCR and CIMD → sign-in + consent + PKCE → token → /mcp
 *   forwarded to a fake desktop → scopes → cross-account isolation →
 *   "Prose is not running" → socket rules → revocation → payload caps →
 *   timeouts → refresh past the consent session → logs carry no content.
 *
 * Prereqs: Postgres (DATABASE_URL) with migrations applied.
 * Usage:   npm run test:relay
 */
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'
import WebSocket from 'ws'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 4040
const STUB_PORT = 4041
const BASE = `http://localhost:${PORT}`
const RESOURCE = `${BASE}/mcp`
const WS_BASE = `ws://localhost:${PORT}`
const RUN = Date.now().toString(36)
const EMAIL_A = `relay-a-${RUN}@example.invalid`
const EMAIL_B = `relay-b-${RUN}@example.invalid`
const DCR_REDIRECT = 'https://dcr-client.test/callback'
const CIMD_CLIENT_ID = `https://cimd.test/${RUN}/client.json`
const CIMD_REDIRECT = 'https://cimd.test/callback'
// Text standing in for a writer's document: it travels through tool
// arguments, a forwarded header, and a result, and must never be logged.
const MARKER = `PROSE-DOCUMENT-TEXT-${randomBytes(6).toString('hex')}`
const CLIENT_RATE_MAX = 25
const REGISTER_IP_MAX = 6

let passed = 0
let failed = 0
const ok = (label) => { console.log(`  ✓ ${label}`); passed++ }
const fail = (label, detail) => { console.error(`  ✗ ${label}${detail ? ': ' + detail : ''}`); failed++ }
const expect = (cond, label, detail) => (cond ? ok(label) : fail(label, detail))

// --- The stub CIMD metadata server -----------------------------------------
// CIMD_TEST_ORIGIN maps https://<host>/<path> to http://127.0.0.1:4041/<host>/<path>.
let cimdFetches = 0
const stub = createServer((req, res) => {
  if (req.url === `/cimd.test/${RUN}/client.json`) {
    cimdFetches++
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=3600' })
    res.end(JSON.stringify({
      client_id: CIMD_CLIENT_ID,
      client_name: 'Stub Assistant',
      client_uri: 'https://cimd.test',
      redirect_uris: [CIMD_REDIRECT],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }))
    return
  }
  res.writeHead(404)
  res.end()
})
await new Promise((resolve) => stub.listen(STUB_PORT, '127.0.0.1', resolve))

// --- The gateway -------------------------------------------------------------
let gatewayLog = ''
const gw = spawn('npx', ['tsx', 'src/index.ts'], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    GATEWAY_PORT: String(PORT),
    NODE_ENV: 'development',
    BETTER_AUTH_URL: BASE,
    UPSTREAM_URL: 'http://localhost:4001',
    CIMD_TEST_ORIGIN: `http://127.0.0.1:${STUB_PORT}`,
    RELAY_OAUTH_IP_MAX: '1000',
    RELAY_REGISTER_IP_MAX: String(REGISTER_IP_MAX),
    RELAY_CLIENT_RATE_MAX: String(CLIENT_RATE_MAX),
    RELAY_ACCOUNT_RATE_MAX: '1000',
    RELAY_CALL_TIMEOUT_S: '3',
    SIGN_IN_CODE_IP_MAX: '100',
    SIGN_IN_VERIFY_IP_MAX: '100',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
gw.stdout.on('data', (d) => { gatewayLog += d.toString() })
gw.stderr.on('data', (d) => { gatewayLog += d.toString() })
gw.on('exit', (code, signal) => { gatewayLog += `\n[gateway exited: code=${code} signal=${signal}]\n` })
const sockets = new Set()
const cleanup = () => {
  for (const s of sockets) { try { s.terminate() } catch { /* closed */ } }
  try { gw.kill('SIGTERM') } catch { /* already dead */ }
  try { stub.close() } catch { /* closed */ }
}
process.on('exit', cleanup)

const db = new pg.Client({ connectionString: process.env.DATABASE_URL })

async function waitFor(predicate, label, timeoutMs = 20000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const value = await predicate()
    if (value) return value
    await sleep(100)
  }
  throw new Error(`timeout waiting for ${label}`)
}

const cookieOf = (res) => (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
const b64url = (buf) => buf.toString('base64url')
/** How the OAuth provider stores a token: SHA-256, base64url without padding. */
const storedHash = (value) => createHash('sha256').update(value).digest('base64url')
function pkce() {
  const verifier = b64url(randomBytes(32))
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) }
}

// The sign-in page's two API calls, as its script makes them (a browser fetch).
async function pageSignIn(email, oauthQuery) {
  const from = gatewayLog.length
  const codeRes = await fetch(`${BASE}/api/sign-in/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ email }),
  })
  if (!codeRes.ok) throw new Error(`sign-in code for ${email}: ${codeRes.status}`)
  const escaped = email.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = await waitFor(
    async () => gatewayLog.slice(from).match(new RegExp(`Sign-in code for ${escaped}: (\\d{6})`)),
    `sign-in code for ${email}`
  )
  return fetch(`${BASE}/api/auth/sign-in/email-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE, 'Sec-Fetch-Mode': 'cors', Accept: '*/*' },
    body: JSON.stringify({ email, otp: m[1], ...(oauthQuery !== undefined ? { oauth_query: oauthQuery } : {}) }),
  })
}

/** A desktop-style sign-in (no OAuth request): the session cookie the app holds. */
async function desktopSession(email) {
  const res = await pageSignIn(email)
  return cookieOf(res)
}

async function register(name, redirect = DCR_REDIRECT, extra = {}) {
  return fetch(`${BASE}/api/auth/oauth2/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: name,
      redirect_uris: [redirect],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      ...extra,
    }),
  })
}

function authorizeUrl({ clientId, redirectUri, scope, challenge, method = 'S256', resource = RESOURCE, state = 'st-' + RUN }) {
  const u = new URL(`${BASE}/api/auth/oauth2/authorize`)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('client_id', clientId)
  u.searchParams.set('redirect_uri', redirectUri)
  if (scope) u.searchParams.set('scope', scope)
  u.searchParams.set('state', state)
  if (challenge) {
    u.searchParams.set('code_challenge', challenge)
    u.searchParams.set('code_challenge_method', method)
  }
  if (resource !== null) u.searchParams.set('resource', resource)
  return u.toString()
}

// A top-level browser navigation. Node's fetch always says sec-fetch-mode:
// cors, so the provider answers {redirect, url} as JSON where a browser gets
// a 302; both shapes come back here as { status, location }.
async function navigate(url, cookie = '') {
  const res = await fetch(url, { redirect: 'manual', headers: { Accept: 'text/html', ...(cookie ? { Cookie: cookie } : {}) } })
  let location = res.headers.get('location') ?? ''
  if (!location && (res.headers.get('content-type') ?? '').includes('json')) {
    const body = await res.json().catch(() => null)
    if (body?.redirect && typeof body.url === 'string') location = body.url
  }
  return { status: res.status, location, redirected: !!location }
}

const pathAndQuery = (location) => {
  const u = new URL(location, BASE)
  return { path: u.pathname, query: u.search.slice(1), url: u }
}

/**
 * The whole browser side of a connection: authorize → (sign in) → consent →
 * the client's redirect with a code. Returns the code, the browser's cookie,
 * and the consent page HTML.
 */
async function connect({ email, clientId, redirectUri, scope, cookie = '', expectConsent = true }) {
  const { verifier, challenge } = pkce()
  let { location } = await navigate(authorizeUrl({ clientId, redirectUri, scope, challenge }), cookie)
  let consentHtml = ''
  if (pathAndQuery(location).path === '/oauth/sign-in') {
    const { query } = pathAndQuery(location)
    const page = await fetch(`${BASE}/oauth/sign-in?${query}`)
    if (page.status !== 200) throw new Error(`sign-in page: ${page.status}`)
    const signed = await pageSignIn(email, query)
    cookie = cookieOf(signed)
    const body = await signed.json()
    if (!body?.url) throw new Error(`sign-in did not resume the authorization: ${JSON.stringify(body)}`)
    location = body.url
  }
  if (pathAndQuery(location).path === '/oauth/consent') {
    const { query } = pathAndQuery(location)
    const page = await fetch(`${BASE}/oauth/consent?${query}`, { headers: { Cookie: cookie } })
    consentHtml = await page.text()
    if (page.status !== 200) throw new Error(`consent page: ${page.status}`)
    const consent = await fetch(`${BASE}/api/auth/oauth2/consent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: BASE },
      body: JSON.stringify({ accept: true, oauth_query: query }),
    })
    const body = await consent.json()
    if (!body?.url) throw new Error(`consent did not answer a redirect: ${consent.status} ${JSON.stringify(body)}`)
    location = body.url
  } else if (expectConsent) {
    throw new Error(`expected the consent page, got ${location}`)
  }
  const back = new URL(location)
  return { code: back.searchParams.get('code'), state: back.searchParams.get('state'), error: back.searchParams.get('error'), verifier, cookie, consentHtml, location }
}

async function token(params) {
  const res = await fetch(`${BASE}/api/auth/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

let rpcId = 0
async function mcp(accessToken, method, params, { headers = {}, rawBody, base = BASE } = {}) {
  const id = ++rpcId
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-11-25',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    body: rawBody ?? JSON.stringify({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) }),
  })
  const text = await res.text()
  let body = null
  try { body = JSON.parse(text) } catch { /* not JSON */ }
  return { status: res.status, body, headers: res.headers, id }
}

/**
 * A fake desktop: connects to /relay with a session cookie and answers each
 * call with `handler(frame)` (an object {result} / {error}, a raw string, or
 * undefined to stay silent).
 */
function desktop(cookie, { device = b64url(randomBytes(16)), handler = defaultHandler, headers = {} } = {}) {
  const frames = []
  const ws = new WebSocket(`${WS_BASE}/relay?device=${device}`, { headers: { Cookie: cookie, ...headers } })
  sockets.add(ws)
  const state = { ws, frames, device, closed: null, opened: false, handler }
  ws.on('message', (data) => {
    const frame = JSON.parse(data.toString())
    frames.push(frame)
    if (frame.type !== 'call') return
    const answer = state.handler(frame)
    if (answer === undefined) return
    ws.send(typeof answer === 'string' ? answer : JSON.stringify({ type: 'result', id: frame.id, ...answer }))
  })
  ws.on('close', (code) => { state.closed = code })
  state.ready = new Promise((resolve) => {
    ws.on('open', () => { state.opened = true })
    ws.on('message', (data) => { if (JSON.parse(data.toString()).type === 'hello') resolve(true) })
    ws.on('close', () => resolve(false))
    ws.on('unexpected-response', (_req, res) => { state.rejected = res.statusCode; resolve(false) })
    ws.on('error', () => resolve(false))
  })
  state.calls = () => frames.filter((f) => f.type === 'call')
  return state
}

const ALL_TOOLS = [
  'list_tabs', 'read_document', 'get_outline', 'list_comments', 'list_suggestions', 'get_review_status',
  'list_review_events', 'suggest_edit', 'revise_suggestion', 'reply_to_suggestion', 'add_comment',
  'reply_to_comment', 'resolve_comment', 'reopen_comment', 'open_file', 'create_and_open_file', 'select_tab',
]
function defaultHandler(frame) {
  if (frame.method === 'tools/list') return { result: { tools: ALL_TOOLS.map((name) => ({ name, inputSchema: { type: 'object' } })) } }
  if (frame.method === 'tools/call') {
    return { result: { content: [{ type: 'text', text: `ran ${frame.params?.name}: ${MARKER}` }] } }
  }
  return { result: { ok: true, method: frame.method } }
}

async function main() {
  await waitFor(async () => {
    try { return (await fetch(`${BASE}/health`)).ok } catch { return false }
  }, 'gateway /health')
  ok('gateway boots')
  await db.connect()

  // --- Discovery ---------------------------------------------------------------
  const prmRes = await fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`)
  const prm = await prmRes.json()
  expect(prmRes.status === 200 && prm.resource === RESOURCE, 'PRM (RFC 9728) names the resource', JSON.stringify(prm))
  expect(
    Array.isArray(prm.authorization_servers) && prm.authorization_servers.length === 1 && prm.authorization_servers[0] === `${BASE}/api/auth`,
    'PRM names exactly one authorization server'
  )
  expect(['read', 'propose', 'comment'].every((s) => prm.scopes_supported?.includes(s)), 'PRM lists the relay scopes')
  expect((await (await fetch(`${BASE}/.well-known/oauth-protected-resource`)).json()).resource === RESOURCE, 'bare PRM path answers too')

  const asRes = await fetch(`${BASE}/.well-known/oauth-authorization-server/api/auth`)
  const as = await asRes.json()
  expect(asRes.status === 200 && as.issuer === `${BASE}/api/auth`, 'AS metadata (RFC 8414) at the path-inserted URL', JSON.stringify(as).slice(0, 200))
  expect(JSON.stringify(as.code_challenge_methods_supported) === '["S256"]', 'AS metadata: PKCE S256 only', JSON.stringify(as.code_challenge_methods_supported))
  expect(as.client_id_metadata_document_supported === true, 'AS metadata: CIMD supported')
  expect(as.registration_endpoint === `${BASE}/api/auth/oauth2/register`, 'AS metadata: DCR endpoint')
  expect(!as.grant_types_supported?.includes('client_credentials'), 'AS metadata: no client_credentials grant')
  expect((await fetch(`${BASE}/.well-known/oauth-authorization-server`)).status === 200, 'bare AS metadata path answers too')

  const anon = await mcp(null, 'tools/list')
  const challenge = anon.headers.get('www-authenticate') ?? ''
  expect(anon.status === 401, 'unauthenticated /mcp is 401', `status ${anon.status}`)
  expect(
    challenge.startsWith('Bearer ') && challenge.includes(`resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`),
    'the 401 carries WWW-Authenticate with resource_metadata',
    challenge
  )
  const garbage = await mcp('not-a-real-token', 'tools/list')
  expect(garbage.status === 401 && (garbage.headers.get('www-authenticate') ?? '').includes('invalid_token'), 'an unknown token is 401 invalid_token')
  expect((await fetch(`${BASE}/mcp`)).status === 405, 'GET /mcp is 405 (stateless, no stream)')

  // --- DCR -------------------------------------------------------------------------
  const regRes = await register('Remote Assistant A')
  const reg = await regRes.json()
  expect(regRes.status === 200 || regRes.status === 201, 'DCR registers a public client', `status ${regRes.status} ${JSON.stringify(reg).slice(0, 200)}`)
  const dcrClient = reg.client_id
  expect(typeof dcrClient === 'string' && dcrClient.length > 10 && !reg.client_secret, 'DCR answers a client_id and no secret for a public client')

  // --- Audience: the resource parameter is required, and only ours ---------------
  const { challenge: ch0 } = pkce()
  const noResource = await navigate(authorizeUrl({ clientId: dcrClient, redirectUri: DCR_REDIRECT, scope: 'read', challenge: ch0, resource: null }))
  expect(noResource.status === 400, 'authorize without a resource is refused', `status ${noResource.status}`)
  const wrongResource = await navigate(authorizeUrl({ clientId: dcrClient, redirectUri: DCR_REDIRECT, scope: 'read', challenge: ch0, resource: 'https://elsewhere.test/mcp' }))
  expect(wrongResource.status === 400, 'authorize for another resource is refused', `status ${wrongResource.status}`)

  // --- PKCE ---------------------------------------------------------------------
  const noPkce = await navigate(authorizeUrl({ clientId: dcrClient, redirectUri: DCR_REDIRECT, scope: 'read' }))
  const noPkceLoc = noPkce.location
  expect(noPkceLoc.startsWith(DCR_REDIRECT) && new URL(noPkceLoc).searchParams.get('error') === 'invalid_request', 'authorize without code_challenge is refused', noPkceLoc)
  const plain = await navigate(authorizeUrl({ clientId: dcrClient, redirectUri: DCR_REDIRECT, scope: 'read', challenge: 'x'.repeat(43), method: 'plain' }))
  const plainLoc = plain.location
  expect(plainLoc.startsWith(DCR_REDIRECT) && new URL(plainLoc).searchParams.get('error') === 'invalid_request', 'code_challenge_method=plain is refused', plainLoc)

  // --- Sign-in + consent + token (writer A, DCR client) -----------------------------
  const flowA = await connect({ email: EMAIL_A, clientId: dcrClient, redirectUri: DCR_REDIRECT, scope: 'read propose offline_access' })
  expect(!!flowA.code && flowA.state === 'st-' + RUN, 'sign-in page → consent → the client gets a code and its state back', flowA.location)
  expect(flowA.consentHtml.includes('Allow Remote Assistant A to use Prose?'), 'consent names the client')
  expect(flowA.consentHtml.includes('Not verified'), 'consent marks a DCR client as not verified')
  expect(flowA.consentHtml.includes(EMAIL_A), 'consent shows the signed-in account')
  expect(!flowA.consentHtml.includes('Add comments'), 'consent lists only the scopes asked for')

  const wrongVerifier = await token({ grant_type: 'authorization_code', code: flowA.code, redirect_uri: DCR_REDIRECT, client_id: dcrClient, code_verifier: pkce().verifier, resource: RESOURCE })
  expect(wrongVerifier.status === 400 && wrongVerifier.body?.error === 'invalid_grant', 'a wrong PKCE verifier is refused', JSON.stringify(wrongVerifier.body))
  // The failed exchange burned that code (codes are single-use); connect again.
  const flowA2 = await connect({ email: EMAIL_A, clientId: dcrClient, redirectUri: DCR_REDIRECT, scope: 'read propose offline_access', cookie: flowA.cookie, expectConsent: false })
  const tokA = await token({ grant_type: 'authorization_code', code: flowA2.code, redirect_uri: DCR_REDIRECT, client_id: dcrClient, code_verifier: flowA2.verifier, resource: RESOURCE })
  expect(tokA.status === 200 && typeof tokA.body?.access_token === 'string', 'code + verifier → an access token', JSON.stringify(tokA.body).slice(0, 200))
  expect(typeof tokA.body?.refresh_token === 'string', 'offline_access → a refresh token')
  expect(tokA.body?.expires_in === 3600, 'access tokens last 1 hour', String(tokA.body?.expires_in))
  const accessA = tokA.body.access_token
  const stored = await db.query('SELECT count(*)::int AS n FROM "oauthAccessToken" WHERE token = $1', [accessA])
  const storedHashed = await db.query('SELECT count(*)::int AS n FROM "oauthAccessToken" WHERE token = $1', [storedHash(accessA)])
  const storedRefresh = await db.query('SELECT count(*)::int AS n FROM "oauthRefreshToken" WHERE token = $1', [tokA.body.refresh_token])
  expect(stored.rows[0].n === 0 && storedHashed.rows[0].n === 1 && storedRefresh.rows[0].n === 0, 'tokens are stored hashed, never as issued')

  const refreshRow = await db.query('SELECT "expiresAt", "createdAt" FROM "oauthRefreshToken" WHERE "clientId" = $1 ORDER BY "createdAt" DESC LIMIT 1', [dcrClient])
  const days = (refreshRow.rows[0].expiresAt - refreshRow.rows[0].createdAt) / 86400000
  expect(Math.round(days) === 30, 'refresh tokens last 30 days', String(days))

  // --- "Prose is not running" ---------------------------------------------------------
  const notRunning = await mcp(accessA, 'tools/list')
  expect(notRunning.status === 200 && notRunning.body?.error?.code === -32001 && /Prose is not running/.test(notRunning.body?.error?.message), 'no desktop socket → "Prose is not running"', JSON.stringify(notRunning.body))
  expect(notRunning.body?.id === notRunning.id, 'the error answers the request id')

  // --- Socket rules -----------------------------------------------------------------
  const sessionA = await desktopSession(EMAIL_A)
  const sessionB = await desktopSession(EMAIL_B)
  const withOrigin = desktop(sessionA, { headers: { Origin: BASE } })
  await withOrigin.ready
  expect(withOrigin.rejected === 403, 'a /relay upgrade with an Origin (a browser page) is refused', String(withOrigin.rejected))
  const noSession = desktop('')
  await noSession.ready
  expect(noSession.rejected === 401, 'a /relay upgrade without a session is refused', String(noSession.rejected))
  const badDevice = desktop(sessionA, { device: 'short' })
  await badDevice.ready
  expect(badDevice.rejected === 400, 'a /relay upgrade without a valid device id is refused', String(badDevice.rejected))

  // --- Forwarding to the desktop -----------------------------------------------------
  const deskA = desktop(sessionA)
  expect(await deskA.ready, "writer A's desktop connects and gets hello")
  const deskB = desktop(sessionB)
  expect(await deskB.ready, "writer B's desktop connects")

  const list = await mcp(accessA, 'tools/list')
  const listed = (list.body?.result?.tools ?? []).map((t) => t.name)
  expect(list.status === 200 && list.body?.id === list.id && listed.includes('read_document'), 'tools/list is answered by the desktop', JSON.stringify(list.body).slice(0, 200))
  expect(listed.includes('suggest_edit') && !listed.includes('add_comment'), 'tools/list is filtered to the token scopes (read + propose)', listed.join(','))
  expect(!listed.includes('open_file') && !listed.includes('create_and_open_file') && !listed.includes('select_tab'), 'tools/list never offers filesystem or view-moving tools', listed.join(','))
  const listFrame = deskA.calls().at(-1)
  expect(listFrame?.method === 'tools/list' && typeof listFrame.id === 'string', 'the desktop got a call frame')
  expect(listFrame?.client?.id === dcrClient && listFrame?.client?.name === 'Remote Assistant A' && listFrame?.client?.verified === false, 'the frame names the client, unverified (DCR)', JSON.stringify(listFrame?.client))
  expect(JSON.stringify(listFrame?.scopes) === '["read","propose"]', 'the frame carries the token scopes', JSON.stringify(listFrame?.scopes))
  expect(listFrame?.headers?.['mcp-protocol-version'] === '2025-11-25', 'the frame carries the MCP protocol version header')

  const call = await mcp(accessA, 'tools/call', { name: 'read_document', arguments: { document: MARKER } }, { headers: { 'Mcp-Method': 'tools/call', 'Mcp-Name': 'read_document', 'Mcp-Param-Document': MARKER } })
  expect(call.status === 200 && call.body?.result?.content?.[0]?.text === `ran read_document: ${MARKER}`, 'tools/call is forwarded and the desktop answers', JSON.stringify(call.body).slice(0, 200))
  const callFrame = deskA.calls().at(-1)
  expect(callFrame?.params?.arguments?.document === MARKER, 'the call reaches the desktop with its arguments')
  expect(callFrame?.headers?.['mcp-name'] === 'read_document' && callFrame?.headers?.['mcp-param-document'] === MARKER, 'SEP-2243 standard headers are forwarded')
  expect(!('authorization' in (callFrame?.headers ?? {})) && !('cookie' in (callFrame?.headers ?? {})), 'credentials are never forwarded to the desktop')

  const before = deskA.calls().length
  const outOfScope = await mcp(accessA, 'tools/call', { name: 'add_comment', arguments: {} })
  expect(outOfScope.body?.error?.code === -32602, 'an out-of-scope tools/call is refused at the gateway', JSON.stringify(outOfScope.body))
  const fsTool = await mcp(accessA, 'tools/call', { name: 'open_file', arguments: { path: '/etc/passwd' } })
  expect(fsTool.body?.error?.code === -32602, 'a filesystem tool is refused at the gateway')
  const unknownTool = await mcp(accessA, 'tools/call', { name: 'accept_suggestion', arguments: {} })
  expect(unknownTool.body?.error?.code === -32602, 'accept / reject (and any unknown tool) are refused at the gateway')
  expect(deskA.calls().length === before, 'refused calls never reach the desktop')

  const note = await mcp(accessA, null, undefined, { rawBody: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })
  expect(note.status === 202 && deskA.calls().length === before, 'a notification is accepted (202) and not forwarded')
  const batch = await mcp(accessA, null, undefined, { rawBody: JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'ping' }]) })
  expect(batch.status === 400, 'a JSON-RPC batch is refused')

  // --- Cross-account isolation ---------------------------------------------------------
  expect(deskB.calls().length === 0, "writer B's desktop never saw writer A's calls")
  deskA.ws.close()
  await waitFor(async () => deskA.closed !== null, 'desktop A closed')
  await sleep(100)
  const isolated = await mcp(accessA, 'tools/call', { name: 'read_document', arguments: {} })
  expect(/Prose is not running/.test(isolated.body?.error?.message ?? ''), "with A's desktop gone, A's token gets \"not running\", never B's desktop", JSON.stringify(isolated.body))
  expect(deskB.calls().length === 0, "writer B's desktop still saw nothing")

  // --- Replacement and most-recently-active routing -------------------------------------
  const deviceId = b64url(randomBytes(16))
  const first = desktop(sessionA, { device: deviceId })
  await first.ready
  const second = desktop(sessionA, { device: deviceId })
  await second.ready
  await waitFor(async () => first.closed !== null, 'the replaced socket to close')
  expect(first.closed === 4000, 'a newer socket from the same device replaces the older (4000)', String(first.closed))
  await mcp(accessA, 'ping')
  expect(second.calls().length === 1 && first.calls().length === 0, 'calls go to the replacing socket')
  const other = desktop(sessionA)
  await other.ready
  await mcp(accessA, 'ping')
  expect(other.calls().length === 1 && second.calls().length === 1, 'calls go to the most recently connected desktop')
  second.ws.send(JSON.stringify({ type: 'active' }))
  await sleep(100)
  await mcp(accessA, 'ping')
  expect(second.calls().length === 2 && other.calls().length === 1, 'an {type:"active"} frame makes a desktop the most recently active')

  // A result from a socket the call wasn't sent to is ignored.
  second.handler = () => undefined // stay silent
  const spoofing = mcp(accessA, 'ping')
  await waitFor(async () => second.calls().length === 3, 'the silent call to arrive')
  other.ws.send(JSON.stringify({ type: 'result', id: second.calls().at(-1).id, result: { spoofed: true } }))
  const spoofed = await spoofing
  expect(spoofed.body?.error?.code === -32002, "another socket can't answer a call (it times out instead)", JSON.stringify(spoofed.body))
  expect(/didn't answer within 3 seconds/.test(spoofed.body?.error?.message ?? ''), 'a silent desktop times out with a clear error')
  second.handler = defaultHandler

  // --- Payload caps --------------------------------------------------------------------
  // On its own connection (another host name): the server answers 413
  // without reading the body and then closes that keep-alive connection.
  const big = await mcp(accessA, null, undefined, { base: `http://127.0.0.1:${PORT}`, rawBody: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_document', arguments: { pad: 'x'.repeat(1024 * 1024) } } }) })
  expect(big.status === 413, 'a request over 1 MiB is refused (413)', `status ${big.status}`)
  second.handler = (frame) => ({ result: { content: [{ type: 'text', text: 'y'.repeat(10 * 1024 * 1024 + 1024) }] }, id: frame.id })
  const tooBig = await mcp(accessA, 'tools/call', { name: 'read_document', arguments: {} })
  expect(tooBig.body?.error?.code === -32003, 'a result over 10 MiB fails the call', JSON.stringify(tooBig.body).slice(0, 200))
  second.handler = (frame) => ({ result: { content: [{ type: 'text', text: 'z'.repeat(11 * 1024 * 1024) }] }, id: frame.id })
  const wayTooBig = await mcp(accessA, 'tools/call', { name: 'read_document', arguments: {} })
  expect(wayTooBig.body?.error?.code === -32003, 'a frame over the socket cap fails the call', JSON.stringify(wayTooBig.body).slice(0, 200))
  await waitFor(async () => second.closed !== null, 'the oversized socket to close')
  expect(second.closed === 1009, 'and closes that socket (1009)', String(second.closed))

  // --- CIMD (verified client) -----------------------------------------------------------
  const deskA2 = desktop(sessionA)
  await deskA2.ready
  other.ws.close()
  const flowC = await connect({ email: EMAIL_A, clientId: CIMD_CLIENT_ID, redirectUri: CIMD_REDIRECT, scope: 'read comment offline_access', cookie: flowA.cookie })
  expect(cimdFetches >= 1, 'CIMD: the gateway fetched the client metadata document', String(cimdFetches))
  expect(flowC.consentHtml.includes('Allow Stub Assistant to use Prose?') && flowC.consentHtml.includes('Verified') && flowC.consentHtml.includes('cimd.test'), 'consent shows the CIMD client as verified by its domain')
  const tokC = await token({ grant_type: 'authorization_code', code: flowC.code, redirect_uri: CIMD_REDIRECT, client_id: CIMD_CLIENT_ID, code_verifier: flowC.verifier, resource: RESOURCE })
  expect(tokC.status === 200 && !!tokC.body?.access_token, 'CIMD client gets a token', JSON.stringify(tokC.body).slice(0, 200))
  const cimdCall = await mcp(tokC.body.access_token, 'tools/call', { name: 'add_comment', arguments: {} })
  const cimdFrame = deskA2.calls().at(-1)
  expect(cimdCall.body?.result && cimdFrame?.client?.verified === true && cimdFrame?.client?.name === 'Stub Assistant', 'the frame marks the CIMD client verified', JSON.stringify(cimdFrame?.client))
  expect(JSON.stringify(cimdFrame?.scopes) === '["read","comment"]', 'comment scope reaches comment tools', JSON.stringify(cimdFrame?.scopes))
  const cimdPropose = await mcp(tokC.body.access_token, 'tools/call', { name: 'suggest_edit', arguments: {} })
  expect(cimdPropose.body?.error?.code === -32602, 'comment scope does not reach propose tools')

  // --- Deny ----------------------------------------------------------------------------
  const regDeny = await (await register('Denied Assistant')).json()
  const { challenge: chD } = pkce()
  const denyStart = await navigate(authorizeUrl({ clientId: regDeny.client_id, redirectUri: DCR_REDIRECT, scope: 'read', challenge: chD }), flowA.cookie)
  const denyQuery = pathAndQuery(denyStart.location).query
  const denied = await (await fetch(`${BASE}/api/auth/oauth2/consent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: flowA.cookie, Origin: BASE },
    body: JSON.stringify({ accept: false, oauth_query: denyQuery }),
  })).json()
  expect(new URL(denied.url).searchParams.get('error') === 'access_denied', 'Deny sends the client back with access_denied', denied.url)
  const forgedConsent = await fetch(`${BASE}/oauth/consent?${denyQuery.replace(/sig=[^&]+/, 'sig=forged')}`, { headers: { Cookie: flowA.cookie } })
  expect(forgedConsent.status === 400, 'a consent page with a forged signature is refused')

  // --- Refresh: rotation, and outliving the consent session ----------------------------
  const rotated = await token({ grant_type: 'refresh_token', refresh_token: tokA.body.refresh_token, client_id: dcrClient, resource: RESOURCE })
  expect(rotated.status === 200 && rotated.body?.refresh_token && rotated.body.refresh_token !== tokA.body.refresh_token, 'refresh rotates the refresh token', JSON.stringify(rotated.body).slice(0, 200))
  expect((await mcp(rotated.body.access_token, 'ping')).body?.result, 'the refreshed access token works')
  // The writer's browser session from the consent expires (7 days in production).
  await db.query('UPDATE "session" SET "expiresAt" = now() - interval \'1 minute\' WHERE id = (SELECT "sessionId" FROM "oauthRefreshToken" WHERE "clientId" = $1 AND "sessionId" IS NOT NULL ORDER BY "createdAt" DESC LIMIT 1)', [dcrClient])
  const pastSession = await token({ grant_type: 'refresh_token', refresh_token: rotated.body.refresh_token, client_id: dcrClient, resource: RESOURCE })
  expect(pastSession.status === 200 && !!pastSession.body?.access_token, 'a refresh after the consent session expired still succeeds', JSON.stringify(pastSession.body).slice(0, 200))
  const pastCall = await mcp(pastSession.body?.access_token, 'ping')
  expect(!!pastCall.body?.result, 'and its access token still works (expired sessions are swept)', JSON.stringify(pastCall.body))

  // --- Audience at /mcp ----------------------------------------------------------------
  const tokenRows = await db.query('SELECT id FROM "oauthAccessToken" WHERE token = $1', [storedHash(pastSession.body.access_token)])
  await db.query('UPDATE "oauthAccessToken" SET resources = ARRAY[\'https://elsewhere.test/mcp\'] WHERE id = $1', [tokenRows.rows[0].id])
  const wrongAud = await mcp(pastSession.body.access_token, 'ping')
  expect(wrongAud.status === 401, 'a token bound to another audience is refused at /mcp', `status ${wrongAud.status}`)
  await db.query('UPDATE "oauthAccessToken" SET resources = ARRAY[$2] WHERE id = $1', [tokenRows.rows[0].id, RESOURCE])
  expect((await mcp(pastSession.body.access_token, 'ping')).status === 200, '(and accepted again once bound to this one)')

  // --- Revocation -----------------------------------------------------------------------
  const revokeAnon = await fetch(`${BASE}/api/relay/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: dcrClient }) })
  expect(revokeAnon.status === 401, 'revoke needs the desktop session')
  const revokeB = await fetch(`${BASE}/api/relay/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: sessionB }, body: JSON.stringify({ clientId: dcrClient }) })
  const revokedB = await revokeB.json()
  expect(revokedB.revoked?.accessTokens === 0 && (await mcp(pastSession.body.access_token, 'ping')).status === 200, "writer B can't revoke writer A's grants")
  const revokeA = await fetch(`${BASE}/api/relay/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: sessionA }, body: JSON.stringify({ clientId: dcrClient }) })
  const revokedA = await revokeA.json()
  expect(revokeA.status === 200 && revokedA.revoked?.accessTokens >= 1 && revokedA.revoked?.consents === 1, 'revoke marks the client tokens revoked and deletes the consent', JSON.stringify(revokedA))
  const afterRevoke = await mcp(pastSession.body.access_token, 'ping')
  expect(afterRevoke.status === 401, 'a revoked client fails at once', `status ${afterRevoke.status}`)
  const refreshAfterRevoke = await token({ grant_type: 'refresh_token', refresh_token: pastSession.body.refresh_token, client_id: dcrClient, resource: RESOURCE })
  expect(refreshAfterRevoke.status === 400, "a revoked client's refresh token can't be exchanged", JSON.stringify(refreshAfterRevoke.body))
  // (sessionA: flowA's browser session was expired above.)
  const reconsent = await navigate(authorizeUrl({ clientId: dcrClient, redirectUri: DCR_REDIRECT, scope: 'read', challenge: pkce().challenge }), sessionA)
  expect(pathAndQuery(reconsent.location).path === '/oauth/consent', 'reconnecting a revoked client asks for consent again')
  expect(!!(await mcp(tokC.body.access_token, 'ping')).body?.result, "revoking one client leaves the account's other clients working")

  // --- Rate limits -----------------------------------------------------------------------
  let limited = null
  for (let i = 0; i < CLIENT_RATE_MAX + 5; i++) {
    const r = await mcp(tokC.body.access_token, 'ping')
    if (r.status === 429) { limited = r; break }
  }
  expect(!!limited && !!limited.headers.get('retry-after'), 'per-client calls are rate-limited (429 + Retry-After)')
  let regLimited = false
  for (let i = 0; i < REGISTER_IP_MAX + 2; i++) {
    if ((await register(`Flood ${i}`)).status === 429) { regLimited = true; break }
  }
  expect(regLimited, 'DCR is rate-limited per IP')

  // --- Logs ---------------------------------------------------------------------------------
  expect(/\[relay\] call account=\S+ client=\S+ method=tools\/call tool=read_document ms=\d+ in=\d+B out=\d+B outcome=ok/.test(gatewayLog), 'relayed calls are logged as metadata')
  expect(!gatewayLog.includes(MARKER), 'no document text (arguments, headers, results) is ever logged')
  expect(!gatewayLog.includes(accessA) && !gatewayLog.includes(tokA.body.refresh_token), 'no token is ever logged')

  console.log(`\n${passed} passed, ${failed} failed`)
  await db.end()
  cleanup()
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (err) => {
  await sleep(1000)
  console.error('\nFATAL:', err.stack ?? err.message, err.cause ?? '')
  console.error('\n--- gateway log tail ---\n' + gatewayLog.slice(-3000))
  cleanup()
  process.exit(1)
})
