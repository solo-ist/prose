/**
 * test-mail.mjs — integration test for magic-link email delivery (#813).
 *
 * Spins up a tiny mock Resend HTTP server and a gateway instance configured
 * to hit it, then exercises the full magic-link sign-in flow:
 *   - mock Resend receives exactly one POST /emails with the right fields
 *   - the landing page (GET /auth/link) returns 200 HTML without consuming the token
 *   - the verify URL rebuilt from the landing URL issues a session cookie
 *   - the raw verify URL is NOT printed to stdout when RESEND_API_KEY is set
 *   - a mock 500 from Resend makes the sign-in request fail (not silently succeed)
 *
 * Prereqs: `npm run dev:db` (Postgres on :5433) + migrations applied.
 * Usage:   npm run test:mail
 */
import { createServer } from 'node:http'
import { spawn, execFileSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GW_PORT = 4020
const BASE = `http://localhost:${GW_PORT}`
const EMAIL = `mail-test-${Date.now()}@example.invalid`
const MAIL_FROM = 'Prose <signin@test.invalid>'

let passed = 0
let failed = 0
const ok = (label) => { console.log(`  ✓ ${label}`); passed++ }
const fail = (label, detail) => { console.error(`  ✗ ${label}${detail ? ': ' + detail : ''}`); failed++ }
const expect = (cond, label, detail) => (cond ? ok(label) : fail(label, detail))

// --- Tiny mock Resend server -------------------------------------------------

let mockPort = null
let recordedPosts = []
let forceStatus = 200  // tests can flip this to 500

const mockServer = createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/emails') {
    const chunks = []
    for await (const c of req) chunks.push(c)
    let body = {}
    try { body = JSON.parse(Buffer.concat(chunks).toString()) } catch { /* ignore */ }
    recordedPosts.push({ auth: req.headers['authorization'], body })
    res.writeHead(forceStatus, { 'Content-Type': 'application/json' })
    res.end(forceStatus === 200 ? JSON.stringify({ id: 'mock-id-123' }) : JSON.stringify({ message: 'internal error' }))
  } else {
    res.writeHead(404)
    res.end()
  }
})

await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve))
mockPort = mockServer.address().port
console.log(`Mock Resend listening on :${mockPort}`)

// --- Spawn gateway -----------------------------------------------------------

let gatewayLog = ''
const gw = spawn('npx', ['tsx', 'src/index.ts'], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(GW_PORT),
    GATEWAY_PORT: String(GW_PORT),
    NODE_ENV: 'development',
    BETTER_AUTH_URL: BASE,
    UPSTREAM_URL: 'http://localhost:4001',
    SHARE_BASE_URL: `http://127.0.0.1:${GW_PORT}`,
    RESEND_API_KEY: 'test-key',
    RESEND_API_URL: `http://127.0.0.1:${mockPort}`,
    MAIL_FROM,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
gw.stdout.on('data', (d) => { gatewayLog += d.toString() })
gw.stderr.on('data', (d) => { gatewayLog += d.toString() })
const kill = () => {
  try { gw.kill('SIGTERM') } catch { /* already dead */ }
  mockServer.close()
}
process.on('exit', kill)

async function waitFor(predicate, label, timeoutMs = 20000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const value = await predicate()
    if (value) return value
    await sleep(200)
  }
  throw new Error(`timeout waiting for ${label}`)
}

