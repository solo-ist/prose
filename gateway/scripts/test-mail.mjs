/**
 * test-mail.mjs — integration test for sign-in code delivery (#964, #813).
 *
 * Spins up a tiny mock Resend HTTP server and a gateway instance configured
 * to hit it, then exercises the code sign-in flow:
 *   - POST /api/sign-in/code mails exactly one code via Resend, and never
 *     prints it to stdout when RESEND_API_KEY is set
 *   - the code signs in once (session cookie), and only for its own email
 *   - wrong guesses burn the code; a newer code replaces an older one
 *   - with a desktop state nonce, the email carries an "Open in Prose" link
 *     (code + state in the URL fragment) to a CSP-locked /auth/code page
 *   - unused emailOTP routes and the old magic-link route are gone (404)
 *   - input validation, the per-email cap, and a Resend 500 → 502 mail_failed
 *
 * Prereqs: `npm run dev:db` (Postgres on :5433) + migrations applied.
 * Usage:   npm run test:mail
 */
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
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
    // One IP makes every request here; the per-email cap is what's under test.
    SIGN_IN_CODE_IP_MAX: '100',
    SIGN_IN_VERIFY_IP_MAX: '100',
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

  const json = { 'Content-Type': 'application/json', Origin: BASE }
  const stamp = Date.now()

  // Request a code and return the 6 digits from the mocked email.
  async function requestCode(email) {
    const before = recordedPosts.length
    const res = await fetch(`${BASE}/api/sign-in/code`, {
      method: 'POST', headers: json, body: JSON.stringify({ email }),
    })
    if (res.status !== 200) throw new Error(`code request for ${email}: status ${res.status}`)
    await waitFor(() => recordedPosts.length > before, `mock Resend receives the code for ${email}`, 10000)
    const code = (recordedPosts.at(-1).body.text ?? '').match(/\b(\d{6})\b/)?.[1]
    if (!code) throw new Error(`no code in the email to ${email}`)
    return code
  }
  const verify = (email, otp) =>
    fetch(`${BASE}/api/auth/sign-in/email-otp`, {
      method: 'POST', headers: json, body: JSON.stringify({ email, otp }),
    })
  const cookieOf = (res) => (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  const errCode = async (res) => { try { return (await res.json()).code } catch { return undefined } }
  const wrong = (code) => String((Number(code) + 1) % 1_000_000).padStart(6, '0')

  // --- Delivery ------------------------------------------------------------
  recordedPosts = []
  const code = await requestCode(EMAIL)
  ok('code request accepted and mailed')
  expect(!/Sign-in code for/.test(gatewayLog), 'code NOT printed to stdout when RESEND_API_KEY is set')
  expect(recordedPosts.length === 1, 'exactly one POST to Resend', `got ${recordedPosts.length}`)
  const post = recordedPosts[0]
  expect(post.auth === 'Bearer test-key', 'Authorization header is Bearer test-key', post.auth)
  expect(post.body.from === MAIL_FROM, 'from matches MAIL_FROM', post.body.from)
  expect(Array.isArray(post.body.to) && post.body.to[0] === EMAIL, 'to matches the email', JSON.stringify(post.body.to))
  expect(post.body.subject?.includes(code), 'subject carries the code', post.body.subject)
  expect(post.body.html?.includes(code), 'HTML body carries the code')
  expect(/expires in 10 minutes/.test(post.body.text ?? ''), 'text body states the expiry')
  // #966: the design-system template (emails/sign-in-code.html).
  const html = post.body.html ?? ''
  expect(html.includes('¶ Prose.') && html.includes('<h1') && html.includes('Sign in to Prose'), 'HTML uses the branded card (wordmark + heading)')
  expect(html.includes('prefers-color-scheme: dark') && html.includes('role="presentation"'), 'HTML has the dark-mode block and presentation tables')
  expect(html.includes(`aria-label="Sign-in code ${code.split('').join(' ')}"`), 'code box reads the digits one by one to screen readers')
  expect(html.includes(`Your Prose sign-in code is ${code}.`), 'preheader carries the code')
  expect(!html.includes('Open in Prose'), 'no button without a desktop state')
  expect((post.body.text ?? '').startsWith('¶ Prose.') && /works once/.test(post.body.text ?? ''), 'text alternative matches the template copy')

  // --- Sign-in -------------------------------------------------------------
  const signedIn = await verify(EMAIL, code)
  const cookie = cookieOf(signedIn)
  expect(signedIn.ok && cookie.includes('session_token'), 'code signs in with a session cookie', `status ${signedIn.status}`)
  const session = await (await fetch(`${BASE}/api/auth/get-session`, { headers: { Cookie: cookie } })).json()
  expect(session?.user?.email === EMAIL, 'session belongs to the requested email', session?.user?.email)
  const reused = await verify(EMAIL, code)
  expect(!reused.ok && !cookieOf(reused).includes('session_token'), 'a code works only once', `status ${reused.status}`)

  // Login-CSRF property: a code is bound to the address it was sent to, so an
  // attacker's code can't sign a victim's desktop into the attacker's account.
  const attacker = `attacker-${stamp}@example.invalid`
  const victim = `victim-${stamp}@example.invalid`
  const attackerCode = await requestCode(attacker)
  const crossed = await verify(victim, attackerCode)
  expect(!crossed.ok && !cookieOf(crossed).includes('session_token'), "another address's code is rejected", `status ${crossed.status}`)

  // --- Guessing --------------------------------------------------------------
  const guessed = `guessed-${stamp}@example.invalid`
  const guessedCode = await requestCode(guessed)
  let wrongAll400 = true
  for (let i = 0; i < 5; i++) {
    const r = await verify(guessed, wrong(guessedCode))
    if (r.status !== 400 || (await errCode(r)) !== 'INVALID_OTP') wrongAll400 = false
  }
  expect(wrongAll400, 'wrong codes are rejected with INVALID_OTP')
  const afterLockout = await verify(guessed, guessedCode)
  expect(!afterLockout.ok, 'after 5 wrong tries even the right code fails', `status ${afterLockout.status}`)
  expect(['TOO_MANY_ATTEMPTS', 'INVALID_OTP'].includes(await errCode(afterLockout)), 'lockout reports a code error')

  const rotated = `rotated-${stamp}@example.invalid`
  const firstCode = await requestCode(rotated)
  const secondCode = await requestCode(rotated)
  if (firstCode !== secondCode) {
    const stale = await verify(rotated, firstCode)
    expect(!stale.ok, 'a newer code replaces the older one', `status ${stale.status}`)
  } else {
    ok('a newer code replaces the older one (codes collided; skipped)')
  }
  const fresh = await verify(rotated, secondCode)
  expect(fresh.ok && cookieOf(fresh).includes('session_token'), 'the newest code signs in')

  // --- "Open in Prose" link + fallback page ----------------------------------
  const STATE = 'Zm9vYmFyYmF6cXV4cXV1eDEy'
  recordedPosts = []
  const linked = `linked-${stamp}@example.invalid`
  const linkRes = await fetch(`${BASE}/api/sign-in/code`, {
    method: 'POST', headers: json, body: JSON.stringify({ email: linked, state: STATE }),
  })
  expect(linkRes.status === 200, 'code request with a state accepted', `status ${linkRes.status}`)
  await waitFor(() => recordedPosts.length >= 1, 'mock Resend receives the linked email', 10000)
  const linkedText = recordedPosts[0].body.text ?? ''
  const linkedCode = linkedText.match(/\b(\d{6})\b/)?.[1]
  const expectedLink = `${BASE}/auth/code#c=${linkedCode}&s=${STATE}`
  expect(linkedText.includes(expectedLink), 'text body carries the Open in Prose link (code + state in the fragment)', linkedText)
  expect((recordedPosts[0].body.html ?? '').includes(expectedLink.replace(/&/g, '&amp;')), 'HTML body carries the escaped link')
  expect((recordedPosts[0].body.html ?? '').includes('>Open in Prose</a>'), 'HTML shows the Open in Prose button with a state')

  recordedPosts = []
  await fetch(`${BASE}/api/sign-in/code`, {
    method: 'POST', headers: json, body: JSON.stringify({ email: `nolink-${stamp}@example.invalid`, state: 'bad state!' }),
  })
  await waitFor(() => recordedPosts.length >= 1, 'mock Resend receives the unlinked email', 10000)
  expect(!/\/auth\/code/.test(recordedPosts[0].body.text ?? ''), 'a malformed state gets no link')
  expect(!/\/auth\/code/.test(post.body.text ?? ''), 'a request without a state gets no link')

  const page = await fetch(`${BASE}/auth/code`)
  expect(page.status === 200, 'GET /auth/code returns 200', `status ${page.status}`)
  expect(page.headers.get('cache-control') === 'no-store', 'fallback page is no-store')
  expect(page.headers.get('referrer-policy') === 'no-referrer', 'fallback page is no-referrer')
  const pageCsp = page.headers.get('content-security-policy') ?? ''
  expect(pageCsp.includes("default-src 'none'") && pageCsp.includes("frame-ancestors 'none'"), 'fallback page CSP is locked down', pageCsp)
  const pageHtml = await page.text()
  const pageScriptSrc = (pageCsp.match(/script-src ([^;]+)/) ?? [])[1] ?? ''
  const pageScript = (pageHtml.match(/<script>([\s\S]*?)<\/script>/) ?? [])[1] ?? ''
  const pageHash = `'sha256-${createHash('sha256').update(pageScript).digest('base64')}'`
  expect(!pageScriptSrc.includes('unsafe-inline'), "fallback page script-src has no 'unsafe-inline'", pageScriptSrc)
  expect(pageScript.length > 0 && pageScriptSrc.trim() === pageHash, 'script-src hash matches the served script', pageScriptSrc)
  expect(!/\son[a-z]+=/i.test(pageHtml), 'fallback page has no inline event-handler attributes')
  expect(pageScript.includes("'prose-signin://auth?code='") && !pageScript.includes('prose://'), 'fallback page hands off to prose-signin://auth, never prose://')

  // --- Closed routes ---------------------------------------------------------
  for (const path of [
    '/api/auth/email-otp/send-verification-otp',
    '/api/auth/email-otp/check-verification-otp',
    '/api/auth/email-otp/verify-email',
    '/api/auth/sign-in/magic-link',
  ]) {
    const r = await fetch(`${BASE}${path}`, {
      method: 'POST', headers: json, body: JSON.stringify({ email: EMAIL, type: 'sign-in', otp: '000000' }),
    })
    expect(r.status === 404, `${path} is closed (404)`, `status ${r.status}`)
  }
  expect((await fetch(`${BASE}/auth/link?token=x`)).status === 404, 'old magic-link landing page is gone (404)')

  // --- Validation and limits -------------------------------------------------
  const badEmail = await fetch(`${BASE}/api/sign-in/code`, {
    method: 'POST', headers: json, body: JSON.stringify({ email: 'not-an-email' }),
  })
  expect(badEmail.status === 400, 'malformed email → 400', `status ${badEmail.status}`)
  const formPost = await fetch(`${BASE}/api/sign-in/code`, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ email: EMAIL }),
  })
  expect(formPost.status === 415, 'non-JSON body → 415 (forces a CORS preflight)', `status ${formPost.status}`)

  const capped = `capped-${stamp}@example.invalid`
  for (let i = 0; i < 5; i++) await requestCode(capped)
  const sixth = await fetch(`${BASE}/api/sign-in/code`, {
    method: 'POST', headers: json, body: JSON.stringify({ email: capped.toUpperCase() }),
  })
  expect(sixth.status === 429, 'sixth code for one address within the hour → 429', `status ${sixth.status}`)
  expect((await sixth.json()).error === 'too_many_codes', '429 body is too_many_codes')

  // --- Mock 500 → the request fails visibly -----------------------------------
  forceStatus = 500
  const fail500 = await fetch(`${BASE}/api/sign-in/code`, {
    method: 'POST', headers: json, body: JSON.stringify({ email: `fail500-${stamp}@example.invalid` }),
  })
  expect(fail500.status === 502, 'Resend 500 → 502', `status ${fail500.status}`)
  expect((await fail500.json()).error === 'mail_failed', '502 body is mail_failed (not silent success)')
  forceStatus = 200

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
