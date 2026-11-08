/**
 * test-share-r2.mjs — the share service's R2 storage path, sealed at rest.
 *
 * Production stores artifacts in R2; test-share.mjs runs without it (the
 * Postgres fallback). This suite spawns a mock S3 server and a gateway on
 * :4040 pointed at it (R2_ENDPOINT, path-style), then checks what lands in
 * the bucket: publish → the object is sealed and opens with the link;
 * re-publish → a new sealed object replaces the old one; a pre-encryption
 * plaintext object → sealed on its first view, the plaintext deleted;
 * revoke → the object deleted and the keys shredded.
 *
 * Prereqs: `npm run dev:db` (Postgres) + migrations applied.
 * Usage:   npm run test:share:r2
 */
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 4040
const S3_PORT = 4041
const BUCKET = 'prose-test'
const BASE = `http://localhost:${PORT}`
const EMAIL = `share-r2-test-${Date.now()}@example.invalid`
const MARKER = `r2-at-rest-marker-${Date.now()}`

let passed = 0
let failed = 0
const ok = (label) => { console.log(`  ✓ ${label}`); passed++ }
const fail = (label, detail) => { console.error(`  ✗ ${label}${detail ? ': ' + detail : ''}`); failed++ }
const expect = (cond, label, detail) => (cond ? ok(label) : fail(label, detail))

const artifact = (body) => `<!DOCTYPE html>
<html><head><title>t</title></head><body><article><p>${body}</p></article>
<script type="application/x-prose-markdown" data-encoding="base64">dGVzdA==</script>
<script type="application/x-prose-share" data-version="1">{"shareEndpoint":"${BASE}","publishRev":"0123456789abcdef","publishedAt":"2026-11-07T00:00:00.000Z"}</script>
</body></html>`

// --- Mock S3 (path-style PUT/GET/DELETE /<bucket>/<key>) --------------------
/** key → bytes; the suite reads it directly to see what R2 would hold. */
const bucket = new Map()

// The SDK may frame a body as aws-chunked: "<hex size>[;ext]\r\n<data>\r\n"
// repeated, then a zero-size chunk and optional trailers.
function decodeAwsChunked(buf) {
  const parts = []
  let i = 0
  while (i < buf.length) {
    const eol = buf.indexOf('\r\n', i)
    const size = parseInt(buf.subarray(i, eol).toString().split(';')[0], 16)
    i = eol + 2
    if (!size) break
    parts.push(buf.subarray(i, i + size))
    i += size + 2
  }
  return Buffer.concat(parts)
}

const s3 = createServer(async (req, res) => {
  const chunks = []
  for await (const c of req) chunks.push(c)
  let body = Buffer.concat(chunks)
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (!path.startsWith(`/${BUCKET}/`)) { res.writeHead(404).end(); return }
  const key = path.slice(BUCKET.length + 2)
  if (req.method === 'PUT') {
    const streaming = (req.headers['content-encoding'] ?? '').includes('aws-chunked') ||
      String(req.headers['x-amz-content-sha256'] ?? '').startsWith('STREAMING-')
    if (streaming) body = decodeAwsChunked(body)
    bucket.set(key, body)
    res.writeHead(200, { ETag: '"mock"' }).end()
  } else if (req.method === 'GET') {
    const obj = bucket.get(key)
    if (!obj) {
      res.writeHead(404, { 'Content-Type': 'application/xml' })
        .end('<?xml version="1.0"?><Error><Code>NoSuchKey</Code><Message>missing</Message></Error>')
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': obj.length, ETag: '"mock"' }).end(obj)
  } else if (req.method === 'DELETE') {
    bucket.delete(key)
    res.writeHead(204).end()
  } else {
    res.writeHead(405).end()
  }
})
await new Promise((resolve) => s3.listen(S3_PORT, '127.0.0.1', resolve))

const objectsFor = (pubId) => [...bucket.keys()].filter((k) => k.startsWith(`shares/${pubId}/`))

// --- Spawn the gateway against the mock --------------------------------------
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
    R2_ACCOUNT_ID: 'test',
    R2_ACCESS_KEY_ID: 'test',
    R2_SECRET_ACCESS_KEY: 'test',
    R2_BUCKET: BUCKET,
    R2_ENDPOINT: `http://127.0.0.1:${S3_PORT}`,
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

async function signIn(email) {
  const from = gatewayLog.length
  const res = await fetch(`${BASE}/api/sign-in/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ email }),
  })
  if (!res.ok) throw new Error(`sign-in code request for ${email}: status ${res.status}`)
  const escaped = email.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const codeMatch = await waitFor(
    async () => gatewayLog.slice(from).match(new RegExp(`Sign-in code for ${escaped}: (\\d{6})`)),
    `sign-in code for ${email} in gateway log`
  )
  const verifyRes = await fetch(`${BASE}/api/auth/sign-in/email-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ email, otp: codeMatch[1] }),
  })
  const cookie = (verifyRes.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  return { Cookie: cookie, 'Content-Type': 'application/json', Origin: BASE }
}

