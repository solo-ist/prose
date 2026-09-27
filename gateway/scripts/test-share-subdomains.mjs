/**
 * test-share-subdomains.mjs — integration test for per-publication subdomain
 * isolation (#917). Self-contained: spawns its own gateway on :4030 with
 * SHARE_SUBDOMAINS=1 and SHARE_BASE_URL=http://share.localhost:4030, then
 * asserts the routing table:
 *
 *   - publish returns a label URL (<label>.share.localhost:4030/s/<token>)
 *   - GET /s/:token with the correct label Host → 200 + artifact headers
 *   - GET /s/:token on the bare share host → 308 to the label URL
 *   - GET /s/:token on the API host → 308 to the label URL
 *   - GET /s/:token on a WRONG label host → 308 to the correct label URL
 *   - JSON comment routes work on the label host AND the bare share host
 *   - republish returns shareOrigin in the label form (token never echoed)
 *   - revoke → 410 on the label host (no redirect)
 *
 * Node's fetch doesn't resolve *.localhost, and you can't override the Host
 * header with it — so host-specific assertions use node:http request() to
 * 127.0.0.1 with an explicit Host header.
 *
 * Prereqs: `npm run dev:db` (Postgres on :5433) + a fresh DB (or the
 * throwaway DB from the CI recipe).
 * Usage:   npm run test:share:subdomains
 */
import { spawn, execFileSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createServer } from 'node:http'
import http from 'node:http'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 4030
const API_HOST = `localhost:${PORT}`
const SHARE_HOST = `share.localhost:${PORT}`
const API_BASE = `http://${API_HOST}`

let passed = 0
let failed = 0
const ok = (label) => { console.log(`  ✓ ${label}`); passed++ }
const fail = (label, detail) => { console.error(`  ✗ ${label}${detail ? ': ' + detail : ''}`); failed++ }
const expect = (cond, label, detail) => (cond ? ok(label) : fail(label, detail))

const EMAIL = `subdomain-test-${Date.now()}@example.invalid`

/** Minimal valid Prose share artifact. */
const artifact = (body) => `<!DOCTYPE html>
<html><head><title>t</title></head><body><article><p>${body}</p></article>
<script type="application/x-prose-markdown" data-encoding="base64">dGVzdA==</script>
<script type="application/x-prose-share" data-version="1">{"shareEndpoint":"${API_BASE}","publishRev":"0123456789abcdef","publishedAt":"2026-08-31T00:00:00.000Z"}</script>
</body></html>`

// ---------------------------------------------------------------------------
// Low-level HTTP helper: sends a request to 127.0.0.1:<PORT> with an
// explicit Host header so we can test host-based routing without DNS.
// ---------------------------------------------------------------------------
function rawRequest(opts) {
  return new Promise((resolve, reject) => {
    const { host, method = 'GET', path, body, headers = {} } = opts
    const bodyBuf = body ? Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) : null
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: PORT,
        method,
        path,
        headers: {
          Host: host,
          ...(bodyBuf ? { 'Content-Type': 'application/json', 'Content-Length': bodyBuf.length } : {}),
          ...headers,
        },
      },
      (res) => {
        let data = ''
        res.on('data', (c) => { data += c })
        res.on('end', () => {
          let json = null
          try { json = JSON.parse(data) } catch { /* not JSON */ }
          resolve({ status: res.statusCode, headers: res.headers, body: data, json })
        })
      }
    )
    req.on('error', reject)
    if (bodyBuf) req.write(bodyBuf)
    req.end()
  })
}

