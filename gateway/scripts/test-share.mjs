/**
 * test-share.mjs — end-to-end integration test for the share service (#768).
 *
 * Self-contained: spawns its own gateway on :4010 (dev mode, so the magic
 * link prints to stdout where this script harvests it), signs in, seeds the
 * share_publish entitlement, then exercises the full share matrix:
 * publish → serve → comment/reply → author pull (email never exposed) →
 * author reply/resolve push → public live GET → re-publish → revoke → rate limit.
 *
 * Prereqs: `npm run dev:db` (Postgres on :5433) + migrations applied.
 * Usage:   npm run test:share
 */
import { spawn, execFileSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 4010
const BASE = `http://localhost:${PORT}`
const EMAIL = `share-test-${Date.now()}@example.invalid`

let passed = 0
let failed = 0
const ok = (label) => { console.log(`  ✓ ${label}`); passed++ }
const fail = (label, detail) => { console.error(`  ✗ ${label}${detail ? ': ' + detail : ''}`); failed++ }
const expect = (cond, label, detail) => (cond ? ok(label) : fail(label, detail))

// A minimal structurally-valid Prose share artifact (v2 content on re-publish).
const artifact = (body) => `<!DOCTYPE html>
<html><head><title>t</title></head><body><article><p>${body}</p></article>
<script type="application/x-prose-markdown" data-encoding="base64">dGVzdA==</script>
<script type="application/x-prose-share" data-version="1">{"shareEndpoint":"${BASE}","publishRev":"0123456789abcdef","publishedAt":"2026-08-31T00:00:00.000Z"}</script>
</body></html>`

// --- Spawn the gateway, capturing stdout for the magic link ----------------
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

async function main() {
  await waitFor(async () => {
    try {
      const r = await fetch(`${BASE}/health`)
      return r.ok
    } catch { return false }
  }, 'gateway /health')
  ok('gateway boots')

  // --- Sign in via harvested magic link ------------------------------------
  const mlRes = await fetch(`${BASE}/api/auth/sign-in/magic-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ email: EMAIL, callbackURL: '/health' }),
  })
  expect(mlRes.ok, 'magic-link request accepted', `status ${mlRes.status}`)

  const linkMatch = await waitFor(
    async () => gatewayLog.match(/Magic link for [^\n]*\n\s*(http\S+)/),
    'magic link in gateway log'
  )
  const verifyRes = await fetch(linkMatch[1], { redirect: 'manual' })
  const setCookies = verifyRes.headers.getSetCookie?.() ?? []
  const cookie = setCookies.map((c) => c.split(';')[0]).join('; ')
  expect(cookie.includes('session_token'), 'magic link yields a session cookie')
  const authed = { Cookie: cookie, 'Content-Type': 'application/json', Origin: BASE }

  // --- Entitlement gate -----------------------------------------------------
  const unentitled = await fetch(`${BASE}/api/share/publish`, {
    method: 'POST', headers: authed, body: JSON.stringify({ title: 't', html: artifact('v1') }),
  })
  expect(unentitled.status === 403, 'publish 403s before share_publish grant', `status ${unentitled.status}`)

  execFileSync('npx', ['tsx', 'scripts/seed-ai-proxy.ts', '--email', EMAIL, '--feature', 'share_publish'], {
    cwd: ROOT, env: process.env, stdio: 'pipe',
  })
  ok('share_publish seeded')

  const anon = await fetch(`${BASE}/api/share`, { headers: { 'Content-Type': 'application/json' } })
  expect(anon.status === 401, 'author routes 401 unauthenticated', `status ${anon.status}`)

  // --- Publish → serve ------------------------------------------------------
  const pubRes = await fetch(`${BASE}/api/share/publish`, {
    method: 'POST', headers: authed, body: JSON.stringify({ title: 'Test Doc', html: artifact('v1') }),
  })
  expect(pubRes.status === 201, 'publish returns 201', `status ${pubRes.status}`)
  const pub = await pubRes.json()
  expect(typeof pub.shareUrl === 'string' && pub.shareUrl.includes('/s/'), 'publish returns a share URL')
  expect(pub.publishRev === '0123456789abcdef', 'publishRev extracted from artifact', pub.publishRev)

  const badArtifact = await fetch(`${BASE}/api/share/publish`, {
    method: 'POST', headers: authed, body: JSON.stringify({ title: 'x', html: '<p>nope</p>' }),
  })
  expect(badArtifact.status === 400, 'non-Prose artifact rejected', `status ${badArtifact.status}`)

  const serveRes = await fetch(pub.shareUrl)
  expect(serveRes.status === 200, 'GET /s/:token serves the artifact', `status ${serveRes.status}`)
  expect((await serveRes.text()).includes('v1'), 'served artifact has the published content')
  expect(serveRes.headers.get('referrer-policy') === 'no-referrer', 'no-referrer header set')
  expect(serveRes.headers.get('x-frame-options') === 'DENY', 'x-frame-options set')
  const servedCsp = serveRes.headers.get('content-security-policy') ?? ''
  expect(servedCsp.includes("connect-src 'self'"), 'CSP set')
  expect(
    servedCsp.includes("style-src 'unsafe-inline' https://fonts.googleapis.com") &&
      servedCsp.includes('font-src data: https://fonts.gstatic.com'),
    'CSP allows Google Fonts (style + font hosts)'
  )
  expect(serveRes.headers.get('cache-control') === 'no-store', 'no-store cache header set')

  const bogus = await fetch(`${BASE}/s/${'a'.repeat(43)}`)
  expect(bogus.status === 404, 'unknown token 404s', `status ${bogus.status}`)

  // --- Reviewer comments ----------------------------------------------------
  const commentUrl = `${pub.shareUrl.replace(BASE, BASE)}/comments`
  const c1 = await fetch(commentUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      markedText: 'v1', occurrenceIndex: 0, commentText: 'first!',
      authorName: 'Reviewer Rae', authorEmail: 'rae@example.invalid', publishRev: pub.publishRev,
    }),
  })
  expect(c1.status === 201, 'anonymous comment accepted', `status ${c1.status}`)
  const c1Body = await c1.json()

  const noName = await fetch(commentUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markedText: 'v1', commentText: 'x', authorName: '' }),
  })
  expect(noName.status === 400, 'comment without a name rejected', `status ${noName.status}`)

  const badEmail = await fetch(commentUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markedText: 'v1', commentText: 'x', authorName: 'A', authorEmail: 'not-an-email' }),
  })
  expect(badEmail.status === 400, 'malformed email rejected', `status ${badEmail.status}`)

  const r1 = await fetch(`${commentUrl}/${c1Body.id}/replies`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commentText: 'agreed', authorName: 'Second Reviewer' }),
  })
  expect(r1.status === 201, 'reply accepted', `status ${r1.status}`)
  const r1Body = await r1.json()

  const nested = await fetch(`${commentUrl}/${r1Body.id}/replies`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commentText: 'too deep', authorName: 'X' }),
  })
  expect(nested.status === 404, 'reply-to-reply rejected (one level only)', `status ${nested.status}`)

  // --- Author pull (privacy) ------------------------------------------------
  const pullRes = await fetch(`${BASE}/api/share/${pub.publicationId}/comments`, { headers: authed })
  expect(pullRes.status === 200, 'author comment pull works', `status ${pullRes.status}`)
  const pull = await pullRes.json()
  expect(pull.comments.length === 2, 'pull returns comment + reply', `${pull.comments.length}`)
  expect(
    pull.comments.every((c) => !('authorEmail' in c)),
    'authorEmail NEVER exposed in the pull'
  )
  expect(pull.comments.some((c) => c.parentId === c1Body.id), 'reply carries parentId')

  const since = await fetch(
    `${BASE}/api/share/${pub.publicationId}/comments?since=${encodeURIComponent(pull.nextCursor)}`,
    { headers: authed }
  )
  expect((await since.json()).comments.length === 0, 'since-cursor excludes already-pulled comments')

  const listRes = await fetch(`${BASE}/api/share`, { headers: authed })
  const list = await listRes.json()
  expect(
    list.publications.length === 1 && list.publications[0].commentCount === 2,
    'author list shows the publication with its comment count'
  )

  // --- Author reply + resolve push (live conversation, #769) ----------------
  const aReply = await fetch(`${BASE}/api/share/${pub.publicationId}/comments/${c1Body.id}/replies`, {
    method: 'POST', headers: authed, body: JSON.stringify({ commentText: 'On it — fixed in the next rev.', authorName: 'Angel' }),
  })
  expect(aReply.status === 201, 'author reply accepted', `status ${aReply.status}`)
  const aReplyBody = await aReply.json()

  const aReplyAnon = await fetch(`${BASE}/api/share/${pub.publicationId}/comments/${c1Body.id}/replies`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commentText: 'x' }),
  })
  expect(aReplyAnon.status === 401, 'author reply 401s unauthenticated', `status ${aReplyAnon.status}`)

  const resolveRes = await fetch(`${BASE}/api/share/${pub.publicationId}/comments/${c1Body.id}`, {
    method: 'PATCH', headers: authed, body: JSON.stringify({ resolved: true }),
  })
  expect(resolveRes.status === 200, 'resolve PATCH accepted', `status ${resolveRes.status}`)
  expect(!!(await resolveRes.json()).resolvedAt, 'resolve sets resolvedAt')

  const resolveReply = await fetch(`${BASE}/api/share/${pub.publicationId}/comments/${r1Body.id}`, {
    method: 'PATCH', headers: authed, body: JSON.stringify({ resolved: true }),
  })
  expect(resolveReply.status === 404, 'resolve on a reply 404s', `status ${resolveReply.status}`)

  const resolveBad = await fetch(`${BASE}/api/share/${pub.publicationId}/comments/${c1Body.id}`, {
    method: 'PATCH', headers: authed, body: JSON.stringify({ resolved: 'yes' }),
  })
  expect(resolveBad.status === 400, 'non-boolean resolved rejected', `status ${resolveBad.status}`)

  // --- Public live GET (viewer poll, #769) ----------------------------------
  const liveRes = await fetch(commentUrl)
  expect(liveRes.status === 200, 'public comment GET works', `status ${liveRes.status}`)
  const live = await liveRes.json()
  expect(live.comments.length === 3, 'live GET returns comment + both replies', `${live.comments.length}`)
  expect(live.comments.every((cm) => !('authorEmail' in cm)), 'authorEmail NEVER exposed in the live GET')
  const liveAuthorReply = live.comments.find((cm) => cm.id === aReplyBody.id)
  expect(
    !!liveAuthorReply && liveAuthorReply.fromAuthor === true && liveAuthorReply.authorName === 'Angel',
    'author reply carries fromAuthor + name'
  )
  const liveTop = live.comments.find((cm) => cm.id === c1Body.id)
  expect(!!liveTop && !!liveTop.resolvedAt && liveTop.fromAuthor === false, 'resolved state visible on the live GET')

  const liveSince = await fetch(`${commentUrl}?since=${encodeURIComponent(live.nextCursor)}`)
  expect((await liveSince.json()).comments.length === 0, 'live GET since-cursor filters')

  const unresolve = await fetch(`${BASE}/api/share/${pub.publicationId}/comments/${c1Body.id}`, {
    method: 'PATCH', headers: authed, body: JSON.stringify({ resolved: false }),
  })
  expect((await unresolve.json()).resolvedAt === null, 'unresolve clears resolvedAt')

  // --- Re-publish -----------------------------------------------------------
  const repub = await fetch(`${BASE}/api/share/${pub.publicationId}/publish`, {
    method: 'PUT', headers: authed, body: JSON.stringify({ title: 'Test Doc v2', html: artifact('v2') }),
  })
  expect(repub.status === 200, 're-publish accepted', `status ${repub.status}`)
  expect((await repub.json()).revCount === 2, 're-publish bumps revCount')
  const serve2 = await fetch(pub.shareUrl)
  expect((await serve2.text()).includes('v2'), 'same URL serves the new revision')

  // --- Revoke ---------------------------------------------------------------
  const revoke = await fetch(`${BASE}/api/share/${pub.publicationId}`, { method: 'DELETE', headers: authed })
  expect(revoke.status === 204, 'revoke returns 204', `status ${revoke.status}`)
  const gone = await fetch(pub.shareUrl)
  expect(gone.status === 410, 'revoked share 410s', `status ${gone.status}`)
  // The 410 is the styled takedown page on the artifact headers — not bare
  // text; the comment surfaces below keep their JSON 410s.
  expect((gone.headers.get('content-type') ?? '').includes('text/html'), 'revoked page is HTML', gone.headers.get('content-type'))
  expect((gone.headers.get('content-security-policy') ?? '').includes("default-src 'none'"), 'revoked page carries the artifact CSP')
  expect(gone.headers.get('cache-control') === 'no-store', 'revoked page is no-store')
  const goneHtml = await gone.text()
  expect(goneHtml.includes('This link was taken down by its author.'), 'revoked page headline present')
  expect(goneHtml.includes('it still opens and still shows its comments'), 'revoked page downloaded-copy note present')
  expect(goneHtml.includes('· 410'), 'revoked page status footer present')
  const commentGone = await fetch(commentUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markedText: 'v', commentText: 'late', authorName: 'L' }),
  })
  expect(commentGone.status === 410, 'comments on a revoked share 410', `status ${commentGone.status}`)
  const liveGone = await fetch(commentUrl)
  expect(liveGone.status === 410, 'live GET on a revoked share 410s', `status ${liveGone.status}`)
  expect((liveGone.headers.get('content-type') ?? '').includes('application/json'), 'live 410 stays JSON')
  const pullAfter = await fetch(`${BASE}/api/share/${pub.publicationId}/comments`, { headers: authed })
  expect((await pullAfter.json()).comments.length === 0, 'revoke deleted reviewer comments')

  // --- Rate limit (last: it poisons this IP's write budget) -----------------
  const pub2Res = await fetch(`${BASE}/api/share/publish`, {
    method: 'POST', headers: authed, body: JSON.stringify({ title: 'RL', html: artifact('rl') }),
  })
  const pub2 = await pub2Res.json()
  let got429 = null
  for (let i = 0; i < 12; i++) {
    const res = await fetch(`${pub2.shareUrl}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markedText: 'rl', commentText: `burst ${i}`, authorName: 'Flood' }),
    })
    if (res.status === 429) { got429 = res; break }
  }
  expect(!!got429, 'comment burst hits the per-IP 429')
  expect(!!got429 && !!got429.headers.get('retry-after'), '429 carries Retry-After')

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