const tsx = (...args) => execFileSync('npx', ['tsx', ...args], { cwd: ROOT, env: process.env, stdio: 'pipe', encoding: 'utf8' })
const row = (id) => JSON.parse(tsx('scripts/artifact-row.ts', 'inspect', id, MARKER))
const serves = async (url, text) => {
  const res = await fetch(url)
  return res.status === 200 && (await res.text()).includes(text)
}

async function main() {
  await waitFor(async () => {
    try { return (await fetch(`${BASE}/health`)).ok } catch { return false }
  }, 'gateway /health')
  ok('gateway boots against the mock R2')

  const authed = await signIn(EMAIL)
  tsx('scripts/grant.ts', '--email', EMAIL, '--feature', 'share_publish', '--by', 'manual')

  // --- Publish → sealed object ----------------------------------------------
  const pubRes = await fetch(`${BASE}/api/share/publish`, {
    method: 'POST', headers: authed, body: JSON.stringify({ title: 'R2 sealed', html: artifact(MARKER) }),
  })
  expect(pubRes.status === 201, 'publish returns 201', `status ${pubRes.status}`)
  const pub = await pubRes.json()
  const first = row(pub.publicationId)
  const firstObjects = objectsFor(pub.publicationId)
  expect(
    first.storage === 'r2' && !!first.encPublicKey && !first.hasCipher && !first.hasHtml && firstObjects.length === 1 &&
      firstObjects[0] === first.r2Key && first.r2Key.endsWith('.enc'),
    'publish stores one sealed object in R2 and nothing in the row', JSON.stringify({ first, firstObjects })
  )
  expect(!bucket.get(first.r2Key).includes(Buffer.from(MARKER)), 'the R2 object holds no plaintext')
  expect(await serves(pub.shareUrl, MARKER), 'the link opens the sealed R2 artifact')

  // --- Re-publish → a new sealed object replaces the old one -----------------
  const repub = await fetch(`${BASE}/api/share/${pub.publicationId}/publish`, {
    method: 'PUT', headers: authed, body: JSON.stringify({ title: 'R2 sealed', html: artifact(`${MARKER}-v2`) }),
  })
  expect(repub.status === 200, 're-publish accepted', `status ${repub.status}`)
  const second = row(pub.publicationId)
  const secondObjects = objectsFor(pub.publicationId)
  expect(
    second.r2Key !== first.r2Key && secondObjects.length === 1 && secondObjects[0] === second.r2Key &&
      second.encPublicKey === first.encPublicKey,
    're-publish writes a new sealed object and deletes the old one', JSON.stringify({ second, secondObjects })
  )
  expect(!bucket.get(second.r2Key).includes(Buffer.from(`${MARKER}-v2`)), 'the new object holds no plaintext')
  expect(await serves(pub.shareUrl, `${MARKER}-v2`), 'the link opens the re-published revision')

  // --- A pre-encryption plaintext object: sealed on its first view -----------
  const legacyKey = `shares/${pub.publicationId}/artifact.html`
  bucket.set(legacyKey, Buffer.from(artifact(`${MARKER}-legacy`)))
  bucket.delete(second.r2Key)
  tsx('scripts/artifact-row.ts', 'make-legacy', pub.publicationId, 'r2', legacyKey)
  expect(await serves(pub.shareUrl, `${MARKER}-legacy`), 'a pre-encryption R2 object serves')
  const healed = row(pub.publicationId)
  const healedObjects = objectsFor(pub.publicationId)
  expect(
    !!healed.encPublicKey && healed.r2Key !== legacyKey && healed.r2Key.endsWith('.enc') &&
      healedObjects.length === 1 && healedObjects[0] === healed.r2Key,
    'the first view seals it into a new object and deletes the plaintext one', JSON.stringify({ healed, healedObjects })
  )
  expect(!bucket.get(healed.r2Key).includes(Buffer.from(`${MARKER}-legacy`)), 'the sealed object holds no plaintext')
  expect(await serves(pub.shareUrl, `${MARKER}-legacy`), 'the sealed object opens with the link')

  // --- Revoke → object deleted, keys shredded ---------------------------------
  const revoke = await fetch(`${BASE}/api/share/${pub.publicationId}`, { method: 'DELETE', headers: authed })
  expect(revoke.status === 204, 'revoke returns 204', `status ${revoke.status}`)
  const gone = row(pub.publicationId)
  expect(
    objectsFor(pub.publicationId).length === 0 && !gone.encPublicKey && !gone.hasWrappedKey && gone.r2Key === null,
    'revoke deletes the object and shreds the keys', JSON.stringify(gone)
  )

  console.log(`\n${passed} passed, ${failed} failed`)
  s3.close()
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  console.error('--- gateway log ---\n' + gatewayLog.slice(-4000))
  process.exit(1)
})