// ---------------------------------------------------------------------------
// Gateway spawn
// ---------------------------------------------------------------------------
let gatewayLog = ''
const gw = spawn('npx', ['tsx', 'src/index.ts'], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    GATEWAY_PORT: String(PORT),
    NODE_ENV: 'development',
    BETTER_AUTH_URL: API_BASE,
    UPSTREAM_URL: 'http://localhost:4001',
    SHARE_PUBLIC_WRITE_MAX: '30',
    SHARE_BASE_URL: `http://${SHARE_HOST}`,
    SHARE_SUBDOMAINS: '1',
    AUTH_MAGIC_LINK_STDOUT: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
gw.stdout.on('data', (d) => { gatewayLog += d.toString() })
gw.stderr.on('data', (d) => { gatewayLog += d.toString() })
const kill = () => { try { gw.kill('SIGTERM') } catch { /* already dead */ } }
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  await waitFor(async () => {
    try {
      const r = await rawRequest({ host: API_HOST, path: '/health' })
      return r.status === 200
    } catch { return false }
  }, 'gateway /health')
  ok('gateway boots with SHARE_SUBDOMAINS=1')

  // --- Sign in ---
  const mlRes = await rawRequest({
    host: API_HOST, method: 'POST', path: '/api/auth/sign-in/magic-link',
    body: { email: EMAIL, callbackURL: '/health' },
    headers: { Origin: API_BASE },
  })
  expect(mlRes.status === 200 || mlRes.status === 201, 'magic-link request accepted', `status ${mlRes.status}`)

  const linkMatch = await waitFor(
    async () => gatewayLog.match(/Magic link for [^\n]*\n\s*(http\S+)/),
    'magic link in gateway log'
  )
  const magicUrl = new URL(linkMatch[1])
  const verifyRes = await rawRequest({ host: API_HOST, method: 'GET', path: magicUrl.pathname + magicUrl.search })
  const setCookies = (verifyRes.headers['set-cookie'] ?? [])
  const cookie = (Array.isArray(setCookies) ? setCookies : [setCookies])
    .map((c) => c.split(';')[0])
    .join('; ')
  expect(cookie.includes('session_token'), 'magic link yields a session cookie')
  const authedHeaders = { Cookie: cookie, Origin: API_BASE }

  // --- Seed entitlement ---
  execFileSync('npx', ['tsx', 'scripts/seed-ai-proxy.ts', '--email', EMAIL, '--feature', 'share_publish'], {
    cwd: ROOT, env: process.env, stdio: 'pipe',
  })
  ok('share_publish seeded')

  // --- Publish → label URL ---
  const pubRes = await rawRequest({
    host: API_HOST, method: 'POST', path: '/api/share/publish',
    body: { title: 'Subdomain Test', html: artifact('v1') },
    headers: authedHeaders,
  })
  expect(pubRes.status === 201, 'publish returns 201', `status ${pubRes.status}`)
  const pub = pubRes.json
  expect(typeof pub?.shareUrl === 'string', 'publish returns a shareUrl', pub?.shareUrl)

  // Extract label from the shareUrl: http://<label>.share.localhost:4030/s/<token>
  const shareUrlParsed = new URL(pub.shareUrl)
  const labelHost = shareUrlParsed.host // e.g. "a1b2c3d4.share.localhost:4030"
  const label = labelHost.split('.')[0]
  const token = shareUrlParsed.pathname.slice(3) // strip /s/

  expect(
    label.length === 16 && /^[0-9a-f]+$/.test(label),
    'shareUrl hostname has 16-char hex label',
    labelHost
  )
  expect(
    shareUrlParsed.hostname.endsWith(`.${SHARE_HOST.split(':')[0]}`),
    'shareUrl is on a subdomain of the share host',
    shareUrlParsed.hostname
  )
  console.log(`  [info] label=${label} token=${token.slice(0, 8)}…`)

  // --- Artifact GET: correct label host → 200 ---
  const labelGet = await rawRequest({ host: labelHost, path: `/s/${token}` })
  expect(labelGet.status === 200, 'GET /s/:token on label host → 200', `status ${labelGet.status}`)
  expect(labelGet.body.includes('v1'), 'served artifact has published content')
  expect(
    (labelGet.headers['content-security-policy'] ?? '').includes("connect-src 'self'"),
    'label host serves artifact CSP'
  )
  expect(labelGet.headers['cache-control'] === 'no-store', 'label host serves no-store')

  // --- Artifact GET: bare share host → 308 to label ---
  const bareGet = await rawRequest({ host: SHARE_HOST, path: `/s/${token}` })
  expect(bareGet.status === 308, 'GET /s/:token on bare share host → 308', `status ${bareGet.status}`)
  expect(
    (bareGet.headers.location ?? '').includes(labelHost),
    'bare share host 308 location is the label URL',
    bareGet.headers.location
  )

  // --- Artifact GET: API host → 308 to label ---
  const apiGet = await rawRequest({ host: API_HOST, path: `/s/${token}` })
  expect(apiGet.status === 308, 'GET /s/:token on API host → 308', `status ${apiGet.status}`)
  expect(
    (apiGet.headers.location ?? '').includes(labelHost),
    'API host 308 location is the label URL',
    apiGet.headers.location
  )

  // --- Artifact GET: wrong label host → 308 to correct label ---
  const wrongLabelHost = `wronglabel00000.${SHARE_HOST}`
  const wrongGet = await rawRequest({ host: wrongLabelHost, path: `/s/${token}` })
  expect(wrongGet.status === 308, 'GET /s/:token on wrong label → 308', `status ${wrongGet.status}`)
  expect(
    (wrongGet.headers.location ?? '').includes(labelHost),
    'wrong label 308 location is the correct label URL',
    wrongGet.headers.location
  )

  // --- JSON routes: work on label host ---
  const labelCommentUrl = `/s/${token}/comments`
  const labelPost = await rawRequest({
    host: labelHost, method: 'POST', path: labelCommentUrl,
    body: { markedText: 'v1', occurrenceIndex: 0, commentText: 'from label host', authorName: 'Label Tester' },
  })
  expect(labelPost.status === 201, 'comment POST on label host → 201', `status ${labelPost.status}`)
  const labelGet2 = await rawRequest({ host: labelHost, path: labelCommentUrl })
  expect(labelGet2.status === 200, 'comment GET on label host → 200', `status ${labelGet2.status}`)
  expect(
    Array.isArray(labelGet2.json?.comments) && labelGet2.json.comments.some((c) => c.commentText === 'from label host'),
    'comment from label host is visible'
  )

  // --- JSON routes: also work on bare share host (old file:// copies) ---
  const bareCommentPost = await rawRequest({
    host: SHARE_HOST, method: 'POST', path: labelCommentUrl,
    body: { markedText: 'v1', occurrenceIndex: 0, commentText: 'from bare host', authorName: 'Bare Tester' },
  })
  expect(bareCommentPost.status === 201, 'comment POST on bare share host → 201 (old file:// copies)', `status ${bareCommentPost.status}`)
  const bareCommentGet = await rawRequest({ host: SHARE_HOST, path: labelCommentUrl })
  expect(bareCommentGet.status === 200, 'comment GET on bare share host → 200', `status ${bareCommentGet.status}`)

  // --- API routes 404 on the label host (share host family) ---
  const labelApi = await rawRequest({ host: labelHost, path: '/api/share', headers: authedHeaders })
  expect(labelApi.status === 404, 'API routes 404 on label host (share host family)', `status ${labelApi.status}`)

  // --- Republish returns shareOrigin (not the full shareUrl; the token does not travel) ---
  const repub = await rawRequest({
    host: API_HOST, method: 'PUT', path: `/api/share/${pub.publicationId}/publish`,
    body: { title: 'Subdomain Test v2', html: artifact('v2') },
    headers: authedHeaders,
  })
  expect(repub.status === 200, 'republish returns 200', `status ${repub.status}`)
  expect(repub.json?.revCount === 2, 'republish bumps revCount')
  // shareOrigin is the label origin without the token path (e.g. http://a1b2.share.localhost:4030).
  expect(typeof repub.json?.shareOrigin === 'string' && repub.json.shareOrigin.includes(label),
    'republish returns shareOrigin in label form', repub.json?.shareOrigin)
  expect(!repub.json?.shareUrl && !repub.json?.token,
    'republish does not echo shareUrl or token')

  // --- Revoke → 410 on label host (no redirect) ---
  const revoke = await rawRequest({
    host: API_HOST, method: 'DELETE', path: `/api/share/${pub.publicationId}`,
    headers: authedHeaders,
  })
  expect(revoke.status === 204, 'revoke returns 204', `status ${revoke.status}`)

  const revokedLabel = await rawRequest({ host: labelHost, path: `/s/${token}` })
  expect(revokedLabel.status === 410, 'revoked GET on label host → 410', `status ${revokedLabel.status}`)
  expect((revokedLabel.headers['content-type'] ?? '').includes('text/html'), 'revoked label page is HTML')
  expect(revokedLabel.body.includes('This link was taken down'), 'revoked label page has takedown headline')

  // Revoked comment POST → 410
  const revokedComment = await rawRequest({
    host: labelHost, method: 'POST', path: labelCommentUrl,
    body: { markedText: 'v', commentText: 'late', authorName: 'L' },
  })
  expect(revokedComment.status === 410, 'comment POST after revoke → 410', `status ${revokedComment.status}`)

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