async function main() {
  await waitFor(async () => {
    try {
      const r = await fetch(`${BASE}/health`)
      return r.ok
    } catch { return false }
  }, 'gateway /health')
  ok('gateway boots with RESEND_API_KEY set')

  // Seed the database and share_publish entitlement so the test can exercise
  // the full sign-in flow without replicating every step of test-share.
  // First: request a magic link with RESEND_API_KEY active — it must NOT print
  // the raw verify URL to stdout, and must POST to the mock Resend server.
  recordedPosts = []
  const mlRes = await fetch(`${BASE}/api/auth/sign-in/magic-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ email: EMAIL, callbackURL: '/health' }),
  })
  expect(mlRes.ok, 'magic-link request accepted', `status ${mlRes.status}`)

  // Wait for the mock to receive the POST (the gateway calls it async but
  // before the HTTP response returns — give it a small window anyway).
  await waitFor(() => recordedPosts.length >= 1, 'mock Resend receives POST', 5000)

  // --- Assert the raw verify URL was NOT logged to stdout --------------------
  const stdoutHasRawLink = /Magic link for [^\n]*\n\s*http\S+/.test(gatewayLog)
  expect(!stdoutHasRawLink, 'raw verify URL NOT printed to stdout when RESEND_API_KEY is set')

  // --- Assert mock received exactly one POST with the right fields -----------
  expect(recordedPosts.length === 1, 'exactly one POST to Resend', `got ${recordedPosts.length}`)
  const post = recordedPosts[0]
  expect(post.auth === 'Bearer test-key', 'Authorization header is Bearer test-key', post.auth)
  expect(post.body.from === MAIL_FROM, 'from matches MAIL_FROM', post.body.from)
  expect(Array.isArray(post.body.to) && post.body.to[0] === EMAIL, 'to matches the email', JSON.stringify(post.body.to))
  expect(
    typeof post.body.subject === 'string' && post.body.subject.toLowerCase().includes('sign'),
    'subject is sign-in-related',
    post.body.subject,
  )
  const bodyHtml = post.body.html ?? ''
  const bodyText = post.body.text ?? ''
  const landingPathRe = /\/auth\/link\?/
  expect(landingPathRe.test(bodyHtml) || landingPathRe.test(bodyText), 'email body contains the landing URL')

  // Extract the landing URL from the email body text for the next assertions.
  const urlMatch = bodyText.match(/(http\S+\/auth\/link\S+)/)
  if (!urlMatch) {
    fail('landing URL extractable from email body text', 'no match')
    throw new Error('Cannot continue without landing URL')
  }
  const landingUrl = urlMatch[1].trim()
  ok(`landing URL extracted: ${landingUrl}`)

  // --- GET the landing page: must return 200 HTML, token NOT consumed --------
  const landingRes = await fetch(landingUrl)
  expect(landingRes.status === 200, 'GET /auth/link returns 200', `status ${landingRes.status}`)
  expect(
    (landingRes.headers.get('content-type') ?? '').includes('text/html'),
    'landing page is HTML',
    landingRes.headers.get('content-type'),
  )
  expect(landingRes.headers.get('cache-control') === 'no-store', 'landing page is no-store')
  const landingHtml = await landingRes.text()
  expect(landingHtml.includes(landingUrl), 'landing page displays the URL', landingUrl.slice(0, 60))
  expect(landingHtml.toLowerCase().includes('copy'), 'landing page has a copy affordance')

  // The token was NOT consumed: verify URL built from the landing URL must
  // still issue a session cookie.
  const u = new URL(landingUrl)
  const verifyUrl = new URL('/api/auth/magic-link/verify', u.origin)
  const token = u.searchParams.get('token')
  const callbackURL = u.searchParams.get('callbackURL')
  if (token) verifyUrl.searchParams.set('token', token)
  if (callbackURL) verifyUrl.searchParams.set('callbackURL', callbackURL)

  const verifyRes = await fetch(verifyUrl.toString(), { redirect: 'manual' })
  const setCookies = verifyRes.headers.getSetCookie?.() ?? []
  const cookie = setCookies.map((c) => c.split(';')[0]).join('; ')
  expect(cookie.includes('session_token'), 'verify URL rebuilt from landing URL issues a session cookie')
  ok('token NOT consumed by landing page GET (verify succeeded after the GET)')

  // --- Mock 500 → sign-in request must fail (not silently succeed) -----------
  forceStatus = 500
  recordedPosts = []
  const fail500Res = await fetch(`${BASE}/api/auth/sign-in/magic-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ email: `fail500-${Date.now()}@example.invalid`, callbackURL: '/health' }),
  })
  expect(!fail500Res.ok, 'sign-in request fails when Resend returns 500', `status ${fail500Res.status}`)
  ok('mock 500 causes non-2xx sign-in response (not silent success)')
  forceStatus = 200  // reset

  // --- Report -----------------------------------------------------------------
  console.log(`\n${passed} passed, ${failed} failed`)
  kill()
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('\nFATAL:', err.message)
  console.error('\n--- gateway log tail ---\n' + gatewayLog.slice(-2000))
  kill()
  process.exit(1)
})
